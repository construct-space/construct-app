/**
 * Stream event types — shared protocol between operator (Go) and frontend (TypeScript).
 * Go structs: construct-operator/internal/stream/events.go
 *
 * Both sides use the same field names and event type constants.
 */

// ─── Event type constants ───

export const StreamType = {
  ToolCall: 'tool.call',
  ToolResult: 'tool.result',
  Status: 'status',
  TurnStart: 'turn.start',
  TurnEnd: 'turn.end',
  Text: 'text',
  Stream: 'stream',
  Done: 'done',
  VibeSession: 'vibe.session',
} as const

// ─── Event data interfaces ───

export interface ToolCallEvent {
  tool: string
  call_id: string
  input?: string
  title: string
}

export interface ToolResultEvent {
  tool: string
  call_id: string
  input?: string
  content?: string
  is_error: boolean
  title: string
}

export interface StatusEvent {
  state: 'thinking' | 'tool_running' | 'tool_done' | 'complete' | 'error'
  message: string
  tool?: string
  call_id?: string
  turn?: number
  max_turns?: number
  is_error?: boolean
}

export interface TurnStartEvent {
  turn: number
  max_turns: number
}

export interface TurnEndEvent {
  turn: number
  tool_calls: number
  nudge?: boolean
}

export interface TextEvent {
  text: string
}

export interface VibeSessionEvent {
  session_id: string
  goal?: string
  source?: string
  space?: string
  status?: string
  project_id?: string
  project_name?: string
  project_path?: string
  current_phase?: string
}

export interface DoneEvent {
  content?: string
  turns?: number
  stop_reason?: string
}
