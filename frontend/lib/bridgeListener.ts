/**
 * Bridge Listener
 *
 * Listens for `bridge:request` events from Tauri (emitted by the desktop bridge
 * when operator sends space.* requests). Dispatches to registered automation
 * providers and sends results back via the `bridge_respond` Tauri command.
 *
 * Must only run in the main window. Uses window-scoped listener to match
 * the Rust emit_to targeting (EventTarget::WebviewWindow "main").
 */

import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { invoke } from '@tauri-apps/api/core'
import { getAutomationProvider, getActiveSpace } from '@/lib/spaceContextBus'

interface BridgeRequest {
  id: string
  method: string
  params?: Record<string, unknown>
}

let unlisten: (() => void) | null = null

/**
 * Start listening for bridge:request events from Tauri.
 * Call once at app startup — only in the main window.
 */
export async function startBridgeListener(): Promise<void> {
  if (unlisten) return // already listening

  // Window-scoped listen: only receives events targeted at this webview window.
  // Rust uses emit_to(&main_window, ...) so only this listener receives bridge requests.
  const currentWindow = getCurrentWebviewWindow()
  unlisten = await currentWindow.listen<BridgeRequest>('bridge:request', async (event) => {
    const { id, method, params } = event.payload
    try {
      const result = await handleBridgeRequest(method, params ?? {})
      await invoke('bridge_respond', { id, result })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      await invoke('bridge_respond', {
        id,
        result: { error: message },
      })
    }
  })
}

/**
 * Stop the bridge listener.
 */
export function stopBridgeListener(): void {
  if (unlisten) {
    unlisten()
    unlisten = null
  }
}

async function handleBridgeRequest(
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  switch (method) {
    case 'space.snapshot':
      return handleSpaceSnapshot(params)
    case 'space.list_actions':
      return handleSpaceListActions(params)
    case 'space.run_action':
      return handleSpaceRunAction(params)
    default:
      throw new Error(`Unknown bridge method: ${method}`)
  }
}

async function handleSpaceSnapshot(params: Record<string, unknown>) {
  const spaceId = resolveSpaceId(params)
  const provider = getAutomationProvider(spaceId)
  if (!provider) {
    throw new Error(`No automation provider registered for space: ${spaceId}`)
  }
  return await provider.snapshot()
}

async function handleSpaceListActions(params: Record<string, unknown>) {
  const spaceId = resolveSpaceId(params)
  const provider = getAutomationProvider(spaceId)
  if (!provider) {
    throw new Error(`No automation provider registered for space: ${spaceId}`)
  }
  return {
    space_id: spaceId,
    actions: provider.listActions(),
  }
}

async function handleSpaceRunAction(params: Record<string, unknown>) {
  const spaceId = resolveSpaceId(params)
  const action = params.action as string
  const payload = (params.payload as Record<string, unknown>) ?? {}

  if (!action) {
    throw new Error('space.run_action requires an "action" parameter')
  }

  const provider = getAutomationProvider(spaceId)
  if (!provider) {
    throw new Error(`No automation provider registered for space: ${spaceId}`)
  }
  return await provider.runAction(action, payload)
}

/**
 * Resolve space ID from params.
 * Priority: explicit param > active space from router > error.
 */
function resolveSpaceId(params: Record<string, unknown>): string {
  // 1. Explicit space_id in request
  if (params.space_id && typeof params.space_id === 'string') {
    return params.space_id
  }

  // 2. Currently active space (tracked by router)
  const active = getActiveSpace()
  if (active) {
    return active
  }

  // 3. No active space — error, don't guess
  throw new Error('No active space. Navigate to a space or pass space_id explicitly.')
}
