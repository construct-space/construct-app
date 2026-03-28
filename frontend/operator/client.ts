/**
 * useOperator — Thin client for Construct Operator
 *
 * Single composable replacing useContextService. The frontend sends
 * requests to Operator and renders what comes back.
 *
 * Protocol: TCP with newline-delimited JSON (via Tauri IPC bridge)
 * Default operator address is 127.0.0.1:60100; Construct DEV uses 127.0.0.1:60200
 */

import { ref, readonly, computed } from 'vue'
import { useAuthStore } from '@/stores/auth'
import type { Ref } from 'vue'
import type {
  AIProvider,
  ProvidersResponse,
  OperatorAgent,
  DispatchResult,
  ChatResult,
  ToolCall,
  ToolResult,
  StreamEvent,
  SystemInfo,
  ProjectContext,
  ComponentContext,
  Mode,
} from './types'

// Re-export types
export type {
  AIProvider,
  ProvidersResponse,
  OperatorAgent,
  DispatchResult,
  ChatResult,
  ToolCall,
  ToolResult,
  StreamEvent,
  SystemInfo,
  ProjectContext,
  ComponentContext,
  Mode,
}

// ─── Shared state (singleton across all components) ───

const connected = ref(false)
const connecting = ref(false)
const version = ref('')
const error = ref<string | null>(null)
const isTauri = ref(typeof window !== 'undefined' && '__TAURI__' in window)

// Context state
const mode = ref<Mode>('code')
const project = ref<ProjectContext | null>(null)
const currentComponent = ref<ComponentContext | null>(null)
let streamRequestCounter = 0

function nextStreamRequestId() {
  streamRequestCounter += 1
  return `stream-${Date.now()}-${streamRequestCounter}`
}

function shouldReconnectStreamError(message: string) {
  const normalized = message.toLowerCase()
  return normalized.includes('not connected')
    || normalized.includes('connection failed')
    || normalized.includes('connection closed')
}

// ─── Core send — uses existing Tauri bridge ───

