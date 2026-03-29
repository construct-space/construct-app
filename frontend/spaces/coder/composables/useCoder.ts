/**
 * useCoder — Session-persistent coding agent.
 *
 * Sessions are keyed by project path and survive navigation.
 * Follow-ups pass runner_session_id so the backend loads the full
 * message history (including tool_use/tool_result pairs).
 */

import { ref, computed, triggerRef } from 'vue'
import { useOperator } from '@/operator/client'
import { useStreamStatus, type ToolActivity } from '@/operator/useStreamStatus'
import { useAIModel } from '@/composables/useAIModel'
import type { StreamEvent } from '@/operator/types'

export interface CoderMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

// ─── Session persistence (localStorage — survives app restarts) ───

interface PersistedSession {
  messages: CoderMessage[]
  runnerSessionId: string | null
  toolHistory: ToolActivity[]
}

function storageKey(projectPath: string) {
  return `coder:${projectPath}`
}

function saveSession(key: string, messages: CoderMessage[], runnerSessionId: string | null, toolHistory: readonly ToolActivity[]) {
  if (!key) return
  try {
    const data: PersistedSession = {
      messages: [...messages],
      runnerSessionId,
      toolHistory: [...toolHistory].slice(-100), // keep last 100 tool calls
    }
    localStorage.setItem(storageKey(key), JSON.stringify(data))
  } catch { /* quota exceeded — ignore */ }
}

function loadSession(key: string): PersistedSession | null {
  if (!key) return null
  try {
    const raw = localStorage.getItem(storageKey(key))
    if (!raw) return null
    return JSON.parse(raw) as PersistedSession
  } catch { return null }
}

function deleteSession(key: string) {
  if (!key) return
  localStorage.removeItem(storageKey(key))
}

// ─── Composable ───

export function useCoder() {
  const operator = useOperator()
  const streamStatus = useStreamStatus()
  const { defaultModelId, resolveModelId, loadProviders } = useAIModel()

  const messages = ref<CoderMessage[]>([])
  const isRunning = ref(false)
  const error = ref<string | null>(null)
  const runnerSessionId = ref<string | null>(null)
  const projectPath = ref('')

  let unlisten: (() => void) | null = null
  let abortController: AbortController | null = null
  let activeRequestId: string | null = null

  const hasMessages = computed(() => messages.value.length > 0)
  const toolHistory = streamStatus.toolHistory
  const status = streamStatus.status
  const statusMessage = streamStatus.statusMessage

  function handleChunk(chunk: StreamEvent) {
    streamStatus.handleChunk(chunk)
  }

  function persist() {
    saveSession(projectPath.value, messages.value, runnerSessionId.value, toolHistory.value)
  }

  // Queue for mid-run steering — sent as next user message after current stream completes
  const pendingSteer = ref<string | null>(null)

  async function steer(text: string) {
    const trimmed = text.trim()
    if (!trimmed) return
    if (isRunning.value) {
      // Queue the message — will be sent after current run completes
      pendingSteer.value = trimmed
      // Stop the current stream so the steer can take over
      await stop()
      return
    }
    await send(trimmed)
  }

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || isRunning.value) return

    messages.value.push({ id: `user-${Date.now()}`, role: 'user', content: trimmed })
    triggerRef(messages)

    isRunning.value = true
    error.value = null
    streamStatus.reset()
    abortController = new AbortController()

    let assistantId: string | null = null

    try {
      await loadProviders()
      const model = resolveModelId(defaultModelId.value, { allowAuto: false })

      await new Promise<void>((resolve, reject) => {
        operator.stream(
          'agents.dispatch_stream',
          {
            agent_id: 'coder',
            task: trimmed,
            model,
            ...(runnerSessionId.value ? { session_id: runnerSessionId.value } : {}),
            ...(projectPath.value ? { project_path: projectPath.value } : {}),
          },
          (chunk: StreamEvent) => {
            if (abortController?.signal.aborted) return
            handleChunk(chunk)

            const type = chunk.type || ''

            if (type === 'tool_call' || type === 'tool.call') {
              assistantId = null
              return
            }

            const text = chunk.content || (chunk.data?.text as string) || ''
            if (text && type !== 'tool_result' && type !== 'tool.result' && type !== 'status' && type !== 'turn.start') {
              if (!assistantId) {
                assistantId = `assistant-${Date.now()}`
                messages.value.push({ id: assistantId, role: 'assistant', content: text })
              } else {
                const idx = messages.value.findIndex(m => m.id === assistantId)
                if (idx !== -1) {
                  messages.value[idx] = { ...messages.value[idx], content: messages.value[idx].content + text }
                }
              }
              triggerRef(messages)
            }
          },
          (doneData: Record<string, unknown>) => {
            streamStatus.handleDone()
            if (doneData?.session_id && typeof doneData.session_id === 'string') {
              runnerSessionId.value = doneData.session_id
            }
            persist()
            resolve()
          },
          (err: string) => {
            streamStatus.handleError(err)
            persist()
            reject(new Error(err))
          },
          (requestId: string) => {
            activeRequestId = requestId
          },
        ).then((cleanup) => {
          unlisten = cleanup
          abortController?.signal.addEventListener('abort', () => {
            cleanup()
            unlisten = null
          }, { once: true })
        }).catch(reject)
      })
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed'
      persist()
    } finally {
      isRunning.value = false
      abortController = null

      // Process queued steer message
      if (pendingSteer.value) {
        const steerText = pendingSteer.value
        pendingSteer.value = null
        await send(steerText)
      }
    }
  }

  async function stop() {
    if (activeRequestId) {
      try { await operator.stopStream(activeRequestId) } catch { /* ignore */ }
    }
    abortController?.abort()
    if (unlisten) { unlisten(); unlisten = null }
    activeRequestId = null
    isRunning.value = false
    persist()  // save BEFORE reset so tool history is preserved
    streamStatus.reset()
  }

  function clear() {
    stop()
    messages.value = []
    error.value = null
    runnerSessionId.value = null
    streamStatus.reset()
    deleteSession(projectPath.value)
  }

  function setProjectPath(path: string) {
    // Save current session before switching
    if (projectPath.value && projectPath.value !== path) {
      persist()
    }

    projectPath.value = path

    // Restore previous session for this project
    const saved = loadSession(path)
    if (saved) {
      messages.value = [...saved.messages]
      runnerSessionId.value = saved.runnerSessionId
      // Restore tool history into streamStatus
      streamStatus.reset()
      streamStatus.toolHistory.value = [...saved.toolHistory]
      triggerRef(messages)
    } else {
      messages.value = []
      runnerSessionId.value = null
      streamStatus.reset()
    }
  }

  return {
    messages,
    isRunning,
    error,
    hasMessages,
    toolHistory,
    status,
    statusMessage,

    send,
    steer,
    stop,
    clear,
    setProjectPath,
  }
}
