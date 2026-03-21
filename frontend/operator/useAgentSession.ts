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

// ─── Block Types ───

export interface TextBlock {
  type: 'text'
  content: string
}

export interface ImageBlock {
  type: 'image'
  src: string
  alt?: string
}

export interface FileBlock {
  type: 'file'
  name: string
  path?: string
  size?: number
}

export interface ToolBlock {
  type: 'tool'
  tool: string
  title: string
  callId: string
  input?: string
  result?: string
  state: 'running' | 'done' | 'error'
}

export interface CodeBlock {
  type: 'code'
  language: string
  content: string
}

export interface SvgBlock {
  type: 'svg'
  content: string
}

export interface ErrorBlock {
  type: 'error'
  message: string
}

export interface StatusBlock {
  type: 'status'
  state: string
  message: string
  turn?: number
  maxTurns?: number
}

export type RequestBlock = TextBlock | ImageBlock | FileBlock
export type ResponseBlock = TextBlock | ToolBlock | CodeBlock | SvgBlock | ImageBlock | ErrorBlock | StatusBlock

export interface Turn {
  id: string
  request: RequestBlock[]
  response: ResponseBlock[]
  agentId: string
  status: 'pending' | 'streaming' | 'done' | 'error'
  timestamp: number
  turns?: number
}

// ─── Session State ───

let turnCounter = 0
const nextTurnId = () => `turn-${++turnCounter}`

export function useAgentSession() {
  const operator = useOperator()
  const streamStatus = useStreamStatus()
  const { defaultModelId } = useAIModel()

  const turns = ref<Turn[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const selectedAgent = ref('general')
  const selectedModel = ref<string | undefined>(undefined)

  let unlisten: (() => void) | null = null
  let activeRequestId: string | null = null

  const hasTurns = computed(() => turns.value.length > 0)
  const effectiveModel = computed(() => selectedModel.value || defaultModelId.value)
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

  function handleStreamChunk(turn: Turn, chunk: StreamEvent) {
    streamStatus.handleChunk(chunk)
    const type = chunk.type
    const data = chunk.data || {}

    // Text content — append to current or new text block
    const text = chunk.content || (data.text as string) || ''
    if (text && type !== StreamType.ToolCall && type !== StreamType.ToolResult && type !== StreamType.Status) {
      appendTextToResponse(turn, text)
      triggerRef(turns)
      return
    }

    // Tool call — insert tool block
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
      const callId = data.call_id as string
      const toolBlock = turn.response.find(
        (b): b is ToolBlock => b.type === 'tool' && b.callId === callId,
      )
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

  async function send(requestBlocks: RequestBlock[]): Promise<void> {
    if (isLoading.value) return

    // Extract text from request blocks
    const textContent = requestBlocks
      .filter((b): b is TextBlock => b.type === 'text')
      .map(b => b.content)
      .join('\n')
    if (!textContent.trim()) return

    // Create turn
    const turn: Turn = {
      id: nextTurnId(),
      request: requestBlocks,
      response: [],
      agentId: selectedAgent.value,
      status: 'streaming',
      timestamp: Date.now(),
    }
    turns.value.push(turn)

    isLoading.value = true
    error.value = null
    streamStatus.reset()

    // Build task with history context
    const history = turns.value.slice(0, -1).slice(-5)
    let task = textContent.trim()
    if (history.length > 0) {
      const historyStr = history.map(t => {
        const req = t.request.filter((b): b is TextBlock => b.type === 'text').map(b => b.content).join('\n')
        const res = t.response.filter((b): b is TextBlock => b.type === 'text').map(b => b.content).join('\n')
        return `User: ${req}\n\nAssistant: ${res}`
      }).join('\n\n')
      task = `<conversation_history>\n${historyStr}\n</conversation_history>\n\nUser: ${textContent.trim()}`
    }

    try {
      unlisten = await operator.dispatchStream(
        selectedAgent.value,
        task,
        (chunk) => handleStreamChunk(turn, chunk),
        (result) => {
          streamStatus.handleDone()
          turn.status = 'done'
          turn.agentId = result.agent_id || turn.agentId
          turn.turns = result.turns

          const hasText = turn.response.some(b => b.type === 'text')
          if (!hasText && result.content) {
            turn.response.push({ type: 'text', content: result.content })
          }

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
        effectiveModel.value,
        undefined,
        (requestId) => {
          activeRequestId = requestId
        },
      )
    } catch {
      // Streaming not available — fall back to sync
      try {
        const result: DispatchResult = await operator.dispatch(
          selectedAgent.value,
          task,
          effectiveModel.value,
        )
        turn.response.push({ type: 'text', content: result.content })
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
    streamStatus.reset()
  }

  function setAgent(agentId: string) { selectedAgent.value = agentId }
  function setModel(model: string) { selectedModel.value = model }
  function toggle() { showAssistant.value = !showAssistant.value }
  function open() { showAssistant.value = true }
  function close() { showAssistant.value = false }

  return {
    turns,
    isLoading,
    error,
    hasTurns,
    activeTurn,
    selectedAgent,
    selectedModel,
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
    setAgent,
    setModel,
    toggle,
    open,
    close,

    operator,
  }
}
