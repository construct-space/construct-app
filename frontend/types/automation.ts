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
  /**
   * Action's declared cost tier ('small' | 'medium' | 'large'). Set when
   * the action calls useBrain() internally — the host honours it when
   * resolving the model. Absent for plain CRUD actions.
   */
  tier?: 'small' | 'medium' | 'large'
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
