import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const connectMock = vi.fn()
const listProvidersMock = vi.fn()
const brainConnected = ref(false)
let initialProviders: Array<Record<string, unknown>> | null = null

const catalogState = vi.hoisted(() => ({
  providers: [] as Array<Record<string, unknown>>,
}))

function createStorage() {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() { return store.size },
  }
}

vi.mock('@/brain', () => ({
  useBrain: () => ({
    isTauri: ref(true),
    connected: brainConnected,
    connect: connectMock,
    listProviders: listProvidersMock,
  }),
}))

vi.mock('@/composables/useProviderCatalog', () => ({
  useProviderCatalog: () => ({
    catalog: {
      get value() { return catalogState.providers },
      set value(next) { catalogState.providers = next },
    },
    load: vi.fn(async () => {}),
  }),
}))

async function createAIModel() {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    value: undefined,
    configurable: true,
    writable: true,
  })
  const { useAIModel } = await import('./useAIModel')
  const aiModel = useAIModel()
  if (windowDescriptor) {
    Object.defineProperty(globalThis, 'window', windowDescriptor)
  }

  if (!initialProviders) {
    initialProviders = JSON.parse(JSON.stringify(aiModel.providers.value))
  }

  aiModel.providers.value = JSON.parse(JSON.stringify(initialProviders))
  aiModel.defaultModelId.value = ''
  aiModel.loading.value = false
  aiModel.initialized.value = false

  return aiModel
}

