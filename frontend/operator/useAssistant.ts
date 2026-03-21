/**
 * useAssistant — Chat panel logic
 *
 * Powers the AssistantPanel component.
 * Frontend only manages UI state. Operator runs the agent loop.
 * Uses streaming when available, falls back to sync dispatch.
 */

import { ref, computed, triggerRef } from 'vue'
import { useOperator } from './client'
import { useStreamStatus } from './useStreamStatus'
import { useAIModel } from '@/composables/useAIModel'
import { isTauriEnv } from '@/utils/tauri'
import type { DispatchResult } from './types'

export type AssistantDisplayType = 'default' | 'plan' | 'code' | 'success' | 'warning' | 'error'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  agentId?: string
  turns?: number
  displayType?: AssistantDisplayType
  timestamp: number
}

let messageId = 0
const nextMessageId = () => `msg-${++messageId}`
const ASSISTANT_HISTORIES_STORAGE_KEY = 'construct:assistant:histories:v1'
const ASSISTANT_AGENT_STORAGE_KEY = 'construct:assistant:selected-agent:v1'
const ASSISTANT_MODEL_STORAGE_KEY = 'construct:assistant:selected-model:v1'
const MAX_PERSISTED_MESSAGES_PER_AGENT = 100

type MessageHistoryMap = Record<string, Message[]>

function canUsePersistentStorage(): boolean {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined'
}

function sanitizeMessages(value: unknown): Message[] {
  if (!Array.isArray(value))
    return []

  return value
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item) => {
      const role = item.role === 'assistant' ? 'assistant' : 'user'
      const id = typeof item.id === 'string' && item.id.trim() ? item.id : nextMessageId()
      const content = typeof item.content === 'string' ? item.content : ''
      const timestamp = typeof item.timestamp === 'number' ? item.timestamp : Date.now()
      const agentId = typeof item.agentId === 'string' ? item.agentId : undefined
      const turns = typeof item.turns === 'number' ? item.turns : undefined
      const displayType
        = item.displayType === 'plan'
          || item.displayType === 'code'
          || item.displayType === 'success'
          || item.displayType === 'warning'
          || item.displayType === 'error'
          || item.displayType === 'default'
          ? item.displayType
          : undefined
      return { id, role, content, timestamp, agentId, turns, displayType }
    })
}

function syncMessageCounter(histories: MessageHistoryMap) {
  let maxSeen = messageId
  for (const messages of Object.values(histories)) {
    for (const message of messages) {
      const match = /^msg-(\d+)$/.exec(message.id)
      const value = match ? Number.parseInt(match[1] || '0', 10) : 0
      if (Number.isFinite(value) && value > maxSeen)
        maxSeen = value
    }
  }
  messageId = maxSeen
}

function loadPersistedHistories(): MessageHistoryMap {
  if (!canUsePersistentStorage())
    return {}

  try {
    const raw = localStorage.getItem(ASSISTANT_HISTORIES_STORAGE_KEY)
    if (!raw)
      return {}

    const parsed = JSON.parse(raw) as Record<string, unknown>
    const histories: MessageHistoryMap = {}
    for (const [agentId, value] of Object.entries(parsed)) {
      const sanitized = sanitizeMessages(value).slice(-MAX_PERSISTED_MESSAGES_PER_AGENT)
      if (sanitized.length > 0)
        histories[agentId] = sanitized
    }
    syncMessageCounter(histories)
    return histories
  } catch (error) {
    console.error('[useAssistant] Failed to load message history:', error)
    return {}
  }
}

function loadPersistedSelectedAgent(): string {
  if (!canUsePersistentStorage())
    return 'general'
  return localStorage.getItem(ASSISTANT_AGENT_STORAGE_KEY)?.trim() || 'general'
}

function loadPersistedSelectedModel(): string | undefined {
  if (!canUsePersistentStorage())
    return undefined
  return localStorage.getItem(ASSISTANT_MODEL_STORAGE_KEY)?.trim() || undefined
}

// Global visibility — shared across all useAssistant() calls
// Exported so useAgentSession can share the same ref
export const showAssistant = ref(false)
const messageHistories = ref<MessageHistoryMap>(loadPersistedHistories())
const selectedAgentState = ref(loadPersistedSelectedAgent())
const selectedModelState = ref<string | undefined>(loadPersistedSelectedModel())
const assistantLoadingState = ref(false)
const assistantErrorState = ref<string | null>(null)
const activeStreamRequestIdState = ref<string | null>(null)
const assistantStreamStatus = useStreamStatus()
let persistTimer: ReturnType<typeof setTimeout> | null = null
let storageSyncInitialized = false
let activeStreamUnlisten: (() => void) | null = null

