/**
 * Tauri Context Service Composable
 *
 * Provides context service integration using Tauri IPC.
 */

import { ref, computed } from 'vue'

// Check if running in Tauri
const isTauri = ref(false)

// Try to detect Tauri environment
if (typeof window !== 'undefined') {
  isTauri.value = '__TAURI__' in window || '__TAURI_INTERNALS__' in window
}

// Tauri invoke helper
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri.value) {
    throw new Error('Not running in Tauri')
  }
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core')
  return tauriInvoke(cmd, args)
}

export function useTauriContext() {
  const connected = ref(false)
  const mode = ref<'code' | 'design'>('code')
  const currentComponent = ref<{ name: string; type: string } | null>(null)
  const project = ref<{ id: number; name: string } | null>(null)

  // Initialize connection to context service
  async function initialize() {
    if (!isTauri.value) return false

    try {
      // Start the sidecar binary
      const address = await invoke<string>('start_context_service')
      console.log('[tauri] Context service started at:', address)

      // Connect to it
      await invoke('connect_context', { address })
      connected.value = true

      // Get initial context
      const ctx = await invoke<{ mode: string; component?: { name: string; type: string }; project?: { id: number; name: string } }>('context_get')
      mode.value = ctx.mode as 'code' | 'design'
      currentComponent.value = ctx.component || null
      project.value = ctx.project || null

      return true
    } catch (error) {
      console.error('[tauri] Failed to initialize:', error)
      return false
    }
  }

  // Set mode
  async function setMode(newMode: 'code' | 'design') {
    if (!connected.value) return
    await invoke('context_set_mode', { mode: newMode })
    mode.value = newMode
  }

  // Ping for latency
  async function ping(): Promise<number> {
    if (!connected.value) return -1
    const start = performance.now()
    await invoke('context_ping')
    return performance.now() - start
  }

  // List models
  async function listModels(): Promise<{ models: Array<{ name: string }> }> {
    if (!connected.value) return { models: [] }
    return invoke('list_models')
  }

  // Chat (non-streaming)
  async function chat(request: {
    model: string
    messages: Array<{ role: string; content: string }>
  }) {
    if (!connected.value) throw new Error('Not connected')
    return invoke('chat_direct', {
      model: request.model,
      messages: request.messages,
    })
  }

  // Chat stream - Tauri version
  // Note: For streaming, we'd need to use Tauri events
  async function chatStream(
    request: {
      model: string
      messages: Array<{ role: string; content: string }>
      token?: string
    },
    onChunk: (chunk: { content?: string; done?: boolean; error?: string }) => void
  ) {
    if (!connected.value) throw new Error('Not connected')

    // For now, fall back to non-streaming
    // TODO: Implement proper streaming with Tauri events
    try {
      const response = await invoke<{ message: { content: string } }>('chat_direct', {
        model: request.model,
        messages: request.messages,
      })

      // Simulate streaming by sending the whole response
      onChunk({ content: response.message?.content || '', done: true })
    } catch (error) {
      onChunk({ error: error instanceof Error ? error.message : 'Unknown error', done: true })
    }
  }

  return {
    isTauri,
    connected: computed(() => connected.value),
    mode: computed(() => mode.value),
    currentComponent: computed(() => currentComponent.value),
    project: computed(() => project.value),
    initialize,
    setMode,
    ping,
    listModels,
    chat,
    chatStream,
  }
}
