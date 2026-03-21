import type { NavigationGuardNext, RouteLocationNormalized } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { isTauriEnv } from '@/utils/tauri'

// Cache the resolved window label (async, so resolved once on first guard call)
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
  next: NavigationGuardNext
) {
  const authStore = useAuthStore()

  const requiresAuth = to.matched.some(r => r.meta.requiresAuth)

  // OAuth callback must ALWAYS be accessible (deep link from browser)
  if (to.path === '/oauth/callback') {
    return next()
  }

  // Popout windows: detect by Tauri window label and redirect to the correct route.
  // Tauri WebviewWindow can't pass hash fragments in URLs, so we detect the label instead.
  const label = await getWindowLabel()
  if (label === 'standalone-assistant' && to.path !== '/assistant') {
    // Context (project, space) is sent via Tauri emitTo() events after window opens.
    localStorage.removeItem('construct_popout_route')
    return next('/assistant')
  }

  // Hydrate auth if not yet authenticated
  if (!authStore.isAuthenticated) {
    await authStore.hydrateAuthState()
  }

  // Authenticated user hitting guest-only routes → redirect to /app
  const guestOnlyRoutes = ['/login', '/register']
  if (authStore.isAuthenticated && guestOnlyRoutes.includes(to.path)) {
    return next('/app')
  }

  // Unauthenticated user hitting protected routes → redirect to /login
  if (!authStore.isAuthenticated && requiresAuth) {
    return next('/login')
  }

  // Root → redirect based on auth state
  if (to.path === '/') {
    return next(authStore.isAuthenticated ? '/app' : '/login')
  }

  // Per-user onboarding key (so switching accounts triggers onboarding again)
  const userId = authStore.user?.id || authStore.user?.email || 'unknown'
  const onboardingKey = `cp_onboarding_complete:${userId}`

  // Onboarding check: authenticated + navigating to app + not yet onboarded → redirect
  if (
    authStore.isAuthenticated &&
    to.path.startsWith('/app') &&
    !localStorage.getItem(onboardingKey)
  ) {
    return next('/onboarding')
  }

  // If on onboarding page but already completed, redirect to app
  if (
    authStore.isAuthenticated &&
    to.path === '/onboarding' &&
    localStorage.getItem(onboardingKey)
  ) {
    return next('/app')
  }

  next()
}