function persistAssistantStateNow() {
  if (!canUsePersistentStorage())
    return

  try {
    localStorage.setItem(ASSISTANT_HISTORIES_STORAGE_KEY, JSON.stringify(messageHistories.value))
    localStorage.setItem(ASSISTANT_AGENT_STORAGE_KEY, selectedAgentState.value)
    if (selectedModelState.value?.trim()) {
      localStorage.setItem(ASSISTANT_MODEL_STORAGE_KEY, selectedModelState.value)
    } else {
      localStorage.removeItem(ASSISTANT_MODEL_STORAGE_KEY)
    }
  } catch (error) {
    console.error('[useAssistant] Failed to persist message history:', error)
  }
}

function queuePersistAssistantState() {
  if (!canUsePersistentStorage())
    return

  if (persistTimer)
    clearTimeout(persistTimer)

  persistTimer = setTimeout(() => {
    persistTimer = null
    persistAssistantStateNow()
  }, 120)
}

function getAgentMessages(agentId: string): Message[] {
  return messageHistories.value[agentId] ?? []
}

function setAgentMessages(agentId: string, nextMessages: Message[], persist = true) {
  messageHistories.value = {
    ...messageHistories.value,
    [agentId]: nextMessages.slice(-MAX_PERSISTED_MESSAGES_PER_AGENT),
  }
  if (persist)
    queuePersistAssistantState()
}

function appendAgentMessage(agentId: string, message: Message, persist = true) {
  setAgentMessages(agentId, [...getAgentMessages(agentId), message], persist)
}

function updateAgentMessage(agentId: string, messageIdToUpdate: string, updater: (message: Message) => Message, persist = true) {
  const current = getAgentMessages(agentId)
  const idx = current.findIndex(message => message.id === messageIdToUpdate)
  if (idx === -1)
    return
  const next = [...current]
  next[idx] = updater(next[idx]!)
  setAgentMessages(agentId, next, persist)
}

function clearAgentMessages(agentId: string) {
  messageHistories.value = {
    ...messageHistories.value,
    [agentId]: [],
  }
  queuePersistAssistantState()
}

function initStorageSync() {
  if (storageSyncInitialized || typeof window === 'undefined')
    return

  window.addEventListener('storage', (event) => {
    if (event.key === ASSISTANT_HISTORIES_STORAGE_KEY) {
      messageHistories.value = loadPersistedHistories()
      return
    }
    if (event.key === ASSISTANT_AGENT_STORAGE_KEY) {
      selectedAgentState.value = loadPersistedSelectedAgent()
      return
    }
    if (event.key === ASSISTANT_MODEL_STORAGE_KEY) {
      selectedModelState.value = loadPersistedSelectedModel()
    }
  })
  storageSyncInitialized = true
}

