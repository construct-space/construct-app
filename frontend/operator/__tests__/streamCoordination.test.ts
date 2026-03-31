import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, nextTick } from 'vue'
import {
  STREAMABLE_BLOCK_TYPES,
  BUFFERED_BLOCK_TYPES,
  isStreamSafe,
  requiresBuffering,
} from '@/assistant/streamClassification'
import type { StreamRenderState, Turn, TurnStreamState, ResponseBlock } from '@/assistant'

// ─── Slice A: Stream Classification ───

describe('streamClassification', () => {
  describe('STREAMABLE_BLOCK_TYPES', () => {
    it('includes text, code, tool, status, error', () => {
      expect(STREAMABLE_BLOCK_TYPES.has('text')).toBe(true)
      expect(STREAMABLE_BLOCK_TYPES.has('code')).toBe(true)
      expect(STREAMABLE_BLOCK_TYPES.has('tool')).toBe(true)
      expect(STREAMABLE_BLOCK_TYPES.has('status')).toBe(true)
      expect(STREAMABLE_BLOCK_TYPES.has('error')).toBe(true)
    })

    it('does not include structured types', () => {
      expect(STREAMABLE_BLOCK_TYPES.has('question')).toBe(false)
      expect(STREAMABLE_BLOCK_TYPES.has('plan')).toBe(false)
      expect(STREAMABLE_BLOCK_TYPES.has('architect:questions')).toBe(false)
    })
  })

  describe('BUFFERED_BLOCK_TYPES', () => {
    it('includes architect custom blocks', () => {
      expect(BUFFERED_BLOCK_TYPES.has('architect:questions')).toBe(true)
      expect(BUFFERED_BLOCK_TYPES.has('architect:plan')).toBe(true)
      expect(BUFFERED_BLOCK_TYPES.has('architect:progress')).toBe(true)
    })

    it('includes structured types that need full data', () => {
      expect(BUFFERED_BLOCK_TYPES.has('question')).toBe(true)
      expect(BUFFERED_BLOCK_TYPES.has('plan')).toBe(true)
      expect(BUFFERED_BLOCK_TYPES.has('tasklist')).toBe(true)
      expect(BUFFERED_BLOCK_TYPES.has('progress')).toBe(true)
      expect(BUFFERED_BLOCK_TYPES.has('table')).toBe(true)
      expect(BUFFERED_BLOCK_TYPES.has('json')).toBe(true)
    })
  })

  describe('isStreamSafe', () => {
    it('returns true for streamable types', () => {
      expect(isStreamSafe('text')).toBe(true)
      expect(isStreamSafe('code')).toBe(true)
      expect(isStreamSafe('tool')).toBe(true)
    })

    it('returns false for buffered types', () => {
      expect(isStreamSafe('architect:questions')).toBe(false)
      expect(isStreamSafe('architect:plan')).toBe(false)
      expect(isStreamSafe('question')).toBe(false)
      expect(isStreamSafe('plan')).toBe(false)
      expect(isStreamSafe('json')).toBe(false)
    })

    it('returns false for unknown custom (namespaced) blocks', () => {
      expect(isStreamSafe('myspace:widget')).toBe(false)
      expect(isStreamSafe('custom:anything')).toBe(false)
    })

    it('returns true for unknown non-namespaced types (text-like)', () => {
      expect(isStreamSafe('unknowntype')).toBe(true)
    })
  })

  describe('requiresBuffering', () => {
    it('returns true for architect assistant type', () => {
      expect(requiresBuffering('architect')).toBe(true)
    })

    it('returns false for general assistant type', () => {
      expect(requiresBuffering('general')).toBe(false)
    })

    it('returns false for unknown assistant type', () => {
      expect(requiresBuffering('unknown')).toBe(false)
    })
  })
})

// ─── Slice B & C: Buffer Accumulation, Normalization, StreamRenderState ───

// Mock the operator module
const dispatchStreamMock = vi.fn()
const dispatchMock = vi.fn()
const loadProvidersMock = vi.fn()
const resolveModelIdMock = vi.fn()

