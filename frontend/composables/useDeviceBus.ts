/**
 * useDeviceBus — handlers for cross-device commands the user fires
 * from one of their other devices (e.g. "ask the assistant from my
 * phone").
 *
 * Server contract: delivery-api fans out
 *   { type: 'device.command', command: { cmd, from?, payload } }
 * over the same WS the notification stream uses. The WS reader in
 * useNotifications.ts forwards `device.command` envelopes to
 * `dispatchDeviceCommand` here.
 *
 * The operator process owns assistant.ask execution end-to-end: it
 * subscribes to the same WS, runs the prompt with a streaming
 * emitter, and publishes:
 *
 *   - assistant.chunk    — { request_id, delta }
 *   - assistant.complete — { request_id, content, stop_reason }
 *
 * The desktop UI consumes those to render the conversation as if the
 * user typed it locally — `AssistantPanel.vue` registers a handler
 * here at mount time and translates the chunks into Turn updates.
 */

import { getCurrentWindow } from '@tauri-apps/api/window'
import { showAssistant } from '@/composables/useAssistantPanel'

export interface DeviceCommandPayload {
  cmd: string
  from?: string
  payload?: unknown
}

export interface RemoteAssistantAsk {
  kind: 'ask'
  requestId: string
  text: string
  from?: string
}

export interface RemoteAssistantChunk {
  kind: 'chunk'
  requestId: string
  delta: string
}

export interface RemoteAssistantComplete {
  kind: 'complete'
  requestId: string
  content: string
  stopReason: string
}

export type RemoteAssistantEvent =
  | RemoteAssistantAsk
  | RemoteAssistantChunk
  | RemoteAssistantComplete

type Handler = (ev: RemoteAssistantEvent) => void

// Single subscriber slot — AssistantPanel registers itself on mount
// and unregisters on unmount. If no panel is mounted yet, `ask`
// events that arrive get queued so the panel can replay them once
// it comes up; chunk/complete events that miss the panel are dropped
// (acceptable: the bus is best-effort and the operator emits a
// final `complete` with the whole content as backstop).
let handler: Handler | null = null
const askQueue: RemoteAssistantAsk[] = []

export function onRemoteAssistantEvent(fn: Handler): () => void {
  handler = fn
  // Replay pending asks so we don't miss anything that landed before
  // mount. Chunk/complete are only queued for active asks anyway,
  // so they're handler-local state.
  while (askQueue.length) {
    const ev = askQueue.shift()
    if (ev) fn(ev)
  }
  return () => {
    if (handler === fn) handler = null
  }
}

async function bringWindowForward() {
  try {
    const win = getCurrentWindow()
    await win.show().catch(() => {})
    await win.unminimize().catch(() => {})
    await win.setFocus().catch(() => {})
  } catch { /* not in tauri */ }
}

export function dispatchDeviceCommand(cmd: DeviceCommandPayload) {
  switch (cmd.cmd) {
    case 'assistant.ask': {
      const p = cmd.payload as { text?: string; request_id?: string } | undefined
      const text = p?.text?.trim()
      const requestId = p?.request_id
      if (!text || !requestId) return
      const ev: RemoteAssistantAsk = { kind: 'ask', requestId, text, from: cmd.from }
      showAssistant.value = true
      bringWindowForward()
      if (handler) handler(ev)
      else askQueue.push(ev)
      return
    }
    case 'assistant.chunk': {
      const p = cmd.payload as { request_id?: string; delta?: string } | undefined
      const requestId = p?.request_id
      const delta = p?.delta
      if (!requestId || typeof delta !== 'string') return
      handler?.({ kind: 'chunk', requestId, delta })
      return
    }
    case 'assistant.complete': {
      const p = cmd.payload as { request_id?: string; content?: string; stop_reason?: string } | undefined
      const requestId = p?.request_id
      if (!requestId) return
      handler?.({
        kind: 'complete',
        requestId,
        content: p?.content || '',
        stopReason: p?.stop_reason || 'complete',
      })
      return
    }
    default:
      return
  }
}
