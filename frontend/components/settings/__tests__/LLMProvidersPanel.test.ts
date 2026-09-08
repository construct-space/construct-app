import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import LLMProvidersPanel from '../LLMProvidersPanel.vue'
import type { AIProvider } from '@/brain/types'

const mocks = vi.hoisted(() => ({
  catalogProviders: [] as AIProvider[],
  catalogLoad: vi.fn(async () => {}),
  kvGet: vi.fn(async () => null),
  brainRequest: vi.fn(async (method: string) => {
    if (method === 'oauth.providers') return { providers: [] }
    return { value: '' }
  }),
  orgStore: {
    isEnabled: true,
    managedProviders: [] as Array<{ id: string; provider: string; set_by: string }>,
    fetchManagedSettings: vi.fn(async () => {}),
  },
}))

vi.mock('@/composables/useProviderCatalog', () => ({
  useProviderCatalog: () => ({
    catalog: {
      get value() { return mocks.catalogProviders },
    },
    load: mocks.catalogLoad,
  }),
}))

vi.mock('@/composables/useContextDB', () => ({
  useContextDB: () => ({
    kvGet: mocks.kvGet,
  }),
}))

vi.mock('@/brain', () => ({
  useBrain: () => ({
    request: mocks.brainRequest,
  }),
}))

vi.mock('@/stores/org', () => ({
  useOrgStore: () => mocks.orgStore,
}))

vi.mock('@/components/settings/providers', () => ({
  resolveProviderCard: () => ({
    props: ['provider'],
    template: '<div>{{ provider.id }} {{ provider.orgManaged ? "org-managed" : "local" }}</div>',
  }),
}))

vi.mock('@/composables/useProviderCard', () => ({
  configuredVersion: { __v_isRef: true, value: 0 },
}))

describe('LLMProvidersPanel', () => {
  beforeEach(() => {
    mocks.catalogProviders = []
    mocks.catalogLoad.mockClear()
    mocks.kvGet.mockClear()
    mocks.brainRequest.mockClear()
    mocks.orgStore.isEnabled = true
    mocks.orgStore.managedProviders = []
    mocks.orgStore.fetchManagedSettings.mockClear()
    // The component's loadConstruct() hits my.construct.space directly
    // (it's a network call, not a brain wire op). Stub fetch so jsdom
    // doesn't reject with "fetch is not defined" before onMounted
    // reaches loadOrgManagedProviders.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false } as Response)))
  })

  it('receives org-managed provider keys as configured providers even before the org cache is hydrated', async () => {
    mocks.catalogProviders = [
      {
        id: 'zai',
        label: 'Z.AI',
        authType: 'api',
        models: [],
        apiKey: { enabled: true },
      },
    ]
    mocks.orgStore.managedProviders = [
      { id: 'org-key-zai', provider: 'zai', set_by: 'admin' },
    ]
    mocks.orgStore.isEnabled = false

    const wrapper = mount(LLMProvidersPanel, {
      props: { filter: 'configured' },
    })

    await flushPromises()

    expect(mocks.orgStore.fetchManagedSettings).toHaveBeenCalled()
    expect(mocks.brainRequest).toHaveBeenCalledWith('providers.refresh', {})
    expect(wrapper.text()).toContain('zai org-managed')
  })
})
