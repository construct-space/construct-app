/**
 * useAgentSession — Block-based agent session
 *
 * Replaces useAssistant's flat text messages with structured turns.
 * Each turn = request blocks (from user) + response blocks (from agent).
 * Stream events are parsed into blocks in real-time.
 */

import { ref, computed, triggerRef } from 'vue'
import { useOperator } from './client'
import { useStreamStatus } from './useStreamStatus'
import { useAIModel } from '@/composables/useAIModel'
import { StreamType } from './streamEvents'
import { showAssistant } from './useAssistant'
import type { StreamEvent, DispatchResult } from './types'
import {
  extractQuestion,
  normalizeAssistantEnvelope,
  tryParseAssistantEnvelope,
  normalize,
  requiresBuffering,
} from '@/assistant'
import type {
  RequestBlock,
  ResponseBlock,
  TextBlock,
  ToolBlock,
  Turn,
  TurnStreamState,
  StreamRenderState,
} from '@/assistant'

// ─── Session State ───

let turnCounter = 0
const nextTurnId = () => `turn-${++turnCounter}`

function createStreamState(): TurnStreamState {
  return {
    renderState: 'streaming',
    isBuffering: false,
    bufferContent: '',
    bufferStartedAt: null,
  }
}

function startBuffering(state: TurnStreamState): void {
  state.renderState = 'buffering'
  state.isBuffering = true
  if (!state.bufferStartedAt) state.bufferStartedAt = Date.now()
}

function setRenderState(turn: Turn, renderState: StreamRenderState): void {
  if (!turn.streamState) turn.streamState = createStreamState()
  turn.streamState.renderState = renderState
  if (renderState === 'rendered' || renderState === 'fallback') {
    turn.streamState.isBuffering = false
  }
}

