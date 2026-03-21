/**
 * Automation types for the operator <-> frontend bridge.
 *
 * Spaces register an AutomationProvider to expose semantic actions.
 * The operator calls these via the desktop bridge (space.snapshot, space.run_action, etc).
 */

export interface SpaceSnapshot {
  space_id: string
  title: string
  state: Record<string, unknown>
  actions: string[]
}

export interface AutomationAction {
  id: string
  description: string
  params?: Record<string, unknown> // JSON Schema
}

export interface ActionResult {
  success: boolean
  data?: Record<string, unknown>
  error?: string
}

export interface AutomationProvider {
  snapshot(): Promise<SpaceSnapshot> | SpaceSnapshot
  listActions(): AutomationAction[]
  runAction(actionId: string, payload?: Record<string, unknown>): Promise<ActionResult> | ActionResult
}
