/**
 * useBrainBridge — the single dispatch table for everything brain
 * asks the frontend to do.
 *
 * Brain pushes bridge calls in two transports:
 *   1. SSE `tool_request` chunks on the active prompt stream (brain-native;
 *      most calls go here).
 *   2. Tauri events (operator legacy; screenshots/mouse/native ops the
 *      webview can't reach directly).
 *
 * Both transports route through `dispatch(method, params)` in this file —
 * one table, one resolution path. Frontend components register handlers
 * on mount and unregister on unmount; no global mutables.
 *
 * Usage:
 *   const bridge = useBrainBridge()
 *   onMounted(() => bridge.register('permission.request', async (params) => {
 *     return { allow: true }
 *   }))
 *   onUnmounted(() => bridge.unregister('permission.request'))
 */

export type BridgeHandler = (params: Record<string, unknown>) => Promise<unknown>

interface BridgeState {
  handlers: Map<string, BridgeHandler>
  /** Default handlers wired at module load (space.*, org.*, project.*) — the
   *  operator-legacy dispatch that doesn't need a Vue component to mount. */
  defaults: Map<string, BridgeHandler>
}

const state: BridgeState = {
  handlers: new Map(),
  defaults: new Map(),
}

/**
 * registerDefault — wire a fallback handler that runs when nothing has
 * register()'d for the method. Used by the static dispatch table
 * (space.snapshot, org.members, etc.) that lives in this module so the
 * Tauri listener and the SSE channel both find it.
 */
export function registerDefault(method: string, handler: BridgeHandler) {
  state.defaults.set(method, handler)
}

/**
 * dispatch — single entry point for both transports. Throws on unknown
 * method so the caller can surface the error back to brain as
 * `tool_response.error` and let the model see "unknown bridge method: X".
 */
export async function dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
  const fn = state.handlers.get(method) ?? state.defaults.get(method)
  if (!fn) {
    throw new Error(`Unknown bridge method: ${method}`)
  }
  return await fn(params)
}

export function useBrainBridge() {
  return {
    /** Register a handler. Replaces any prior handler for the same method. */
    register(method: string, handler: BridgeHandler) {
      state.handlers.set(method, handler)
    },
    /** Unregister, restoring the default handler if one was set. */
    unregister(method: string) {
      state.handlers.delete(method)
    },
    dispatch,
  }
}
