/**
 * mainBroadcast — Main-window-only cross-window state sync.
 *
 * Watches auth, profile, project, and theme stores and broadcasts snapshots
 * to child windows on change. Also answers stateRequest messages from child
 * windows by emitting the full snapshot back on stateSnapshot-<requestId>.
 *
 * Only called from bootstrapMain (main window only).
 */

import { watch } from 'vue'
import { broadcast, listen, channels, stateSnapshotChannel, type Unlisten } from './sync'

export interface WindowStateSnapshot {
  auth: { token: string | null; user: { id: string; email: string } | null }
  profile: { active: string | null; available: string[] }
  project: { currentPath: string | null }
  theme: string
}

async function buildSnapshot(): Promise<WindowStateSnapshot> {
  const { useAuthStore } = await import('@/stores/auth')
  const { useProfileStore } = await import('@/stores/profile')
  const { useProjectStore } = await import('@/stores/project')
  const { useAppTheme } = await import('@/composables/useAppTheme')

  const authStore = useAuthStore()
  const profileStore = useProfileStore()
  const projectStore = useProjectStore()
  const theme = useAppTheme()

  return {
    auth: {
      token: authStore.token,
      user: authStore.user ? { id: authStore.user.id, email: authStore.user.email } : null,
    },
    profile: {
      active: profileStore.activeProfileId || null,
      available: profileStore.profiles.map(p => p.id),
    },
    project: {
      currentPath: projectStore.currentProject?.path ?? null,
    },
    theme: theme.currentThemeId.value,
  }
}

export async function startMainBroadcasts(): Promise<Unlisten[]> {
  const unlistens: Unlisten[] = []

  const { useAuthStore } = await import('@/stores/auth')
  const { useProfileStore } = await import('@/stores/profile')
  const { useProjectStore } = await import('@/stores/project')
  const { useAppTheme } = await import('@/composables/useAppTheme')

  const authStore = useAuthStore()
  const profileStore = useProfileStore()
  const projectStore = useProjectStore()
  const theme = useAppTheme()

  // Watch auth (token + user)
  const stopAuth = watch(
    () => ({ token: authStore.token, userId: authStore.user?.id ?? null }),
    async () => {
      const snap = await buildSnapshot()
      await broadcast(channels.auth, snap.auth)
    },
  )

  // Watch profile (activeProfileId)
  const stopProfile = watch(
    () => profileStore.activeProfileId,
    async (activeId) => {
      const snap = {
        active: activeId || null,
        available: profileStore.profiles.map(p => p.id),
      }
      await broadcast(channels.profile, snap)
    },
  )

  // Watch project
  const stopProject = watch(
    () => projectStore.currentProject?.path ?? null,
    async (currentPath) => {
      await broadcast(channels.project, { currentPath })
    },
  )

  // Watch theme
  const stopTheme = watch(
    () => theme.currentThemeId.value,
    async (themeId) => {
      await broadcast(channels.theme, { themeId })
    },
  )

  unlistens.push(stopAuth, stopProfile, stopProject, stopTheme)

  // Answer stateRequest from child windows
  const unlistenRequest = await listen<{ requestId: string }>(
    channels.stateRequest,
    async ({ requestId }) => {
      if (!requestId) return
      try {
        const snap = await buildSnapshot()
        await broadcast(stateSnapshotChannel(requestId), snap)
      } catch (err) {
        console.warn('[mainBroadcast] Failed to respond to stateRequest:', err)
      }
    },
  )
  unlistens.push(unlistenRequest)

  console.log('[mainBroadcast] started')
  return unlistens
}
