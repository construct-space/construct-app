import { beforeEach, describe, expect, it, vi } from 'vitest'

const authStore = {
  isAuthenticated: false,
  hydrateAuthState: vi.fn(async () => {}),
  user: null as { id?: string; email?: string } | null,
}

const profileStore = {
  hasProfiles: true,
}

const tauriEnvMock = {
  isTauriEnv: vi.fn(() => true),
}

const currentLabel = {
  value: 'main',
}

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => authStore,
}))

vi.mock('@/stores/profile', () => ({
  useProfileStore: () => profileStore,
}))

vi.mock('@/utils/tauri', () => tauriEnvMock)

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({ label: currentLabel.value }),
}))

describe('authGuard', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    tauriEnvMock.isTauriEnv.mockReturnValue(true)
    currentLabel.value = 'main'
    authStore.isAuthenticated = false
    authStore.user = null
    profileStore.hasProfiles = true
  })

  it('allows runner windows on runner routes and hydrates auth for Graph access', async () => {
    currentLabel.value = 'runner-coder'
    profileStore.hasProfiles = false

    const { authGuard } = await import('./guards')
    const result = await authGuard(
      { path: '/runner/coder', matched: [] } as import('vue-router').RouteLocationNormalized,
      {} as import('vue-router').RouteLocationNormalized,
    )

    expect(result).toBe(true)
    // Runner windows need the user's token for Graph requests; guard
    // hydrates from shared auth.json when the store is empty.
    expect(authStore.hydrateAuthState).toHaveBeenCalledTimes(1)
  })

  it('skips hydration on runner routes when already authenticated', async () => {
    currentLabel.value = 'runner-coder'
    authStore.isAuthenticated = true

    const { authGuard } = await import('./guards')
    const result = await authGuard(
      { path: '/runner/coder', matched: [] } as import('vue-router').RouteLocationNormalized,
      {} as import('vue-router').RouteLocationNormalized,
    )

    expect(result).toBe(true)
    expect(authStore.hydrateAuthState).not.toHaveBeenCalled()
  })

  it('redirects runner windows back to their runner route when they drift', async () => {
    currentLabel.value = 'runner-coder'

    const { authGuard } = await import('./guards')
    const result = await authGuard(
      { path: '/app', matched: [] } as import('vue-router').RouteLocationNormalized,
      {} as import('vue-router').RouteLocationNormalized,
    )

    expect(result).toBe('/runner/coder')
  })
})
