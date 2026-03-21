/**
 * useStreamStatus — Shared composable for human-readable status from operator streams.
 *
 * Works with any stream consumer (chat, agent, vibe). Parses "status" events
 * from the operator and exposes reactive state for the UI.
 *
 * Usage:
 *   const { status, statusMessage, handleChunk, reset } = useStreamStatus()
 *   // In your stream onChunk callback:
 *   onChunk(chunk) {
 *     handleChunk(chunk)
 *     // ...your other chunk handling
 *   }
 */

import { ref, computed, triggerRef } from 'vue'
import type { StreamEvent } from './types'

export type StatusState =
  | 'idle'
  | 'thinking'
  | 'tool_running'
  | 'tool_done'
  | 'complete'
  | 'error'

export interface StatusInfo {
  state: StatusState
  message: string
  tool?: string
  callId?: string
  turn?: number
  maxTurns?: number
  isError?: boolean
}

export interface ToolActivity {
  tool: string
  title: string
  callId: string
  state: 'running' | 'done' | 'error'
  timestamp: number
  input?: string
  result?: string
  isError?: boolean
}

export interface ProgressUpdate {
  id: string
  headline: string
  detail?: string
  timestamp: number
}

const IDLE_STATUS: StatusInfo = { state: 'idle', message: '' }
// No more generic filler — show actual tool actions instead

export function useStreamStatus() {
  const status = ref<StatusInfo>({ ...IDLE_STATUS })
  const toolHistory = ref<ToolActivity[]>([])
  const statusNarration = ref('')
  const progressUpdates = ref<ProgressUpdate[]>([])

  /** Human-readable one-liner for display */
  const statusMessage = computed(() => status.value.message)

  /** Whether the agent is actively working */
  const isActive = computed(() => {
    const s = status.value.state
    return s === 'thinking' || s === 'tool_running'
  })

  function normalizeProgressHeadline(headline: string) {
    const nextHeadline = headline.trim()
    if (!nextHeadline) return ''

    // Skip empty filler — "continuing implementation", "[phase] working", etc.
    if (/^continuing\b/i.test(nextHeadline)) return ''
    if (/^\[[^\]]+\]\s+(working|continuing)\b/i.test(nextHeadline)) return ''

    return nextHeadline
  }

  function appendProgressUpdate(headline: string) {
    const nextHeadline = normalizeProgressHeadline(headline)
    if (!nextHeadline) return

    const last = progressUpdates.value[progressUpdates.value.length - 1]
    if (last && last.headline === nextHeadline) {
      return
    }

    progressUpdates.value = [
      ...progressUpdates.value,
      {
        id: `${Date.now()}-${progressUpdates.value.length}`,
        headline: nextHeadline,
        timestamp: Date.now(),
      },
    ]
    triggerRef(progressUpdates)
  }

  /** Process a stream chunk — call this from your onChunk handler */
  function handleChunk(chunk: StreamEvent) {
    const type = chunk.type
    const data = chunk.data || {}

    if (type === 'status') {
      const message = (data.message as string) || ''
      status.value = {
        state: (data.state as StatusState) || 'idle',
        message,
        tool: data.tool as string | undefined,
        callId: data.call_id as string | undefined,
        turn: data.turn as number | undefined,
        maxTurns: data.max_turns as number | undefined,
        isError: data.is_error as boolean | undefined,
      }
      if (message) {
        statusNarration.value = message
        if (message !== 'Thinking…' && message !== 'Thinking...') {
          appendProgressUpdate(message)
        }
      }
      triggerRef(status)
      triggerRef(statusNarration)
      return
    }

    if (type === 'tool.call') {
      const title = (data.title as string) || `Running ${data.tool}`
      status.value = {
        state: 'tool_running',
        message: title,
        tool: data.tool as string,
        callId: data.call_id as string,
      }
      toolHistory.value = [...toolHistory.value, {
        tool: data.tool as string,
        title,
        callId: data.call_id as string,
        state: 'running',
        timestamp: Date.now(),
        input: typeof data.input === 'string' ? data.input : JSON.stringify(data.input || ''),
      }]
      triggerRef(status)
      triggerRef(toolHistory)
      return
    }

    if (type === 'tool.result') {
      const title = (data.title as string) || `Done: ${data.tool}`
      const isError = data.is_error as boolean
      status.value = {
        state: 'tool_done',
        message: title,
        tool: data.tool as string,
        callId: data.call_id as string,
        isError,
      }
      const idx = toolHistory.value.findIndex(t => t.callId === data.call_id)
      if (idx !== -1) {
        const content = data.content as string | undefined
        const updated = {
          ...toolHistory.value[idx],
          state: isError ? 'error' as const : 'done' as const,
          title,
          isError,
          result: content ? (content.length > 2000 ? content.slice(0, 2000) + '…' : content) : undefined,
        }
        toolHistory.value = [...toolHistory.value.slice(0, idx), updated, ...toolHistory.value.slice(idx + 1)]
      }
      triggerRef(status)
      triggerRef(toolHistory)
      return
    }

    if (type === 'turn.start') {
      status.value = {
        state: 'thinking',
        message: 'Thinking…',
        turn: data.turn as number,
        maxTurns: data.max_turns as number,
      }
      triggerRef(status)
      return
    }
  }

  function handleDone() {
    status.value = { state: 'complete', message: 'Done' }
    statusNarration.value = ''
    const hasRunning = toolHistory.value.some(t => t.state === 'running')
    if (hasRunning) {
      toolHistory.value = toolHistory.value.map(t =>
        t.state === 'running' ? { ...t, state: 'done' as const } : t,
      )
    }
    triggerRef(status)
    triggerRef(statusNarration)
    triggerRef(toolHistory)
  }

  function handleError(message: string) {
    status.value = { state: 'error', message }
    statusNarration.value = ''
    const hasRunning = toolHistory.value.some(t => t.state === 'running')
    if (hasRunning) {
      toolHistory.value = toolHistory.value.map(t =>
        t.state === 'running' ? { ...t, state: 'error' as const } : t,
      )
    }
    triggerRef(status)
    triggerRef(statusNarration)
    triggerRef(toolHistory)
  }

  function reset() {
    status.value = { ...IDLE_STATUS }
    statusNarration.value = ''
    progressUpdates.value = []
    toolHistory.value = []
    triggerRef(status)
    triggerRef(statusNarration)
    triggerRef(progressUpdates)
    triggerRef(toolHistory)
  }

  return {
    /** Current status info */
    status,
    /** Human-readable message */
    statusMessage,
    /** Latest operator-side progress update, kept separate from tool titles */
    statusNarration,
    /** Running chat-style updates for the current stream */
    progressUpdates,
    /** Whether agent is actively working */
    isActive,
    /** History of tool calls in this session */
    toolHistory,

    /** Call from onChunk */
    handleChunk,
    /** Call from onDone */
    handleDone,
    /** Call from onError */
    handleError,
    /** Reset state */
    reset,
  }
}
