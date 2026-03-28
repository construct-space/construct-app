import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const connectMock = vi.fn()
const listProvidersMock = vi.fn()
const operatorConnected = ref(false)
let initialProviders: Array<Record<string, unknown>> | null = null

vi.mock('@/operator', () => ({
  useOperator: () => ({
    isTauri: ref(true),
    connected: operatorConnected,
    connect: connectMock,
    listProviders: listProvidersMock,
  }),
}))

async function createAIModel() {
  const { useAIModel } = await import('./useAIModel')
  const aiModel = useAIModel()

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
    operatorConnected.value = false
    connectMock.mockResolvedValue(true)
    listProvidersMock.mockResolvedValue({
      providers: [],
      default: '',
      defaultProvider: '',
      defaultModel: '',
    })
  })

  it('does not auto-connect the operator while loading providers', async () => {
    const aiModel = await createAIModel()

    await aiModel.loadProviders(0)

    expect(connectMock).not.toHaveBeenCalled()
    expect(listProvidersMock).not.toHaveBeenCalled()
    expect(aiModel.providers.value.length).toBeGreaterThan(0)
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
    operatorConnected.value = true
    listProvidersMock.mockResolvedValue({
      providers: [
        {
          id: 'openrouter',
          label: 'OpenRouter',
          authType: 'api',
          models: [
            { id: 'openai/gpt-4.1-mini:free', label: 'GPT-4.1 Mini Free' },
          ],
        },
        {
          id: 'openai-oauth',
          label: 'OpenAI',
          authType: 'oauth',
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
    operatorConnected.value = true
    listProvidersMock.mockResolvedValue({
      providers: [
        {
          id: 'openrouter',
          label: 'OpenRouter',
          authType: 'api',
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
})