async function send<T = Record<string, unknown>>(
  requestType: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  if (!isTauri.value) {
    throw new Error('Operator requires Construct desktop app')
  }

  const { invoke } = await import('@tauri-apps/api/core')

  try {
    return await invoke<T>('send_context_request', {
      requestType,
      payload: payload || {},
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    error.value = msg
    throw new Error(`Operator: ${requestType} failed — ${msg}`, { cause: e })
  }
}

// ─── Composable ───

export function useOperator() {

  // ─── Connection ───

  async function connect(): Promise<boolean> {
    if (connected.value) return true
    connecting.value = true
    error.value = null

    try {
      // Trigger Tauri to start/connect to operator
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke<string>('start_context_service')

      const result = await send<{ status: string; version: string }>('system.ping')
      if (result.status === 'ok') {
        connected.value = true
        version.value = result.version
        return true
      }
      return false
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      connected.value = false
      return false
    } finally {
      connecting.value = false
    }
  }

  async function info(): Promise<SystemInfo> {
    return send<SystemInfo>('system.info')
  }

  // ─── Discovery ───

  async function listProviders(): Promise<ProvidersResponse> {
    if (!isTauri.value) {
      return { providers: [], default: '', defaultProvider: '', defaultModel: '' }
    }

    if (!connected.value) {
      return { providers: [], default: '', defaultProvider: '', defaultModel: '' }
    }

    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<ProvidersResponse>('list_providers')
  }

  async function listAgents(): Promise<OperatorAgent[]> {
    const result = await send<{ agents: OperatorAgent[]; count: number }>('agents.list')
    return result.agents || []
  }

  async function listTools(): Promise<string[]> {
    const result = await send<{ tools: string[]; count: number }>('tools.list')
    return result.tools || []
  }

  // ─── Agent execution ───

  async function dispatch(agentId: string, task: string, model?: string): Promise<DispatchResult> {
    return send<DispatchResult>('agents.dispatch', {
      agent_id: agentId,
      task,
      ...(model ? { model } : {}),
    })
  }

  // ─── Chat ───

  async function chat(message: string, model?: string): Promise<ChatResult> {
    return send<ChatResult>('ai.chat', {
      message,
      ...(model ? { model } : {}),
    })
  }

  // ─── Tools ───

  async function executeTool(name: string, input: Record<string, unknown>): Promise<ToolResult> {
    return send<ToolResult>('tool.execute', {
      name,
      input: JSON.stringify(input),
    })
  }

  async function callTool(toolCall: ToolCall): Promise<ToolResult> {
    return send<ToolResult>('tools.call', {
      toolCall,
      token: useAuthStore().token || '',
    })
  }

  // ─── Context ───

  async function setProject(proj: ProjectContext): Promise<void> {
    if (!isTauri.value) return
    await send('context.set_project', proj as unknown as Record<string, unknown>)
    project.value = proj
  }

  async function clearProject(): Promise<void> {
    if (!isTauri.value) return
    await send('context.clear_project', {})
    project.value = null
  }

  async function setMode(newMode: Mode): Promise<void> {
    if (!isTauri.value) return
    await send('context.set_mode', { mode: newMode })
    mode.value = newMode
  }

  async function setComponent(comp: ComponentContext): Promise<void> {
    if (!isTauri.value) return
    await send('context.set_component', comp as unknown as Record<string, unknown>)
    currentComponent.value = comp
  }

  // ─── Streaming ───

  async function stream(
    requestType: string,
    payload: Record<string, unknown>,
    onChunk: (chunk: StreamEvent) => void,
    onDone?: (data: Record<string, unknown>) => void,
    onError?: (error: string) => void,
    onStart?: (requestId: string) => void,
  ): Promise<() => void> {
    if (!isTauri.value) {
      throw new Error('Streaming requires Construct desktop app')
    }

    const runStream = async (attempt: number): Promise<() => void> => {
      if (!connected.value) {
        const didConnect = await connect()
        if (!didConnect) {
          throw new Error('Operator connection unavailable')
        }
      }

      const { invoke } = await import('@tauri-apps/api/core')
      const { listen } = await import('@tauri-apps/api/event')
      const requestId = nextStreamRequestId()
      onStart?.(requestId)

      const rawUnlisten = await listen<StreamEvent>('operator-stream-chunk', (event) => {
        const chunk = event.payload
        const dataRequestId = typeof chunk.data?.requestId === 'string'
          ? chunk.data.requestId
          : undefined
        const chunkRequestId = chunk.requestId || dataRequestId
        if (chunkRequestId && chunkRequestId !== requestId) {
          return
        }
        if (chunk.error) {
          cleanup()
          if (shouldReconnectStreamError(chunk.error)) {
            connected.value = false
          }
          onError?.(chunk.error)
          return
        }
        if (chunk.done) {
          cleanup()
          onDone?.(chunk.data || {})
          return
        }
        onChunk(chunk)
      })
      let isCleanedUp = false
      const cleanup = () => {
        if (isCleanedUp) return
        isCleanedUp = true
        rawUnlisten()
      }

      try {
        await invoke('operator_stream', {
          requestType,
          payload,
          requestId,
        })
        return cleanup
      } catch (e) {
        cleanup()
        const message = e instanceof Error ? e.message : String(e)
        if (attempt === 0 && shouldReconnectStreamError(message)) {
          connected.value = false
          const didReconnect = await connect()
          if (didReconnect) {
            return runStream(attempt + 1)
          }
        }
        throw e
      }
    }

    return runStream(0)
  }

  async function dispatchStream(
    agentId: string,
    task: string,
    onChunk: (chunk: StreamEvent) => void,
    onDone?: (result: DispatchResult) => void,
    onError?: (error: string) => void,
    model?: string,
    options?: {
      projectPath?: string
      projectName?: string
      sessionId?: string
    },
    onStart?: (requestId: string) => void,
  ): Promise<() => void> {
    return stream(
      'agents.dispatch_stream',
      {
        agent_id: agentId,
        task,
        ...(model ? { model } : {}),
        ...(options?.projectPath ? { project_path: options.projectPath } : {}),
        ...(options?.projectName ? { project_name: options.projectName } : {}),
        ...(options?.sessionId ? { session_id: options.sessionId } : {}),
      },
      onChunk,
      (data) => onDone?.(data as unknown as DispatchResult),
      onError,
      onStart,
    )
  }

  async function chatStream(
    message: string,
    onChunk: (chunk: StreamEvent) => void,
    onDone?: (result: ChatResult) => void,
    onError?: (error: string) => void,
    model?: string,
    onStart?: (requestId: string) => void,
  ): Promise<() => void> {
    return stream(
      'ai.chat_stream',
      { message, ...(model ? { model } : {}) },
      onChunk,
      (data) => onDone?.(data as unknown as ChatResult),
      onError,
      onStart,
    )
  }

  async function stopStream(requestId: string): Promise<void> {
    if (!isTauri.value || !requestId) return
    // Send cancel to operator first — this cancels the runner's context immediately
    try {
      await send('stream.cancel', { request_id: requestId })
    } catch { /* ignore — operator may already be done */ }
    // Then close the frontend socket
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('operator_stop_stream', { requestId })
  }

  return {
    // State
    connected: readonly(connected) as unknown as Ref<boolean>,
    connecting: readonly(connecting) as unknown as Ref<boolean>,
    version: readonly(version) as unknown as Ref<string>,
    error: readonly(error) as unknown as Ref<string | null>,
    isTauri: readonly(isTauri) as unknown as Ref<boolean>,
    mode: readonly(mode) as unknown as Ref<Mode>,
    project: readonly(project) as unknown as Ref<ProjectContext | null>,
    currentComponent: readonly(currentComponent) as unknown as Ref<ComponentContext | null>,

    // Connection
    connect,
    info,

    // Discovery
    listProviders,
    listAgents,
    listTools,

    // Agent execution
    dispatch,
    dispatchStream,

    // Chat
    chat,
    chatStream,
    stopStream,

    // Streaming (generic)
    stream,

    // Tools
    executeTool,
    callTool,

    // Context
    setProject,
    clearProject,
    setMode,
    setComponent,

    // Auth
    refreshTokens: async () => {},

    // Raw access (replaces sendRequest)
    send,
  }
}

// ─── Convenience composables ───

export function useContextMode() {
  const { mode, setMode, connected, isTauri } = useOperator()
  return {
    mode,
    setMode,
    connected,
    isTauri,
    isCode: computed(() => mode.value === 'code'),
    isUI: computed(() => mode.value === 'ui'),
  }
}

export function useComponentContext() {
  const { currentComponent, setComponent, connected, isTauri } = useOperator()

  async function focusComponent(name: string, type = 'component') {
    await setComponent({ name, type })
  }

  return {
    component: currentComponent,
    setComponent,
    focusComponent,
    connected,
    isTauri,
  }
}