export function useAssistant() {
  initStorageSync()

  const operator = useOperator()
  const streamStatus = assistantStreamStatus

  const messages = computed(() => getAgentMessages(selectedAgentState.value))
  const isLoading = assistantLoadingState
  const error = assistantErrorState
  const { defaultModelId, resolveModelId } = useAIModel()

  const hasMessages = computed(() => messages.value.length > 0)
  const effectiveModel = computed(() => {
    const preferred = selectedModelState.value?.trim() || defaultModelId.value
    return resolveModelId(preferred, { allowAuto: false })
  })

  async function send(text: string): Promise<void> {
    if (!text.trim() || isLoading.value) return
    const agentId = selectedAgentState.value

    // Add user message
    appendAgentMessage(agentId, {
      id: nextMessageId(),
      role: 'user',
      content: text.trim(),
      timestamp: Date.now(),
    })

    isLoading.value = true
    error.value = null

    // Create assistant message placeholder for streaming
    const assistantId = nextMessageId()
    appendAgentMessage(agentId, {
      id: assistantId,
      role: 'assistant',
      content: '',
      agentId,
      timestamp: Date.now(),
    })

    // Build task with conversation history for multi-turn context
    const history = getAgentMessages(agentId).slice(0, -1) // exclude the placeholder assistant msg
    let task = text.trim()
    if (history.length > 1) {
      const contextMsgs = history.slice(-10) // last 10 messages for context
      const historyStr = contextMsgs
        .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n\n')
      task = `<conversation_history>\n${historyStr}\n</conversation_history>\n\nUser: ${text.trim()}`
    }

    try {
      streamStatus.reset()
      // Try streaming first
      activeStreamUnlisten = await operator.dispatchStream(
        agentId,
        task,
        // onChunk — append text deltas + track status
        (chunk) => {
          streamStatus.handleChunk(chunk)
          const delta = chunk.content || (chunk.data?.text as string) || ''
          if (delta) {
            updateAgentMessage(agentId, assistantId, message => ({
              ...message,
              content: message.content + delta,
            }), false)
            triggerRef(messageHistories)
          }
        },
        // onDone — update with final result
        (result) => {
          streamStatus.handleDone()
          // Check for error in result data (operator wraps errors in data.error)
          const errMsg = (result as unknown as Record<string, unknown>).error as string | undefined
          if (errMsg) {
            error.value = errMsg
            updateAgentMessage(agentId, assistantId, message => ({
              ...message,
              content: message.content || `Error: ${errMsg}`,
              displayType: 'error',
            }))
          } else if (result.content) {
            updateAgentMessage(agentId, assistantId, message => ({
              ...message,
              content: message.content || result.content,
            }))
          } else {
            queuePersistAssistantState()
          }
          updateAgentMessage(agentId, assistantId, message => ({
            ...message,
            agentId: result.agent_id,
            turns: result.turns,
          }))
          activeStreamRequestIdState.value = null
          isLoading.value = false
          if (activeStreamUnlisten) activeStreamUnlisten()
          activeStreamUnlisten = null
        },
        // onError — show error
        (err) => {
          streamStatus.handleError(err)
          error.value = err
          updateAgentMessage(agentId, assistantId, message => ({
            ...message,
            content: message.content || `Error: ${err}`,
            displayType: 'error',
          }))
          activeStreamRequestIdState.value = null
          isLoading.value = false
          if (activeStreamUnlisten) activeStreamUnlisten()
          activeStreamUnlisten = null
        },
        effectiveModel.value,
        undefined,
        (requestId) => {
          activeStreamRequestIdState.value = requestId
        },
      )
    } catch {
      // Streaming not available — fall back to sync dispatch
      try {
        activeStreamRequestIdState.value = null
        const result: DispatchResult = await operator.dispatch(
          agentId,
          task,
          effectiveModel.value,
        )
        updateAgentMessage(agentId, assistantId, message => ({
          ...message,
          content: result.content,
          agentId: result.agent_id,
          turns: result.turns,
        }))
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to get response'
        error.value = msg
        updateAgentMessage(agentId, assistantId, message => ({
          ...message,
          content: `Error: ${msg}`,
          displayType: 'error',
        }))
      } finally {
        activeStreamRequestIdState.value = null
        activeStreamUnlisten = null
        isLoading.value = false
      }
    }
  }

  function clear() {
    if (isLoading.value) {
      void stop()
    }
    clearAgentMessages(selectedAgentState.value)
    error.value = null
    isLoading.value = false
  }

  async function stop() {
    if (!isLoading.value)
      return

    const requestId = activeStreamRequestIdState.value
    const agentId = selectedAgentState.value

    if (requestId) {
      try {
        await operator.stopStream(requestId)
      } catch (stopError) {
        console.error('[useAssistant] Failed to stop stream:', stopError)
      }
    }

    if (activeStreamUnlisten) {
      activeStreamUnlisten()
      activeStreamUnlisten = null
    }

    activeStreamRequestIdState.value = null
    isLoading.value = false
    error.value = null
    streamStatus.reset()

    const currentMessages = getAgentMessages(agentId)
    const lastMessage = currentMessages[currentMessages.length - 1]
    if (lastMessage?.role === 'assistant' && !lastMessage.content.trim()) {
      updateAgentMessage(agentId, lastMessage.id, message => ({
        ...message,
        content: 'Stopped.',
        displayType: 'warning',
      }))
    } else {
      queuePersistAssistantState()
    }
  }

  function setAgent(agentId: string) {
    selectedAgentState.value = agentId
    queuePersistAssistantState()
  }

  function setModel(model: string) {
    selectedModelState.value = model
    queuePersistAssistantState()
  }

  function toggle() {
    showAssistant.value = !showAssistant.value
  }

  function open() {
    showAssistant.value = true
  }

  function close() {
    showAssistant.value = false
  }

  async function openInWindow() {
    if (!isTauriEnv()) {
      const popup = window.open('/assistant', 'assistant-popout', 'width=480,height=700')
      popup?.focus()
      return
    }

    try {
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
      const existingWin = await WebviewWindow.getByLabel('standalone-assistant')
      let win: InstanceType<typeof WebviewWindow>

      if (!existingWin) {
        win = new WebviewWindow('standalone-assistant', {
          url: '/assistant',
          title: 'Operator',
          width: 480,
          height: 700,
          resizable: true,
          visible: true,
          titleBarStyle: 'overlay',
          hiddenTitle: true,
          theme: 'dark',
          center: true,
        })

        await new Promise<void>((resolve, reject) => {
          win.once('tauri://created', () => resolve())
          win.once('tauri://error', error => reject(error))
        })
      } else {
        win = existingWin
        await win.show()
      }

      await win.setFocus()
      showAssistant.value = false
    } catch (e) {
      console.error('[useAssistant] Failed to open window:', e)
    }
  }

  return {
    // State
    messages,
    isLoading,
    error,
    hasMessages,
    selectedAgent: selectedAgentState,
    selectedModel: selectedModelState,
    visible: showAssistant,

    // Status (human-readable progress from operator)
    status: streamStatus.status,
    statusMessage: streamStatus.statusMessage,
    statusNarration: streamStatus.statusNarration,
    progressUpdates: streamStatus.progressUpdates,
    isAgentActive: streamStatus.isActive,
    toolHistory: streamStatus.toolHistory,

    // Actions
    send,
    stop,
    clear,
    setAgent,
    setModel,
    toggle,
    open,
    close,
    openInWindow,

    // Operator access
    operator,
  }
}
