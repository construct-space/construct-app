import { describe, expect, it, beforeEach, vi } from 'vitest'
import { ref, computed } from 'vue'

// Mock constructSdk so importing spaceHost doesn't transitively load
// stores that rely on auto-imported `defineStore`. We control `useOrg`
// directly here so the scope getter can be exercised in isolation.
const isOrgRef = ref(false)
let useOrgThrows = false

vi.mock('@/lib/constructSdk', () => ({
  useAuthStore: () => ({ user: null }),
  useProjectStore: () => ({ currentProject: null }),
  useOrg: () => {
    if (useOrgThrows) throw new Error('no pinia')
    return { isOrg: computed(() => isOrgRef.value) }
  },
}))

// Stub the storage and brain dynamic imports — spaceHost lazy-loads
// these on first call, but we never call them in these tests.
vi.mock('@/brain', () => ({ useBrain: () => ({ request: async () => undefined, stream: async () => undefined }) }))
vi.mock('@/composables/useLocalStorage', () => ({
  useLocalStorage: () => ({ get: async () => null, set: async () => undefined, remove: async () => undefined }),
}))

import { initSpaceHost } from '../spaceHost'

describe('spaceHost.scope', () => {
  beforeEach(() => {
    isOrgRef.value = false
    useOrgThrows = false
    vi.unstubAllGlobals()
    initSpaceHost()
  })

  it("returns 'app' when not in org", () => {
    isOrgRef.value = false
    expect(window.construct.scope).toBe('app')
  })

  it("returns 'org' when in org", () => {
    isOrgRef.value = true
    expect(window.construct.scope).toBe('org')
  })

  it("falls back to 'app' when useOrg() throws (no active pinia)", () => {
    useOrgThrows = true
    expect(window.construct.scope).toBe('app')
  })

  it('sends the active space id on host graph requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ data: { weatherForecasts: [] } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    window.construct.space = { id: 'weather' }

    await window.construct.graph.query('{ weatherForecasts { id } }')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.construct.space/graphql',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Space-ID': 'weather',
          'X-Project-ID': 'default',
        }),
      }),
    )
  })
})
