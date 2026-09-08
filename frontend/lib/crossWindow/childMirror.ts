/**
 * childMirror — Child-window cross-window state hydration.
 *
 * On mount in a child window (DetachShell, SpacePreviewShell):
 *  1. Emits stateRequest with a requestId; waits up to 2s for stateSnapshot-<id>.
 *  2. Applies snapshot to local Pinia stores (auth, profile, project, theme).
 *  3. Registers ongoing listeners to keep in sync with main window changes.
 *
 * Returns unlisten functions so the caller can clean up in onUnmounted.
 */

import { broadcast, listen, channels, stateSnapshotChannel, type Unlisten } from './sync'
import type { WindowStateSnapshot } from './mainBroadcast'

const HYDRATION_TIMEOUT_MS = 2000

async function applySnapshot(snap: WindowStateSnapshot): Promise<void> {
  const { useAuthStore } = await import('@/stores/auth')
  const { useProfileStore } = await import('@/stores/profile')
  const { useProjectStore } = await import('@/stores/project')
  const { useAppTheme } = await import('@/composables/useAppTheme')

  const authStore = useAuthStore()
  const profileStore = useProfileStore()
  const projectStore = useProjectStore()
  const theme = useAppTheme()

  // Apply auth
  if (snap.auth.token !== undefined) {
    authStore.token = snap.auth.token
    authStore.user = snap.auth.user
      ? { ...authStore.user, id: snap.auth.user.id, email: snap.auth.user.email } as typeof authStore.user
      : null
    authStore.isAuthenticated = !!snap.auth.token
  }

  // Apply profile
  if (snap.profile.active !== undefined) {
    profileStore.activeProfileId = snap.profile.active ?? ''
  }

  // Apply project
  if (snap.project.currentPath) {
    projectStore.openProject(snap.project.currentPath)
  }

  // Apply theme
  if (snap.theme) {
    theme.setTheme(snap.theme)
  }
}

export async function startChildMirror(): Promise<Unlisten[]> {
  const unlistens: Unlisten[] = []

  // 1. Request current state snapshot from main window
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const hydrated = await new Promise<WindowStateSnapshot | null>((resolve) => {
    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      console.warn('[childMirror] stateRequest timed out after', HYDRATION_TIMEOUT_MS, 'ms')
      resolve(null)
    }, HYDRATION_TIMEOUT_MS)

    listen<WindowStateSnapshot>(stateSnapshotChannel(requestId), (snap) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(snap)
    }).then((unlisten) => {
      // Self-cleanup after resolved
      unlistens.push(unlisten)
    }).catch(() => {
      if (!settled) {
        settled = true
        clearTimeout(timeout)
        resolve(null)
      }
    })

    // Emit after we've set up the listener
    broadcast(channels.stateRequest, { requestId }).catch(() => {})
  })

  if (hydrated) {
    await applySnapshot(hydrated).catch((err) => {
      console.warn('[childMirror] Failed to apply initial snapshot:', err)
    })
  }

  // 2. Ongoing listeners for incremental updates

  const unlistenAuth = await listen<WindowStateSnapshot['auth']>(channels.auth, async (auth) => {
    const { useAuthStore } = await import('@/stores/auth')
    const authStore = useAuthStore()
    authStore.token = auth.token
    authStore.user = auth.user
      ? { ...authStore.user, id: auth.user.id, email: auth.user.email } as typeof authStore.user
      : null
    authStore.isAuthenticated = !!auth.token
  })

  const unlistenProfile = await listen<WindowStateSnapshot['profile']>(channels.profile, async (profile) => {
    const { useProfileStore } = await import('@/stores/profile')
    const profileStore = useProfileStore()
    profileStore.activeProfileId = profile.active ?? ''
  })

  const unlistenProject = await listen<WindowStateSnapshot['project']>(channels.project, async (project) => {
    const { useProjectStore } = await import('@/stores/project')
    const projectStore = useProjectStore()
    if (project.currentPath) {
      projectStore.openProject(project.currentPath)
    }
  })

  const unlistenTheme = await listen<{ themeId: string }>(channels.theme, async ({ themeId }) => {
    const { useAppTheme } = await import('@/composables/useAppTheme')
    const theme = useAppTheme()
    theme.setTheme(themeId)
  })

  unlistens.push(unlistenAuth, unlistenProfile, unlistenProject, unlistenTheme)

  console.log('[childMirror] started, hydration', hydrated ? 'OK' : 'TIMEOUT')
  return unlistens
}
