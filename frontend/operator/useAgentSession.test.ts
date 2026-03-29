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
    dispatchMock.mockResolvedValue({
      agent_id: 'general',
      session_id: 'session-1',
      content: 'fallback result',
      turns: 1,
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: 'end_turn',
    })
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
      {},
      expect.any(Function),
    )
  })

  it('normalizes assistant.v1 sync results into response blocks instead of showing raw JSON', async () => {
    dispatchStreamMock.mockRejectedValueOnce(new Error('stream unavailable'))
    dispatchMock.mockResolvedValueOnce({
      agent_id: 'general',
      session_id: 'session-2',
      content: JSON.stringify({
        version: 'assistant.v1',
        state: 'ok',
        provider: 'openai',
        content: {
          summary: 'Ready to build.',
          blocks: [
            { type: 'markdown', text: 'Here is the plan.' },
            {
              type: 'steps',
              items: [
                { title: 'Inspect repo', status: 'done' },
                { title: 'Implement change', status: 'doing', body: 'Update the UI contract' },
              ],
            },
            {
              type: 'kv',
              items: [
                { label: 'Agent', value: 'general' },
              ],
            },
          ],
        },
      }),
      turns: 2,
      usage: { input_tokens: 5, output_tokens: 7 },
      stop_reason: 'end_turn',
    })

    const { useAgentSession } = await import('./useAgentSession')
    const session = useAgentSession()

    await session.send([{ type: 'text', content: 'hello' }])

    expect(dispatchMock).toHaveBeenCalledWith(
      'general',
      'hello',
      'openai-oauth:gpt-5.3-codex',
      {},
    )

    expect(session.turns.value).toHaveLength(1)
    expect(session.turns.value[0]?.response).toEqual([
      { type: 'text', content: 'Ready to build.' },
      { type: 'text', content: 'Here is the plan.' },
      {
        type: 'tasklist',
        tasks: [
          { id: 'step-1', title: 'Inspect repo', status: 'done' },
          { id: 'step-2', title: 'Implement change', description: 'Update the UI contract', status: 'running' },
        ],
      },
      {
        type: 'table',
        headers: ['Label', 'Value'],
        rows: [['Agent', 'general']],
      },
    ])
  })
})
