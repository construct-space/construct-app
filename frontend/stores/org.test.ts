import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const sourceMock = vi.hoisted(() => ({
  get: vi.fn(),
}))

vi.mock('@/composables/useSource', () => ({
  useSource: () => ({
    get: sourceMock.get,
    post: vi.fn(async () => ({})),
    put: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  }),
}))

describe('org store managed settings', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    sourceMock.get.mockReset()
    const storage = new Map<string, string>()
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => { storage.set(key, value) },
        removeItem: (key: string) => { storage.delete(key) },
        clear: () => { storage.clear() },
      },
      configurable: true,
    })
  })

  it('fetches managed provider keys even when the local org cache is not enabled yet', async () => {
    sourceMock.get.mockResolvedValue({
      org_id: 'org-1',
      org_name: 'Construct',
      manageable: false,
      providers: [{ id: 'key-1', provider: 'zai', set_by: 'admin' }],
      settings: {},
    })

    const { useOrgStore } = await import('./org')
    const store = useOrgStore()

    expect(store.isEnabled).toBe(false)

    await store.fetchManagedSettings()

    expect(sourceMock.get).toHaveBeenCalledWith('/org/managed-settings')
    expect(store.isEnabled).toBe(true)
    expect(store.orgId).toBe('org-1')
    expect(store.managedProviders).toEqual([{ id: 'key-1', provider: 'zai', set_by: 'admin' }])
  })
})
