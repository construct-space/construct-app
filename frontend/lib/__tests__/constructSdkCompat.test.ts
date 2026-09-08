import { describe, expect, it, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

describe('construct SDK compatibility helpers', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('exposes useToast with direct methods and the legacy toast wrapper', async () => {
    const sdk = await import('../constructSdkCompat')

    const toasts = sdk.useToast()

    expect(typeof toasts.success).toBe('function')
    expect(typeof toasts.error).toBe('function')
    expect(typeof toasts.warning).toBe('function')
    expect(typeof toasts.info).toBe('function')
    expect(typeof toasts.toast.success).toBe('function')
  })

  it('exposes useAuth().user as both ref-like and direct-property compatible', async () => {
    const sdk = await import('../constructSdkCompat')
    const auth = sdk.useAuth()

    auth.$patch({
      user: { id: 'user-1', email: 'user@example.com', name: 'User One' },
      isAuthenticated: true,
    })

    expect(auth.user.value?.id).toBe('user-1')
    expect(auth.user.id).toBe('user-1')
  })
})
