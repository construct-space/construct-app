import type { RouteLocationNormalized } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useProfileStore } from '@/stores/profile'
import { isTauriEnv } from '@/utils/tauri'
import { isOnboardingComplete } from '@/composables/useOnboarding'

let _windowLabel: string | null = null
let _windowLabelResolved = false

async function getWindowLabel(): Promise<string | null> {
  if (_windowLabelResolved) return _windowLabel
  _windowLabelResolved = true
  if (!isTauriEnv()) return null
  try {
    const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow')
    _windowLabel = getCurrentWebviewWindow().label
  } catch { /* ignore */ }
  return _windowLabel
}

export async function authGuard(
  to: RouteLocationNormalized,
  _from: RouteLocationNormalized,
) {
  const authStore = useAuthStore()

  const requiresAuth = to.matched.some(r => r.meta.requiresAuth)

  if (to.path === '/oauth/callback') return true

  const label = await getWindowLabel()
  if (label?.startsWith('detach-assistant-') && !to.path.startsWith('/detach/assistant')) {
    return '/detach/assistant'
  }

  // Detach windows inherit the main window's session via auth.json.
  // Same rationale as runner/preview — no Touch ID prompt per open.
  if (label?.startsWith('detach-assistant-') && to.path.startsWith('/detach/assistant')) {
    if (!authStore.isAuthenticated) {
      await authStore.hydrateAuthState({ skipBiometric: true })
    }
    return true
  }

  const isRunnerWindow = label === 'space-runner' || !!label?.startsWith('runner-')
  if (isRunnerWindow && !to.path.startsWith('/runner')) {
    // Extract space name from window label (runner-{spaceName}) and redirect
    // to the correct runner route. The hash-based router can't recover the
    // original URL from window.location since pathname is always '/'.
    const spaceFromLabel = label?.replace('runner-', '') || ''
    return spaceFromLabel ? `/runner/${spaceFromLabel}` : '/runner'
  }
  if (isRunnerWindow && to.path.startsWith('/runner')) {
    // Preview/popout windows need the user's auth token too — spaces that
    // talk to the Graph server (or any authenticated backend) rely on
    // `window.construct.auth.getAccessToken()` via the space host, which
    // reads from this store. Without this hydrate the runner window stays
    // unauthenticated and Graph requests fail with 401.
    // skipBiometric: the main window already unlocked and wrote auth.json;
    // child windows inherit the session via the file instead of
    // prompting Touch ID on every open.
    if (!authStore.isAuthenticated) {
      await authStore.hydrateAuthState({ skipBiometric: true })
    }
    return true
  }

  // Space Preview windows (label `preview-<spaceId>`) load at /preview/*.
  // Same rationale as runner: spaces use window.construct.auth to reach
  // the Graph server and other authenticated APIs, which resolves via
  // the auth store and by reading auth.json directly. The store must be
  // hydrated or getUserId() returns null and the space renders as signed
  // out even when the main window is logged in.
  const isPreviewWindow = !!label?.startsWith('preview-')
  if (isPreviewWindow && to.path.startsWith('/preview')) {
    if (!authStore.isAuthenticated) {
      await authStore.hydrateAuthState({ skipBiometric: true })
    }
    return true
  }

  // No profiles = no account yet → must log in (except on login/register/oauth pages).
  // Ensure the profile store has loaded before we read hasProfiles — otherwise
  // a fresh sign-in race (OAuth callback → router.replace('/app')) bounces
  // back to /login because the store hadn't populated yet.
  const profileStore = useProfileStore()
  if (!profileStore.initialized) {
    await profileStore.init()
  }
  const guestOnlyRoutes = ['/login', '/register', '/forgot-password', '/reset-password']
  if (!profileStore.hasProfiles && !guestOnlyRoutes.includes(to.path) && to.path !== '/oauth/callback') {
    return '/login'
  }

  // Don't auto-hydrate (and thereby auto-trigger Touch ID) when the user
  // has explicitly landed on a guest route. Right after a soft logout
  // the sidebar routes to /login, and firing the biometric prompt here
  // would undo the logout the user just asked for. The Touch ID button
  // on the login page stays available for when they want it. Auto-hydrate
  // still runs on boot (via authStore.initialize in bootstrapMain) and on
  // any protected-route navigation.
  //
  // Secondary main windows (popouts with label main-<purpose>) must NOT
  // prompt biometric — they inherit the primary window's already-
  // unlocked session through auth.json on disk. Otherwise every detach
  // click fires Touch ID. Only `main` (unlabelled primary) and the
  // non-Tauri dev browser should ever prompt from the guard.
  const isSecondaryMainWindow = !!label?.startsWith('main-')
  if (!authStore.isAuthenticated && !guestOnlyRoutes.includes(to.path)) {
    await authStore.hydrateAuthState({ skipBiometric: isSecondaryMainWindow })
  }

  // An unauthenticated user landing on forgot/reset is expected — they don't
  // have tokens yet. Only bounce authenticated users off /login and /register.
  // Exceptions:
  //   ?switch=1  — Sidebar's "Switch Profile": the user wants the picker rail.
  //   ?add=1     — Picker's "Add account": the user wants the login form to
  //                sign into a different identity while keeping the current
  //                session alive.
  const bounceIfAuthed = ['/login', '/register']
  const intent = to.query.switch === '1' || to.query.add === '1'
  if (authStore.isAuthenticated && bounceIfAuthed.includes(to.path) && !intent) return '/app'
  if (!authStore.isAuthenticated && requiresAuth) return '/login'
  if (to.path === '/') return authStore.isAuthenticated ? '/app' : '/login'

  const userId = authStore.user?.id || authStore.user?.email || 'unknown'
  const completed = authStore.isAuthenticated ? await isOnboardingComplete(userId) : false

  if (authStore.isAuthenticated && to.path.startsWith('/app') && !completed) {
    return '/onboarding'
  }

  if (authStore.isAuthenticated && to.path === '/onboarding' && completed) {
    return '/app'
  }

  // Developer portal gate — keeps non-developers off /app/developer when
  // they arrive via a deeplink. The sidebar already hides the entry, so
  // this only catches direct-URL navigation. Same logic as
  // useDeveloperGate (kept inline to avoid a guard ↔ composable cycle).
  if (to.matched.some(r => r.meta.requiresDeveloper)) {
    const { useOrgStore } = await import('@/stores/org')
    const orgStore = useOrgStore()
    let allowed: boolean
    if (orgStore.isEnabled) {
      // Org projects require BOTH org and developer — setting up an org
      // alone does not grant access (mirrors useDeveloperGate's org gate).
      const { useOrgPermissions } = await import('@/spaces/org/composables/useOrgPermissions')
      allowed = authStore.isDeveloper && useOrgPermissions().hasPermission('projects.create')
    } else {
      allowed = authStore.isDeveloper
    }
    if (!allowed) return '/app'
  }

  return true
}