vi.mock('@/operator/client', () => ({
  useOperator: () => ({
    dispatchStream: dispatchStreamMock,
    dispatch: dispatchMock,
    stopStream: vi.fn(),
    send: vi.fn(),
    connected: ref(true),
  }),
}))

vi.mock('@/operator/useStreamStatus', () => ({
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

vi.mock('@/operator/useAssistant', () => ({
  showAssistant: ref(false),
}))

vi.mock('@/composables/useAIModel', () => ({
  useAIModel: () => ({
    defaultModelId: ref('openai:gpt-5.3-codex'),
    resolveModelId: resolveModelIdMock,
    loadProviders: loadProvidersMock,
  }),
}))

describe('stream coordination in useAgentSession', () => {
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

  describe('buffer accumulation during streaming', () => {
    it('buffers JSON content when assistantType requires buffering', async () => {
      let onChunk: (chunk: any) => void
      let onDone: (result: any) => void

      dispatchStreamMock.mockImplementation(
        (_agent: string, _task: string, chunkCb: Function, doneCb: Function) => {
          onChunk = chunkCb as any
          onDone = doneCb as any
          return Promise.resolve(() => {})
        },
      )

      const { useAgentSession } = await import('@/operator/useAgentSession')
      const session = useAgentSession()

      // Start a send with architect assistantType
      const sendPromise = session.send(
        [{ type: 'text', content: 'plan my app' }],
        { assistantType: 'architect' },
      )

      await nextTick()

      // Send JSON chunks
      onChunk!({ content: '{"version":', type: 'stream', done: false, data: {} })
      onChunk!({ content: '"architect.v1",', type: 'stream', done: false, data: {} })
      onChunk!({ content: '"state":"questions"', type: 'stream', done: false, data: {} })

      // The turn should be buffering — no text blocks visible, just status placeholder
      const turn = session.turns.value[0]!
      expect(turn.streamState?.isBuffering).toBe(true)
      expect(turn.streamState?.renderState).toBe('buffering')
      expect(turn.streamState?.bufferContent).toContain('{"version":')
      expect(turn.streamState?.bufferContent).toContain('"architect.v1",')

      // No text blocks should be in the response
      const textBlocks = turn.response.filter(b => b.type === 'text')
      expect(textBlocks).toHaveLength(0)

      // There should be a status placeholder
      const statusBlocks = turn.response.filter(b => b.type === 'status')
      expect(statusBlocks).toHaveLength(1)

      // Complete the stream
      onDone!({
        agent_id: 'architect',
        session_id: 'sess-1',
        content: JSON.stringify({
          version: 'architect.v1',
          state: 'questions',
          questions: [{
            id: 'scope',
            question: 'What are we building?',
            type: 'single',
            options: [{ value: 'web', label: 'Web app' }],
          }],
        }),
        turns: 1,
      })

      await sendPromise
    })

    it('accumulates buffer content across multiple stream chunks', async () => {
      let onChunk: (chunk: any) => void
      let onDone: (result: any) => void

      dispatchStreamMock.mockImplementation(
        (_agent: string, _task: string, chunkCb: Function, doneCb: Function) => {
          onChunk = chunkCb as any
          onDone = doneCb as any
          return Promise.resolve(() => {})
        },
      )

      const { useAgentSession } = await import('@/operator/useAgentSession')
      const session = useAgentSession()

      const sendPromise = session.send(
        [{ type: 'text', content: 'plan' }],
        { assistantType: 'architect' },
      )

      await nextTick()

      // Send many small JSON chunks
      const chunks = ['{"v', 'ersi', 'on":', '"arc', 'hitect.v1"}']
      for (const chunk of chunks) {
        onChunk!({ content: chunk, type: 'stream', done: false, data: {} })
      }

      const turn = session.turns.value[0]!
      expect(turn.streamState?.bufferContent).toBe('{"versi' + 'on":"architect.v1"}')

      onDone!({
        agent_id: 'architect',
        session_id: 'sess-1',
        content: '{"version":"architect.v1","state":"progress","message":"Done"}',
        turns: 1,
      })

      await sendPromise
    })
  })

  describe('normalization on done event', () => {
    it('swaps skeleton with normalized blocks on successful normalization', async () => {
      let onChunk: (chunk: any) => void
      let onDone: (result: any) => void

      dispatchStreamMock.mockImplementation(
        (_agent: string, _task: string, chunkCb: Function, doneCb: Function) => {
          onChunk = chunkCb as any
          onDone = doneCb as any
          return Promise.resolve(() => {})
        },
      )

      const { useAgentSession } = await import('@/operator/useAgentSession')
      const session = useAgentSession()

      const sendPromise = session.send(
        [{ type: 'text', content: 'plan my app' }],
        { assistantType: 'architect' },
      )

      await nextTick()

      const fullJson = JSON.stringify({
        version: 'architect.v1',
        state: 'questions',
        questions: [{
          id: 'scope',
          question: 'What are we building?',
          type: 'single',
          options: [
            { value: 'web', label: 'Web app' },
            { value: 'mobile', label: 'Mobile app' },
          ],
        }],
      })

      // Stream JSON in chunks
      onChunk!({ content: fullJson.slice(0, 20), type: 'stream', done: false, data: {} })
      onChunk!({ content: fullJson.slice(20), type: 'stream', done: false, data: {} })

      // Done event triggers normalization
      onDone!({
        agent_id: 'architect',
        session_id: 'sess-1',
        content: fullJson,
        turns: 1,
      })

      const turn = session.turns.value[0]!

      // Should have rendered blocks, no status placeholder
      expect(turn.streamState?.renderState).toBe('rendered')
      expect(turn.streamState?.isBuffering).toBe(false)
      expect(turn.response.some(b => b.type === 'status')).toBe(false)
      expect(turn.response.some(b => b.type === 'architect:questions')).toBe(true)

      await sendPromise
    })

    it('falls back to text when normalization fails', async () => {
      let onChunk: (chunk: any) => void
      let onDone: (result: any) => void

      dispatchStreamMock.mockImplementation(
        (_agent: string, _task: string, chunkCb: Function, doneCb: Function) => {
          onChunk = chunkCb as any
          onDone = doneCb as any
          return Promise.resolve(() => {})
        },
      )

      const { useAgentSession } = await import('@/operator/useAgentSession')
      const session = useAgentSession()

      const sendPromise = session.send(
        [{ type: 'text', content: 'plan my app' }],
        { assistantType: 'architect' },
      )

      await nextTick()

      // Stream invalid JSON content
      onChunk!({ content: '{invalid-json-that-wont-parse', type: 'stream', done: false, data: {} })

      // Done with the invalid content
      onDone!({
        agent_id: 'architect',
        session_id: 'sess-1',
        content: '{invalid-json-that-wont-parse',
        turns: 1,
      })

      const turn = session.turns.value[0]!

      // Should fall back to text — never show nothing
      expect(turn.response.length).toBeGreaterThan(0)
      const hasTextOrFallback = turn.response.some(
        b => b.type === 'text' && (b as any).content.includes('{invalid-json'),
      )
      expect(hasTextOrFallback).toBe(true)

      await sendPromise
    })
  })

  describe('StreamRenderState transitions', () => {
    it('transitions through buffering → normalizing → rendered for structured output', async () => {
      let onChunk: (chunk: any) => void
      let onDone: (result: any) => void
      const stateLog: StreamRenderState[] = []

      dispatchStreamMock.mockImplementation(
        (_agent: string, _task: string, chunkCb: Function, doneCb: Function) => {
          onChunk = chunkCb as any
          onDone = doneCb as any
          return Promise.resolve(() => {})
        },
      )

      const { useAgentSession } = await import('@/operator/useAgentSession')
      const session = useAgentSession()

      const sendPromise = session.send(
        [{ type: 'text', content: 'plan' }],
        { assistantType: 'architect' },
      )

      await nextTick()

      // Initial state
      const turn = session.turns.value[0]!

      // Stream JSON
      onChunk!({ content: '{"version":"architect.v1"', type: 'stream', done: false, data: {} })
      if (turn.streamState) stateLog.push(turn.streamState.renderState)

      // Done with full valid JSON in result.content
      const fullJson = JSON.stringify({
        version: 'architect.v1',
        state: 'progress',
        message: 'Working...',
      })
      onDone!({
        agent_id: 'architect',
        session_id: 'sess-1',
        content: fullJson,
        turns: 1,
      })
      if (turn.streamState) stateLog.push(turn.streamState.renderState)

      // Should have gone through buffering → rendered
      expect(stateLog).toContain('buffering')
      expect(stateLog[stateLog.length - 1]).toBe('rendered')

      // Verify progress block was created
      expect(turn.response.some(b => b.type === 'architect:progress')).toBe(true)

      await sendPromise
    })

    it('stays in streaming state for non-buffered content', async () => {
      let onChunk: (chunk: any) => void
      let onDone: (result: any) => void

      dispatchStreamMock.mockImplementation(
        (_agent: string, _task: string, chunkCb: Function, doneCb: Function) => {
          onChunk = chunkCb as any
          onDone = doneCb as any
          return Promise.resolve(() => {})
        },
      )

      const { useAgentSession } = await import('@/operator/useAgentSession')
      const session = useAgentSession()

      // No assistantType — plain text streaming
      const sendPromise = session.send(
        [{ type: 'text', content: 'hello' }],
      )

      await nextTick()

      onChunk!({ content: 'Hello ', type: 'stream', done: false, data: {} })
      onChunk!({ content: 'world!', type: 'stream', done: false, data: {} })

      const turn = session.turns.value[0]!
      expect(turn.streamState?.renderState).toBe('streaming')
      expect(turn.streamState?.isBuffering).toBe(false)

      // Verify text was rendered incrementally
      const textBlocks = turn.response.filter(b => b.type === 'text')
      expect(textBlocks).toHaveLength(1)
      expect((textBlocks[0] as any).content).toBe('Hello world!')

      onDone!({
        agent_id: 'general',
        session_id: 'sess-1',
        content: 'Hello world!',
        turns: 1,
      })

      expect(turn.streamState?.renderState).toBe('rendered')

      await sendPromise
    })
  })

  // ─── Slice D: Architect-first validation ───

  describe('architect blocks never render partial', () => {
    it('does not leak partial JSON into UI during streaming', async () => {
      let onChunk: (chunk: any) => void
      let onDone: (result: any) => void

      dispatchStreamMock.mockImplementation(
        (_agent: string, _task: string, chunkCb: Function, doneCb: Function) => {
          onChunk = chunkCb as any
          onDone = doneCb as any
          return Promise.resolve(() => {})
        },
      )

      const { useAgentSession } = await import('@/operator/useAgentSession')
      const session = useAgentSession()

      const sendPromise = session.send(
        [{ type: 'text', content: 'design my app' }],
        { assistantType: 'architect' },
      )

      await nextTick()

      // Simulate streaming partial JSON
      const partialChunks = [
        '{"version":',
        '"architect.v1",',
        '"state":"questions",',
        '"questions":[{',
        '"id":"scope",',
        '"question":"What",',
      ]

      for (const chunk of partialChunks) {
        onChunk!({ content: chunk, type: 'stream', done: false, data: {} })

        // After each chunk, verify no raw JSON text is visible
        const turn = session.turns.value[0]!
        const textBlocks = turn.response.filter(b => b.type === 'text')
        expect(textBlocks).toHaveLength(0)

        // No architect:questions block should appear yet
        const questionBlocks = turn.response.filter(b => b.type === 'architect:questions')
        expect(questionBlocks).toHaveLength(0)
      }

      // Now complete with the full valid JSON
      const fullJson = JSON.stringify({
        version: 'architect.v1',
        state: 'questions',
        questions: [{
          id: 'scope',
          question: 'What are we building?',
          type: 'single',
          options: [
            { value: 'web', label: 'Web app' },
            { value: 'mobile', label: 'Mobile app' },
          ],
        }],
      })

      onDone!({
        agent_id: 'architect',
        session_id: 'sess-1',
        content: fullJson,
        turns: 1,
      })

      const turn = session.turns.value[0]!
      // NOW the question block should appear as a single intentional swap
      const questionBlocks = turn.response.filter(b => b.type === 'architect:questions')
      expect(questionBlocks).toHaveLength(1)

      // No status placeholder should remain
      const statusBlocks = turn.response.filter(b => b.type === 'status')
      expect(statusBlocks).toHaveLength(0)

      await sendPromise
    })

    it('architect questions render only after full parse — never partially', async () => {
      let onChunk: (chunk: any) => void
      let onDone: (result: any) => void

      dispatchStreamMock.mockImplementation(
        (_agent: string, _task: string, chunkCb: Function, doneCb: Function) => {
          onChunk = chunkCb as any
          onDone = doneCb as any
          return Promise.resolve(() => {})
        },
      )

      const { useAgentSession } = await import('@/operator/useAgentSession')
      const session = useAgentSession()

      const sendPromise = session.send(
        [{ type: 'text', content: 'questions' }],
        { assistantType: 'architect' },
      )

      await nextTick()

      const fullJson = JSON.stringify({
        version: 'architect.v1',
        state: 'questions',
        questions: [
          {
            id: 'q1',
            question: 'Which framework?',
            type: 'single',
            options: [
              { value: 'vue', label: 'Vue 3' },
              { value: 'react', label: 'React' },
              { value: 'svelte', label: 'Svelte' },
            ],
          },
          {
            id: 'q2',
            question: 'Which database?',
            type: 'single',
            options: [
              { value: 'pg', label: 'PostgreSQL' },
              { value: 'mongo', label: 'MongoDB' },
            ],
          },
        ],
      })

      // Stream token by token
      for (let i = 0; i < fullJson.length; i += 10) {
        onChunk!({ content: fullJson.slice(i, i + 10), type: 'stream', done: false, data: {} })
      }

      // Before done: no question blocks
      const turnBefore = session.turns.value[0]!
      expect(turnBefore.response.filter(b => b.type === 'architect:questions')).toHaveLength(0)

      // After done: question block appears
      onDone!({
        agent_id: 'architect',
        session_id: 'sess-1',
        content: fullJson,
        turns: 1,
      })

      const turnAfter = session.turns.value[0]!
      expect(turnAfter.response.filter(b => b.type === 'architect:questions')).toHaveLength(1)

      // Verify the full questions data is present
      const qBlock = turnAfter.response.find(b => b.type === 'architect:questions') as any
      expect(qBlock.data.questions).toHaveLength(2)
      expect(qBlock.data.questions[0].options).toHaveLength(3)
      expect(qBlock.data.questions[1].options).toHaveLength(2)

      await sendPromise
    })

    it('skeleton placeholder covers the full area during buffering', async () => {
      let onChunk: (chunk: any) => void

      dispatchStreamMock.mockImplementation(
        (_agent: string, _task: string, chunkCb: Function) => {
          onChunk = chunkCb as any
          return Promise.resolve(() => {})
        },
      )

      const { useAgentSession } = await import('@/operator/useAgentSession')
      const session = useAgentSession()

      session.send(
        [{ type: 'text', content: 'plan' }],
        { assistantType: 'architect' },
      )

      await nextTick()

      // Start streaming JSON
      onChunk!({ content: '{"version":"architect.v1"', type: 'stream', done: false, data: {} })

      const turn = session.turns.value[0]!

      // The placeholder should be a status block with a message
      const statusBlock = turn.response.find(b => b.type === 'status') as any
      expect(statusBlock).toBeDefined()
      expect(statusBlock.message).toBe('Generating response...')

      // streamState should indicate buffering
      expect(turn.streamState?.isBuffering).toBe(true)
      expect(turn.streamState?.bufferStartedAt).toBeTypeOf('number')
    })
  })
})
