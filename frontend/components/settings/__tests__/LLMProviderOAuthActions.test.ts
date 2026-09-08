import { flushPromises, mount } from '@vue/test-utils'
import { computed, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AnthropicCard from '../providers/AnthropicCard.vue'
import GenericCard from '../providers/GenericCard.vue'
import GoogleCard from '../providers/GoogleCard.vue'
import OpenAICard from '../providers/OpenAICard.vue'
import type { AIProvider } from '@/brain/types'

const displayModelRows = ref<Array<{ id: string; label: string; available: boolean }>>([])
const providerCardState = vi.hoisted(() => ({
  collapsed: {} as Record<string, boolean>,
}))

vi.mock('@/lib/providerLogo', () => ({
  providerLogoSvg: () => null,
  providerDescription: () => '',
}))

vi.mock('@/composables/useProviderCard', () => ({
  apiKeySlot: (providerId: string, mode = 'api_key') =>
    mode === 'monthly' ? `provider_key_monthly:${providerId}` : `provider_key:${providerId}`,
  useProviderCard: () => ({
    activeMode: () => 'monthly',
    setActiveMode: vi.fn(),
    draftRef: () => ref(''),
    visibilityRef: () => ref(false),
    isConfigured: () => false,
    loadConfigured: vi.fn(),
    saveKey: vi.fn(),
    removeKey: vi.fn(),
    isSaving: () => false,
    justSaved: () => false,
    isCollapsed: (providerId: string) => !!providerCardState.collapsed[providerId],
    setCollapsed: vi.fn(),
    toggleCollapsed: (providerId: string) => {
      providerCardState.collapsed[providerId] = !providerCardState.collapsed[providerId]
    },
  }),
}))

vi.mock('@/composables/useProviderOAuth', () => ({
  useProviderOAuth: () => ({
    loading: ref({}),
    getStatus: vi.fn().mockResolvedValue({ connected: true, email: 'user@example.com' }),
    disconnect: vi.fn(),
    start: vi.fn(),
    pollPending: vi.fn(),
    cancel: vi.fn(),
  }),
}))

vi.mock('@/composables/useAIModel', () => ({
  useAIModel: () => ({
    defaultModelId: ref(''),
    setDefaultModel: vi.fn(),
  }),
}))

vi.mock('@/composables/useLiveModels', () => ({
  useLiveModels: () => ({
    models: ref([]),
    isLoading: ref(false),
    error: ref(''),
    load: vi.fn(),
  }),
}))

vi.mock('@/composables/useDisplayModels', () => ({
  useDisplayModels: () => ({
    displayModels: displayModelRows,
    availableCount: computed(() => displayModelRows.value.filter(m => m.available).length),
  }),
}))

const providers: Array<{ name: string; component: typeof AnthropicCard; provider: AIProvider }> = [
  {
    name: 'Anthropic',
    component: AnthropicCard,
    provider: { id: 'anthropic', label: 'Anthropic', authType: 'api_key', models: [] },
  },
  {
    name: 'OpenAI',
    component: OpenAICard,
    provider: { id: 'openai', label: 'OpenAI', authType: 'api_key', models: [] },
  },
  {
    name: 'Google',
    component: GoogleCard,
    provider: { id: 'google', label: 'Google', authType: 'api_key', models: [] },
  },
]

describe('LLM provider OAuth actions', () => {
  beforeEach(() => {
    displayModelRows.value = []
    providerCardState.collapsed = {}
  })

  it.each(providers)('shows Sign out for connected $name monthly accounts', async ({ component, provider }) => {
    const wrapper = mount(component, {
      props: { provider },
      global: {
        stubs: {
          ProviderLogo: true,
        },
      },
    })

    await flushPromises()

    expect(wrapper.text()).toContain('Signed in')
    expect(wrapper.text()).toContain('Sign out')
  })

  it('treats an org-managed API key provider as configured', async () => {
    displayModelRows.value = [{ id: 'glm-5', label: 'GLM-5', available: true }]

    const wrapper = mount(GenericCard, {
      props: {
        provider: {
          id: 'zai',
          label: 'Z.AI',
          authType: 'api',
          orgManaged: true,
          models: [{ id: 'glm-5', label: 'GLM-5' }],
          apiKey: { enabled: true, baseUrl: 'https://api.z.ai/api/coding/paas/v4' },
        } as AIProvider,
      },
      global: {
        stubs: {
          ProviderLogo: true,
        },
      },
    })

    await flushPromises()

    expect(wrapper.text()).toContain('1 / 1 models available')
    expect(wrapper.text()).not.toContain('Add an API key to see available models.')
  })

  it('shows generic API-key coding plans returned by the provider catalog', async () => {
    const wrapper = mount(GenericCard, {
      props: {
        provider: {
          id: 'zai',
          label: 'Z.AI',
          authType: 'api',
          models: [],
          apiKey: { enabled: true, baseUrl: 'https://api.z.ai/api/paas/v4' },
          monthly: { enabled: true, authType: 'api_key', baseUrl: 'https://api.z.ai/api/coding/paas/v4' },
        } as AIProvider,
      },
      global: {
        stubs: {
          ProviderLogo: true,
        },
      },
    })

    await flushPromises()

    expect(wrapper.text()).toContain('API key')
    expect(wrapper.text()).toContain('Coding plan')
    expect(wrapper.text()).toContain('https://api.z.ai/api/coding/paas/v4')
  })

  it('can render a provider card as header-only when collapsed', async () => {
    providerCardState.collapsed.zai = true

    const wrapper = mount(GenericCard, {
      props: {
        provider: {
          id: 'zai',
          label: 'Z.AI',
          authType: 'api',
          models: [],
          apiKey: { enabled: true, baseUrl: 'https://api.z.ai/api/paas/v4' },
          monthly: { enabled: true, authType: 'api_key', baseUrl: 'https://api.z.ai/api/coding/paas/v4' },
        } as AIProvider,
      },
      global: {
        stubs: {
          ProviderLogo: true,
        },
      },
    })

    await flushPromises()

    expect(wrapper.text()).toContain('Z.AI')
    expect(wrapper.text()).toContain('Not set up')
    expect(wrapper.text()).not.toContain('Coding plan')
    expect(wrapper.text()).not.toContain('Add an API key to see available models.')
    expect(wrapper.get('button[aria-label="Expand Z.AI"]').exists()).toBe(true)
  })
})
