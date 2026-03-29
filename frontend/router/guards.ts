import type { RouteLocationNormalized } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { isTauriEnv } from '@/utils/tauri'

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
  if (label === 'standalone-assistant' && to.path !== '/assistant') {
    localStorage.removeItem('construct_popout_route')
    return '/assistant'
  }

  if (!authStore.isAuthenticated) {
    await authStore.hydrateAuthState()
  }

  const guestOnlyRoutes = ['/login', '/register']
  if (authStore.isAuthenticated && guestOnlyRoutes.includes(to.path)) return '/app'
  if (!authStore.isAuthenticated && requiresAuth) return '/login'
  if (to.path === '/') return authStore.isAuthenticated ? '/app' : '/login'

  const userId = authStore.user?.id || authStore.user?.email || 'unknown'
  const onboardingKey = `cp_onboarding_complete:${userId}`

  if (authStore.isAuthenticated && to.path.startsWith('/app') && !localStorage.getItem(onboardingKey)) {
    return '/onboarding'
  }

  if (authStore.isAuthenticated && to.path === '/onboarding' && localStorage.getItem(onboardingKey)) {
    return '/app'
  }

  return true
}
