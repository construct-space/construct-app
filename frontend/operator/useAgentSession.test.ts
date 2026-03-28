import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const dispatchStreamMock = vi.fn()
const dispatchMock = vi.fn()
const loadProvidersMock = vi.fn()
const resolveModelIdMock = vi.fn()

vi.mock('./client', () => ({
  useOperator: () => ({
    dispatchStream: dispatchStreamMock,
    dispatch: dispatchMock,
    stopStream: vi.fn(),
    send: vi.fn(),
    connected: ref(true),
  }),
}))

vi.mock('./useStreamStatus', () => ({
  useStreamStatus: () => ({
    status: ref('idle'),
    statusMessage: ref(''),
    isActive: ref(false),
    toolHistory: ref([]),
    reset: vi.fn(),
    handleChunk: vi.fn(),
    handleDone: vi.fn(),
    handleError: vi.fn(),
  }),
}))

vi.mock('./useAssistant', () => ({
  showAssistant: ref(false),
}))

vi.mock('@/composables/useAIModel', () => ({
  useAIModel: () => ({
    defaultModelId: ref('openai:gpt-5.3-codex'),
    resolveModelId: resolveModelIdMock,
    loadProviders: loadProvidersMock,
  }),
}))

describe('useAgentSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadProvidersMock.mockResolvedValue(undefined)
    resolveModelIdMock.mockReturnValue('openai-oauth:gpt-5.3-codex')
    dispatchStreamMock.mockResolvedValue(() => {})
  })

  it('sends the resolved model instead of the raw stored model id', async () => {
    const { useAgentSession } = await import('./useAgentSession')
    const session = useAgentSession()

    await session.send([{ type: 'text', content: 'hello' }])

    expect(loadProvidersMock).toHaveBeenCalled()
    expect(resolveModelIdMock).toHaveBeenCalledWith('openai:gpt-5.3-codex', { allowAuto: false })
    expect(dispatchStreamMock).toHaveBeenCalledWith(
      'general',
      'hello',
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      'openai-oauth:gpt-5.3-codex',
      undefined,
      expect.any(Function),
    )
  })
})
