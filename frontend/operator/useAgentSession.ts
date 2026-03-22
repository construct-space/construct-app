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
// Extensible block system — each space can render blocks it understands,
// unknown blocks fall back to text/JSON display.

// --- Universal blocks (all spaces) ---

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
  filename?: string
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

// --- Architect blocks ---

export interface QuestionBlock {
  type: 'question'
  id: string
  question: string
  questionType: 'single' | 'multi'
  options: { value: string; label: string; icon?: string; description?: string }[]
  answer?: string | string[]
}

export interface PlanBlock {
  type: 'plan'
  name: string
  description: string
  planType?: string  // 'construct-space' | 'web-app' | 'api' | etc.
  spaceId?: string
  decisions?: Record<string, unknown>
  stack?: Record<string, unknown>
  features?: { name: string; description: string; priority?: string }[]
  tasks?: {
    id: number
    title: string
    description: string
    files?: string[]
    steps?: string[]
    depends?: number[]
    commit?: string
  }[]
  phases?: { name: string; tasks: string[] }[]
}

export interface TaskListBlock {
  type: 'tasklist'
  tasks: {
    id: string | number
    title: string
    description?: string
    status: 'pending' | 'running' | 'done' | 'error' | 'skipped'
    commit?: string
  }[]
}

export interface ProgressBlock {
  type: 'progress'
  headline: string
  detail?: string
  phase?: string
  percent?: number
}

// --- Data/Table blocks ---

export interface TableBlock {
  type: 'table'
  headers: string[]
  rows: string[][]
  caption?: string
}

export interface JsonBlock {
  type: 'json'
  data: unknown
  label?: string
  collapsed?: boolean
}

// --- Interactive blocks ---

export interface ActionBlock {
  type: 'action'
  actions: {
    id: string
    label: string
    icon?: string
    variant?: 'primary' | 'secondary' | 'danger'
    disabled?: boolean
  }[]
}

export interface LinkBlock {
  type: 'link'
  url: string
  title?: string
  description?: string
  favicon?: string
}

// --- Diff/Change blocks ---

export interface DiffBlock {
  type: 'diff'
  filename: string
  hunks: string
  language?: string
}

// ─── Question Detection ───
// Parses agent text to detect multiple-choice questions and converts to QuestionBlocks.

const OPTION_LINE = /^\s*(?:[-*]|\(?([a-z0-9])\)?[.):]\s*\*{0,2})(.+?)(?:\*{0,2}\s*[-—]\s*(.+))?$/i

/**
 * Try to split a completed text block into text + question block.
 * Returns null if no question pattern is detected.
 */
export function extractQuestion(text: string): { before: string; question: QuestionBlock } | null {
  const trimmed = text.trimEnd()

  // Skip short responses and responses without a question
  if (trimmed.length < 40) return null
  if (!trimmed.includes('?')) return null

  const lines = trimmed.split('\n')

  // Walk backwards to find consecutive option lines
  let optionEnd = lines.length
  let optionStart = optionEnd
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line) { if (optionStart < optionEnd) break; continue }
    if (OPTION_LINE.test(line)) {
      optionStart = i
    } else {
      break
    }
  }

  if (optionStart >= optionEnd || optionEnd - optionStart < 2) return null

  // Parse options
  const options: QuestionBlock['options'] = []
  for (let i = optionStart; i < optionEnd; i++) {
    const m = lines[i].trim().match(OPTION_LINE)
    if (!m) continue
    const label = (m[2] || '').replace(/\*{1,2}/g, '').trim()
    const description = (m[3] || '').replace(/\*{1,2}/g, '').trim() || undefined
    if (label) options.push({ value: label, label, description })
  }

  if (options.length < 2) return null

  // Find the question line (first non-empty line above options)
  let questionLine = ''
  for (let i = optionStart - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (line) { questionLine = line.replace(/^#+\s*/, '').replace(/\*{1,2}/g, ''); break }
  }
  if (!questionLine) return null

  // Everything before the question line is "before" text
  let beforeEnd = optionStart - 1
  for (; beforeEnd >= 0; beforeEnd--) {
    if (lines[beforeEnd].trim() === questionLine.trim() || lines[beforeEnd].trim().replace(/^#+\s*/, '').replace(/\*{1,2}/g, '') === questionLine) {
      break
    }
  }
  const before = lines.slice(0, beforeEnd).join('\n').trimEnd()

  return {
    before,
    question: {
      type: 'question',
      id: `q-${Date.now()}`,
      question: questionLine,
      questionType: 'single',
      options,
    },
  }
}

export type RequestBlock = TextBlock | ImageBlock | FileBlock
export type ResponseBlock =
  | TextBlock | ToolBlock | CodeBlock | SvgBlock | ImageBlock | ErrorBlock | StatusBlock
  | QuestionBlock | PlanBlock | TaskListBlock | ProgressBlock
  | TableBlock | JsonBlock | ActionBlock | LinkBlock | DiffBlock

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

    // Build task with history context
    const history = turns.value.slice(0, -1).slice(-5)
    let task = options?.taskOverride?.trim() || textContent.trim()
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
        agentId,
        task,
        (chunk) => handleStreamChunk(turn, chunk),
        (result) => {
          streamStatus.handleDone()
          turn.status = 'done'
          turn.agentId = result.agent_id || turn.agentId
          turn.turns = result.turns

          // Mark any remaining running tool blocks as done
          for (const block of turn.response) {
            if (block.type === 'tool' && (block as ToolBlock).state === 'running') {
              (block as ToolBlock).state = 'done'
            }
          }

          // Append final content if it wasn't already streamed
          if (result.content) {
            const existingText = turn.response
              .filter((b): b is TextBlock => b.type === 'text')
              .map(b => b.content)
              .join('')
            // Only append if the result content isn't already present
            if (!existingText.includes(result.content.slice(0, 50))) {
              turn.response.push({ type: 'text', content: result.content })
            }
          }

          // Try to extract a question from the last text block
          let lastTextIdx = -1
          for (let i = turn.response.length - 1; i >= 0; i--) {
            if (turn.response[i].type === 'text') { lastTextIdx = i; break }
          }
          if (lastTextIdx >= 0) {
            const lastText = turn.response[lastTextIdx] as TextBlock
            const parsed = extractQuestion(lastText.content)
            if (parsed) {
              if (parsed.before.trim()) {
                lastText.content = parsed.before
              } else {
                turn.response.splice(lastTextIdx, 1)
              }
              turn.response.push(parsed.question)
            }
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
        options?.model || effectiveModel.value,
        options?.projectPath ? { projectPath: options.projectPath } : undefined,
        (requestId) => {
          activeRequestId = requestId
        },
      )
    } catch {
      // Streaming not available — fall back to sync
      try {
        const result: DispatchResult = await operator.dispatch(
          agentId,
          task,
          options?.model || effectiveModel.value,
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