describe('useAIModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    brainConnected.value = false
    connectMock.mockResolvedValue(true)
    listProvidersMock.mockResolvedValue({
      providers: [],
      default: '',
      defaultProvider: '',
      defaultModel: '',
    })
    initialProviders = null
    catalogState.providers = []
    Object.defineProperty(globalThis, 'localStorage', {
      value: createStorage(),
      configurable: true,
      writable: true,
    })
    localStorage.clear()
  })

  it('does not auto-connect the operator while loading providers', async () => {
    const aiModel = await createAIModel()

    await aiModel.loadProviders(0)

    expect(connectMock).not.toHaveBeenCalled()
    expect(listProvidersMock).not.toHaveBeenCalled()
    expect(aiModel.providers.value.length).toBeGreaterThan(0)
  })

  it('connects and reloads providers when explicitly requested by user action', async () => {
    connectMock.mockImplementation(async () => {
      brainConnected.value = true
      return true
    })
    listProvidersMock.mockResolvedValue({
      providers: [
        {
          id: 'openai-oauth',
          label: 'OpenAI',
          authType: 'oauth',
          connected: true,
          models: [
            { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
          ],
        },
      ],
      default: '',
      defaultProvider: '',
      defaultModel: '',
    })
    const aiModel = await createAIModel()

    await aiModel.loadProviders(0, undefined, { connect: true })

    expect(connectMock).toHaveBeenCalledOnce()
    expect(listProvidersMock).toHaveBeenCalledOnce()
    expect(aiModel.allModels.value.some(model => model.id === 'openai-oauth:gpt-5.4-mini' && model.active)).toBe(true)
  })

  it('keeps catalog models when active operator metadata is stale', async () => {
    brainConnected.value = true
    catalogState.providers = [
      {
        id: 'openai',
        label: 'OpenAI',
        authType: 'api',
        models: [
          { id: 'gpt-5.5', label: 'GPT-5.5' },
          { id: 'gpt-5.4', label: 'GPT-5.4' },
        ],
      },
    ]
    listProvidersMock.mockResolvedValue({
      providers: [
        {
          id: 'openai',
          label: 'OpenAI',
          authType: 'api',
          connected: true,
          models: [
            { id: 'gpt-5.4', label: 'GPT-5.4' },
          ],
        },
      ],
      default: '',
      defaultProvider: '',
      defaultModel: '',
    })

    const aiModel = await createAIModel()
    await aiModel.loadProviders(0)

    expect(aiModel.allModels.value.some(model => model.id === 'openai:gpt-5.5' && model.active)).toBe(true)
  })

  it('does not expose runtime-only models when the managed catalog has a provider model list', async () => {
    brainConnected.value = true
    catalogState.providers = [
      {
        id: 'deepseek',
        label: 'DeepSeek',
        authType: 'api',
        models: [
          { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
          { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
        ],
      },
    ]
    listProvidersMock.mockResolvedValue({
      providers: [
        {
          id: 'deepseek',
          label: 'DeepSeek',
          authType: 'api',
          connected: true,
          models: [
            { id: 'deepseek-chat', label: 'DeepSeek Chat' },
            { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner' },
          ],
        },
      ],
      default: '',
      defaultProvider: '',
      defaultModel: '',
    })

    const aiModel = await createAIModel()
    await aiModel.loadProviders(0)

    expect(aiModel.allModels.value.some(model => model.id === 'deepseek:deepseek-v4-pro' && model.active)).toBe(true)
    expect(aiModel.allModels.value.some(model => model.id === 'deepseek:deepseek-chat')).toBe(false)
    expect(aiModel.allModels.value.some(model => model.id === 'deepseek:deepseek-reasoner')).toBe(false)
  })

  it('defaults to the free Z.AI GLM-4.7 Flash model when available', async () => {
    brainConnected.value = true
    catalogState.providers = [
      {
        id: 'anthropic',
        label: 'Anthropic',
        authType: 'api',
        models: [
          { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
        ],
      },
      {
        id: 'zai',
        label: 'Z.AI',
        authType: 'api',
        models: [
          { id: 'GLM-4.7-Flash', label: 'GLM-4.7-Flash' },
          { id: 'glm-5', label: 'GLM-5' },
        ],
      },
    ]
    listProvidersMock.mockResolvedValue({
      providers: [
        {
          id: 'anthropic',
          label: 'Anthropic',
          authType: 'api',
          connected: true,
          models: [
            { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
          ],
        },
        {
          id: 'zai',
          label: 'Z.AI',
          authType: 'api',
          connected: true,
          models: [
            { id: 'GLM-4.7-Flash', label: 'GLM-4.7-Flash' },
          ],
        },
      ],
      default: '',
      defaultProvider: '',
      defaultModel: '',
    })

    const aiModel = await createAIModel()
    await aiModel.loadProviders(0)

    expect(aiModel.defaultModelId.value).toBe('zai:GLM-4.7-Flash')
  })

  it('keeps placeholder providers inactive until live provider data loads', async () => {
    const aiModel = await createAIModel()

    expect(aiModel.providers.value.length).toBeGreaterThan(0)
    expect(aiModel.providers.value.every(provider => provider.active === false)).toBe(true)
  })

  it('remaps stored provider-prefixed models to an available runtime provider from the same family', async () => {
    const aiModel = await createAIModel()

    aiModel.providers.value = [
      {
        id: 'openrouter',
        label: 'OpenRouter',
        authType: 'api',
        active: true,
        models: [
          { id: 'openrouter/free', label: 'OpenRouter Free' },
        ],
      },
      {
        id: 'openai-oauth',
        label: 'OpenAI',
        authType: 'oauth',
        active: true,
        models: [
          { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
        ],
      },
    ]

    expect(aiModel.resolveModelId('openai:gpt-5.3-codex', { allowAuto: false }))
      .toBe('openai-oauth:gpt-5.3-codex')
  })

  it('remaps stale inactive exact matches to the first active model from the same family', async () => {
    const aiModel = await createAIModel()

    aiModel.providers.value = [
      {
        id: 'openrouter',
        label: 'OpenRouter',
        authType: 'api',
        active: true,
        models: [
          { id: 'openrouter/free', label: 'OpenRouter Free' },
        ],
      },
      {
        id: 'openai-oauth',
        label: 'OpenAI',
        authType: 'oauth',
        active: true,
        models: [
          { id: 'gpt-5.4', label: 'GPT-5.4' },
          { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
        ],
      },
      {
        id: 'openai',
        label: 'OpenAI',
        authType: 'api',
        active: false,
        models: [
          { id: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark' },
        ],
      },
    ]

    expect(aiModel.resolveModelId('openai:gpt-5.3-codex-spark', { allowAuto: false }))
      .toBe('openai-oauth:gpt-5.4')
  })

  it('picks a cheap default for a newly connected OpenAI provider when no model is set', async () => {
    brainConnected.value = true
    listProvidersMock.mockResolvedValue({
      providers: [
        {
          id: 'openrouter',
          label: 'OpenRouter',
          authType: 'api',
          connected: true,
          models: [
            { id: 'openai/gpt-4.1-mini:free', label: 'GPT-4.1 Mini Free' },
          ],
        },
        {
          id: 'openai-oauth',
          label: 'OpenAI',
          authType: 'oauth',
          connected: true,
          models: [
            { id: 'gpt-5.4', label: 'GPT-5.4' },
            { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
            { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
          ],
        },
      ],
      default: '',
      defaultProvider: '',
      defaultModel: '',
    })

    const aiModel = await createAIModel()

    aiModel.defaultModelId.value = ''
    await aiModel.loadProviders(0, 'openai-codex')

    expect(aiModel.defaultModelId.value).toBe('openai-oauth:gpt-5.4-mini')
  })

  it('clears the default when its provider family disconnects and nothing equivalent is active', async () => {
    brainConnected.value = true
    listProvidersMock.mockResolvedValue({
      providers: [
        {
          id: 'openrouter',
          label: 'OpenRouter',
          authType: 'api',
          connected: true,
          models: [
            { id: 'openai/gpt-4.1-mini:free', label: 'GPT-4.1 Mini Free' },
          ],
        },
      ],
      default: '',
      defaultProvider: '',
      defaultModel: '',
    })

    const aiModel = await createAIModel()

    aiModel.defaultModelId.value = 'openai:gpt-5.3-codex-spark'
    await aiModel.loadProviders(0)

    expect(aiModel.defaultModelId.value).toBe('')
  })

  it('prefers the explicit OpenRouter fallback model over the first sorted free model', async () => {
    const aiModel = await createAIModel()

    aiModel.providers.value = [
      {
        id: 'openrouter',
        label: 'OpenRouter',
        authType: 'api',
        active: true,
        models: [
          { id: 'arcee-ai/trinity-large-preview:free', label: 'Arcee AI Trinity Large Preview' },
          { id: 'openrouter/free', label: 'Free Models Router' },
          { id: 'qwen/qwen3-next-80b-a3b-instruct:free', label: 'Qwen3 Next 80B A3B Instruct' },
        ],
      },
    ]

    expect(aiModel.resolveModelId('', { allowAuto: false }))
      .toBe('openrouter:openrouter/free')
  })

  it('reloads stored model state when the active profile changes', async () => {
    const { setActiveProfileId } = await import('@/lib/profileStorage')
    Object.defineProperty(globalThis, 'window', {
      value: globalThis,
      configurable: true,
      writable: true,
    })

    localStorage.setItem('profile-a:cp_default_ai_model', 'anthropic:claude-sonnet-4-6')
    localStorage.setItem('profile-b:cp_default_ai_model', 'openai:gpt-5.4-mini')

    setActiveProfileId('profile-a')
    const aiModel = await createAIModel()

    aiModel.resetForActiveProfile('profile-a')
    expect(aiModel.defaultModelId.value).toBe('anthropic:claude-sonnet-4-6')

    setActiveProfileId('profile-b')
    aiModel.syncActiveProfileState()

    expect(aiModel.defaultModelId.value).toBe('openai:gpt-5.4-mini')
    expect(aiModel.providers.value.every(provider => provider.active === false)).toBe(true)
  })
})