export function useAgentSession() {
  const operator = useOperator()
  const streamStatus = useStreamStatus()
  const { defaultModelId, resolveModelId, loadProviders } = useAIModel()

  const turns = ref<Turn[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const selectedAgent = ref('general')
  const selectedModel = ref<string | undefined>(undefined)
  const runnerSessionId = ref<string | null>(null)

  let unlisten: (() => void) | null = null
  let activeRequestId: string | null = null

  const hasTurns = computed(() => turns.value.length > 0)
  const effectiveModel = computed(() =>
    resolveModelId(selectedModel.value || defaultModelId.value, { allowAuto: false }),
  )
  const activeTurn = computed(() => {
    const last = turns.value[turns.value.length - 1]
    return last?.status === 'streaming' ? last : null
  })

  // ─── Stream → Blocks parser ───

  function appendTextToResponse(turn: Turn, text: string) {
    const lastBlock = turn.response[turn.response.length - 1]
    if (lastBlock?.type === 'text') {
      lastBlock.content += text
    } else {
      turn.response.push({ type: 'text', content: text })
    }
  }

  function appendNormalizedFinalResponse(turn: Turn, content: string): boolean {
    const envelope = tryParseAssistantEnvelope(content)
    if (!envelope) return false
    turn.response.push(...normalizeAssistantEnvelope(envelope))
    return true
  }

  function extractQuestionFromLastText(turn: Turn) {
    let lastTextIdx = -1
    for (let i = turn.response.length - 1; i >= 0; i -= 1) {
      if (turn.response[i]?.type === 'text') {
        lastTextIdx = i
        break
      }
    }

    if (lastTextIdx < 0) return

    const lastText = turn.response[lastTextIdx] as TextBlock
    const parsed = extractQuestion(lastText.content)
    if (!parsed) return

    if (parsed.before.trim()) {
      lastText.content = parsed.before
    } else {
      turn.response.splice(lastTextIdx, 1)
    }
    turn.response.push(parsed.question)
  }

  function handleStreamChunk(turn: Turn, chunk: StreamEvent, assistantType?: string) {
    streamStatus.handleChunk(chunk)
    const type = chunk.type
    const data = chunk.data || {}

    // Ensure stream state exists on the turn
    if (!turn.streamState) turn.streamState = createStreamState()
    const ss = turn.streamState

    // Text content — append to current or new text block
    const text = chunk.content || (data.text as string) || ''
    if (text && type !== StreamType.ToolCall && type !== StreamType.ToolResult && type !== StreamType.Status) {
      // When an assistantType requires buffering, accumulate text silently.
      // Show a skeleton placeholder instead of raw JSON streaming.
      if (assistantType && requiresBuffering(assistantType)) {
        ss.bufferContent += text
        const buf = ss.bufferContent.trim()

        if (buf.startsWith('{') || buf.startsWith('[')) {
          startBuffering(ss)
          // Remove any text blocks, show skeleton placeholder
          turn.response = turn.response.filter(b => b.type !== 'text' && b.type !== 'status')
          turn.response.push({ type: 'status', state: 'thinking', message: 'Generating response...' })
          triggerRef(turns)
          return
        }
      }

      // Streamable: render text incrementally
      if (!ss.isBuffering) ss.renderState = 'streaming'
      appendTextToResponse(turn, text)
      triggerRef(turns)
      return
    }

    // Tool call — insert tool block (always streamable)
    if (type === StreamType.ToolCall) {
      turn.response.push({
        type: 'tool',
        tool: (data.tool as string) || 'unknown',
        title: (data.title as string) || `Running ${data.tool}`,
        callId: (data.call_id as string) || '',
        input: typeof data.input === 'string' ? data.input : JSON.stringify(data.input || ''),
        state: 'running',
      })
      triggerRef(turns)
      return
    }

    // Tool result — update existing tool block
    if (type === StreamType.ToolResult) {
      const callId = (data.call_id as string) || ''
      let toolBlock = callId
        ? turn.response.find((b): b is ToolBlock => b.type === 'tool' && b.callId === callId)
        : undefined
      // Fallback: match last running tool if callId doesn't match
      if (!toolBlock) {
        toolBlock = [...turn.response].reverse().find(
          (b): b is ToolBlock => b.type === 'tool' && b.state === 'running',
        ) as ToolBlock | undefined
      }
      if (toolBlock) {
        toolBlock.state = (data.is_error as boolean) ? 'error' : 'done'
        toolBlock.title = (data.title as string) || toolBlock.title
        const content = data.content as string | undefined
        if (content) {
          toolBlock.result = content.length > 3000 ? content.slice(0, 3000) + '\u2026' : content
        }
      }
      triggerRef(turns)
      return
    }

    // Turn start — just update stream status, no visible block
    if (type === StreamType.TurnStart) {
      return
    }
  }

  // ─── Send ───

  async function send(
    requestBlocks: RequestBlock[],
    options?: {
      agentId?: string
      model?: string
      space?: string
      projectPath?: string
      taskOverride?: string  // send this to agent instead of block text
      assistantType?: string
      outputSchema?: string
    },
  ): Promise<void> {
    if (isLoading.value) return

    const agentId = options?.agentId || selectedAgent.value

    // Extract text from request blocks (for display)
    const textContent = requestBlocks
      .filter((b): b is TextBlock => b.type === 'text')
      .map(b => b.content)
      .join('\n')
    if (!textContent.trim()) return

    // Create turn and get the reactive proxy from the array
    turns.value.push({
      id: nextTurnId(),
      request: requestBlocks,
      response: [],
      agentId,
      status: 'streaming',
      timestamp: Date.now(),
    })
    const turn = turns.value[turns.value.length - 1]

    isLoading.value = true
    error.value = null
    streamStatus.reset()

    const task = options?.taskOverride?.trim() || textContent.trim()

    try {
      await loadProviders()
      const resolvedModel = resolveModelId(options?.model || effectiveModel.value, { allowAuto: false })
      unlisten = await operator.dispatchStream(
        agentId,
        task,
        (chunk) => handleStreamChunk(turn, chunk, options?.assistantType),
        (result) => {
          streamStatus.handleDone()
          turn.status = 'done'
          turn.agentId = result.agent_id || turn.agentId
          turn.turns = result.turns
          if (result.session_id) runnerSessionId.value = result.session_id

          // Ensure stream state exists
          if (!turn.streamState) turn.streamState = createStreamState()
          const ss = turn.streamState

          // Mark any remaining running tool blocks as done
          for (const block of turn.response) {
            if (block.type === 'tool' && (block as ToolBlock).state === 'running') {
              (block as ToolBlock).state = 'done'
            }
          }

          // Append final content if it wasn't already streamed
          if (result.content) {
            // Gather text from buffer or from text blocks
            const buffered = ss.bufferContent
            const existingText = buffered.trim()
              ? buffered
              : turn.response
                .filter((b): b is TextBlock => b.type === 'text')
                .map(b => b.content)
                .join('')

            // Use per-type normalizer when an assistantType is known.
            // Prefer result.content for normalization when available (it's the complete response).
            // Only use buffered content if result.content is absent.
            const textToParse = result.content || existingText
            const appendedStructured = options?.assistantType
              ? (() => {
                  // Transition: buffering → normalizing
                  setRenderState(turn, 'normalizing')

                  // Remove placeholder and any raw text blocks
                  turn.response = turn.response.filter(b => b.type !== 'status' && b.type !== 'text')

                  try {
                    const blocks = normalize(options.assistantType!, textToParse)
                    // If the normalizer only returned a plain text block identical to input,
                    // treat as fallback — still show the text so we never show nothing.
                    if (blocks.length === 1 && blocks[0].type === 'text' && (blocks[0] as TextBlock).content === textToParse) {
                      setRenderState(turn, 'fallback')
                      turn.response.push(...blocks)
                      return true
                    }
                    // Replace streamed text blocks with properly normalized blocks
                    if (existingText.trim()) {
                      turn.response = turn.response.filter(b => b.type !== 'text')
                    }
                    turn.response.push(...blocks)
                    setRenderState(turn, 'rendered')
                    return true
                  } catch {
                    // Normalization failed — fall back to showing raw text
                    setRenderState(turn, 'fallback')
                    turn.response.push({ type: 'text', content: textToParse })
                    return true
                  }
                })()
              : !existingText.trim() && appendNormalizedFinalResponse(turn, result.content)

            if (!appendedStructured && !existingText.includes(result.content.slice(0, 50))) {
              turn.response.push({ type: 'text', content: result.content })
            }

            // Set final render state if not already set by the structured path
            if (ss.renderState === 'streaming' || ss.renderState === 'normalizing') {
              setRenderState(turn, 'rendered')
            }
          } else {
            // No content — mark as rendered
            setRenderState(turn, 'rendered')
          }

          // Clear buffer
          ss.bufferContent = ''
          ss.isBuffering = false

          extractQuestionFromLastText(turn)

          const errMsg = (result as unknown as Record<string, unknown>).error as string | undefined
          if (errMsg) {
            error.value = errMsg
            turn.response.push({ type: 'error', message: errMsg })
          }

          activeRequestId = null
          isLoading.value = false
          triggerRef(turns)
          if (unlisten) { unlisten(); unlisten = null }
        },
        (err) => {
          streamStatus.handleError(err)
          error.value = err
          turn.status = 'error'
          turn.response.push({ type: 'error', message: err })
          activeRequestId = null
          isLoading.value = false
          triggerRef(turns)
          if (unlisten) { unlisten(); unlisten = null }
        },
        resolvedModel,
        {
          ...(options?.projectPath ? { projectPath: options.projectPath } : {}),
          ...(runnerSessionId.value ? { sessionId: runnerSessionId.value } : {}),
          ...(options?.assistantType ? { assistantType: options.assistantType } : {}),
          ...(options?.outputSchema ? { outputSchema: options.outputSchema } : {}),
        },
        (requestId) => {
          activeRequestId = requestId
        },
      )
    } catch {
      // Streaming not available — fall back to sync
      try {
        await loadProviders()
        const resolvedModel = resolveModelId(options?.model || effectiveModel.value, { allowAuto: false })
        const result: DispatchResult = await operator.dispatch(
          agentId,
          task,
          resolvedModel,
          {
            ...(options?.projectPath ? { projectPath: options.projectPath } : {}),
            ...(runnerSessionId.value ? { sessionId: runnerSessionId.value } : {}),
            ...(options?.assistantType ? { assistantType: options.assistantType } : {}),
            ...(options?.outputSchema ? { outputSchema: options.outputSchema } : {}),
          },
        )
        // Use per-type normalizer when an assistantType is known.
        // Pass raw content directly — per-type normalizers handle their own parsing.
        const syncNormalized = options?.assistantType
          ? (() => {
              const blocks = normalize(options.assistantType!, result.content)
              if (blocks.length === 1 && blocks[0].type === 'text' && (blocks[0] as TextBlock).content === result.content) {
                return false
              }
              turn.response.push(...blocks)
              return true
            })()
          : appendNormalizedFinalResponse(turn, result.content)
        if (!syncNormalized) {
          turn.response.push({ type: 'text', content: result.content })
        }
        extractQuestionFromLastText(turn)
        turn.status = 'done'
        turn.agentId = result.agent_id
        turn.turns = result.turns
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to get response'
        error.value = msg
        turn.response.push({ type: 'error', message: msg })
        turn.status = 'error'
      } finally {
        activeRequestId = null
        isLoading.value = false
        triggerRef(turns)
      }
    }
  }

  async function sendText(text: string): Promise<void> {
    if (!text.trim()) return
    return send([{ type: 'text', content: text.trim() }])
  }

  async function sendWithImage(text: string, imageSrc: string): Promise<void> {
    const blocks: RequestBlock[] = []
    if (text.trim()) blocks.push({ type: 'text', content: text.trim() })
    blocks.push({ type: 'image', src: imageSrc })
    return send(blocks)
  }

  async function stop() {
    if (!isLoading.value) return

    // Ask operator to cancel the stream
    if (activeRequestId) {
      try {
        await operator.stopStream(activeRequestId)
      } catch (stopError) {
        console.error('[useAgentSession] Failed to stop stream:', stopError)
      }
    }

    // Tear down local listener
    if (unlisten) {
      unlisten()
      unlisten = null
    }

    activeRequestId = null
    isLoading.value = false
    error.value = null
    streamStatus.reset()

    // Mark the active turn as done with a "Stopped." note
    const last = turns.value[turns.value.length - 1]
    if (last?.status === 'streaming') {
      const hasContent = last.response.some(b => b.type === 'text' && b.content.trim())
      if (!hasContent) {
        last.response.push({ type: 'text', content: 'Stopped.' })
      }
      last.status = 'done'
      triggerRef(turns)
    }
  }

  function clear() {
    if (isLoading.value) {
      void stop()
    }
    turns.value = []
    error.value = null
    isLoading.value = false
    runnerSessionId.value = null
    streamStatus.reset()
  }

  function setAgent(agentId: string) { selectedAgent.value = agentId }
  function setModel(model: string) { selectedModel.value = model }
  function toggle() { showAssistant.value = !showAssistant.value }
  function open() { showAssistant.value = true }
  function close() { showAssistant.value = false }

  // ─── Session Persistence ───

  const sessionId = ref<string | null>(null)

  async function saveSession(agentId?: string): Promise<string | null> {
    if (turns.value.length === 0) return null
    const id = sessionId.value || `session-${Date.now()}`
    try {
      await operator.send('sessions.save', {
        session: {
          id,
          agentId: agentId || selectedAgent.value,
          turns: turns.value.map(t => ({
            id: t.id,
            request: t.request,
            response: t.response,
            agentId: t.agentId,
            status: t.status,
            timestamp: t.timestamp,
            turns: t.turns,
          })),
        },
      })
      sessionId.value = id
      return id
    } catch {
      return null
    }
  }

  async function loadSession(id: string): Promise<boolean> {
    try {
      const result = await operator.send('sessions.load', { id }) as { session?: { id: string; turns: Turn[] } }
      if (result?.session?.turns) {
        turns.value = result.session.turns
        sessionId.value = result.session.id
        triggerRef(turns)
        return true
      }
    } catch { /* ignore */ }
    return false
  }

  interface SessionMeta { id: string; agentId: string; turnCount: number; createdAt: string; updatedAt: string }

  async function listSessions(): Promise<SessionMeta[]> {
    try {
      const result = await operator.send('sessions.chat_list', {}) as { sessions?: SessionMeta[] }
      return result?.sessions || []
    } catch {
      return []
    }
  }

  async function deleteSession(id: string): Promise<void> {
    try {
      await operator.send('sessions.delete', { id })
      if (sessionId.value === id) {
        sessionId.value = null
        turns.value = []
      }
    } catch { /* ignore */ }
  }

  function newSession() {
    if (isLoading.value) void stop()
    sessionId.value = null
    runnerSessionId.value = null
    turns.value = []
    error.value = null
    isLoading.value = false
    streamStatus.reset()
  }

  return {
    turns,
    isLoading,
    error,
    hasTurns,
    activeTurn,
    selectedAgent,
    selectedModel,
    sessionId,
    visible: showAssistant,

    status: streamStatus.status,
    statusMessage: streamStatus.statusMessage,
    isAgentActive: streamStatus.isActive,
    toolHistory: streamStatus.toolHistory,

    send,
    sendText,
    sendWithImage,
    stop,
    clear,
    newSession,
    saveSession,
    loadSession,
    listSessions,
    deleteSession,
    setAgent,
    setModel,
    toggle,
    open,
    close,

    operator,
  }
}
