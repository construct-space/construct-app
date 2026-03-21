/**
 * Space Context Bus
 *
 * Lightweight pub/sub so spaces can publish context summaries and the host
 * can subscribe — without importing domain stores directly.
 * Also provides automation provider registration for the operator bridge.
 *
 * Patterns:
 * - publish/subscribe: spaces push state snapshots, host listens
 * - request/response: host requests specific data, space handler responds
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpaceContextPayload {
  spaceId: string
  type: string
  summary: Record<string, unknown>
  timestamp: number
}

export type SpaceContextCallback = (payload: SpaceContextPayload) => void

export type ContextHandler = (request: { type: string; params?: Record<string, unknown> }) => Promise<unknown> | unknown

// ---------------------------------------------------------------------------
// Automation types (re-exported from types/automation.ts)
// ---------------------------------------------------------------------------

export type { AutomationProvider, SpaceSnapshot, AutomationAction, ActionResult } from '@/types/automation'
import type { AutomationProvider } from '@/types/automation'

// ---------------------------------------------------------------------------
// Internal state (module-level singletons)
// ---------------------------------------------------------------------------

const listeners = new Map<string, Set<SpaceContextCallback>>()
const latestContext = new Map<string, SpaceContextPayload>()
const handlers = new Map<string, ContextHandler>()
const automationProviders = new Map<string, AutomationProvider>()
let activeSpaceId: string | null = null

// Wildcard subscribers (receive all types)
const wildcardListeners = new Set<SpaceContextCallback>()

// ---------------------------------------------------------------------------
// Publish / Subscribe
// ---------------------------------------------------------------------------

/**
 * Publish a context snapshot from a space.
 * Spaces call this when their state changes.
 */
export function publishSpaceContext(payload: SpaceContextPayload): void {
  latestContext.set(payload.type, payload)

  // Notify type-specific listeners
  const typeListeners = listeners.get(payload.type)
  if (typeListeners) {
    for (const cb of typeListeners) {
      try { cb(payload) } catch (e) { console.warn('[ContextBus] Listener error:', e) }
    }
  }

  // Notify wildcard listeners
  for (const cb of wildcardListeners) {
    try { cb(payload) } catch (e) { console.warn('[ContextBus] Wildcard listener error:', e) }
  }
}

/**
 * Subscribe to context updates from spaces.
 * Pass '*' as type to subscribe to all context types.
 * Returns an unsubscribe function.
 */
export function subscribeSpaceContext(type: string, callback: SpaceContextCallback): () => void {
  if (type === '*') {
    wildcardListeners.add(callback)
    return () => { wildcardListeners.delete(callback) }
  }

  let set = listeners.get(type)
  if (!set) {
    set = new Set()
    listeners.set(type, set)
  }
  set.add(callback)

  return () => { set!.delete(callback) }
}

/**
 * Get the most recently published context for a given type.
 */
export function getLatestSpaceContext(type: string): SpaceContextPayload | undefined {
  return latestContext.get(type)
}

// ---------------------------------------------------------------------------
// Request / Response
// ---------------------------------------------------------------------------

/**
 * Register a handler that can respond to data requests from the host.
 * Each spaceId can have one handler.
 */
export function registerContextHandler(spaceId: string, handler: ContextHandler): () => void {
  handlers.set(spaceId, handler)
  return () => { handlers.delete(spaceId) }
}

/**
 * Request specific data from a space's registered handler.
 * Returns undefined if no handler is registered for the space.
 */
export async function requestSpaceData(
  spaceId: string,
  params?: { type: string; params?: Record<string, unknown> },
): Promise<unknown> {
  const handler = handlers.get(spaceId)
  if (!handler) return undefined

  const request = params ?? { type: 'default' }
  try {
    return await handler(request)
  } catch (e) {
    console.warn(`[ContextBus] Handler error for "${spaceId}":`, e)
    return undefined
  }
}

// ---------------------------------------------------------------------------
// Automation Providers
// ---------------------------------------------------------------------------

/**
 * Register an automation provider for a space.
 * The operator calls these via the desktop bridge (space.snapshot, etc).
 */
export function registerAutomationProvider(spaceId: string, provider: AutomationProvider): () => void {
  automationProviders.set(spaceId, provider)
  return () => { automationProviders.delete(spaceId) }
}

/**
 * Get a registered automation provider by space ID.
 */
export function getAutomationProvider(spaceId: string): AutomationProvider | undefined {
  return automationProviders.get(spaceId)
}

/**
 * List all space IDs that have registered automation providers.
 */
export function listAutomationProviders(): string[] {
  return Array.from(automationProviders.keys())
}

// ---------------------------------------------------------------------------
// Active Space Tracking
// ---------------------------------------------------------------------------

/**
 * Set the currently active space ID. Called by the router on navigation.
 */
export function setActiveSpace(spaceId: string | null): void {
  activeSpaceId = spaceId
}

/**
 * Get the currently active space ID.
 */
export function getActiveSpace(): string | null {
  return activeSpaceId
}
