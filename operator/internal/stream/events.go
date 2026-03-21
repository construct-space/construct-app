package stream

// Typed event data structures for the operator → frontend protocol.
// Frontend TypeScript interfaces mirror these exactly.
// See: construct/src/operator/streamEvents.ts

// ToolCallEvent is emitted when a tool execution starts.
// Frontend type: ToolCallEvent
type ToolCallEvent struct {
	Tool   string `json:"tool"`
	CallID string `json:"call_id"`
	Input  string `json:"input,omitempty"`
	Title  string `json:"title"`
}

// ToolResultEvent is emitted when a tool execution completes.
// Frontend type: ToolResultEvent
type ToolResultEvent struct {
	Tool    string `json:"tool"`
	CallID  string `json:"call_id"`
	Input   string `json:"input,omitempty"`
	Content string `json:"content,omitempty"`
	IsError bool   `json:"is_error"`
	Title   string `json:"title"`
}

// StatusEvent is a human-readable status update.
// Frontend type: StatusEvent
type StatusEvent struct {
	State    string `json:"state"`   // thinking, tool_running, tool_done, complete, error
	Message  string `json:"message"` // Human-readable one-liner
	Tool     string `json:"tool,omitempty"`
	CallID   string `json:"call_id,omitempty"`
	Turn     int    `json:"turn,omitempty"`
	MaxTurns int    `json:"max_turns,omitempty"`
	IsError  bool   `json:"is_error,omitempty"`
}

// TurnStartEvent is emitted at the beginning of each agent loop turn.
// Frontend type: TurnStartEvent
type TurnStartEvent struct {
	Turn     int `json:"turn"`
	MaxTurns int `json:"max_turns"`
}

// TurnEndEvent is emitted at the end of each agent loop turn.
// Frontend type: TurnEndEvent
type TurnEndEvent struct {
	Turn      int  `json:"turn"`
	ToolCalls int  `json:"tool_calls"`
	Nudge     bool `json:"nudge,omitempty"`
}

// TextEvent is emitted for streaming LLM text output.
// Frontend type: TextEvent
type TextEvent struct {
	Text string `json:"text"`
}

// SessionStartEvent is emitted when a vibe session begins.
// Frontend type: VibeSessionEvent
type SessionStartEvent struct {
	SessionID    string `json:"session_id"`
	Goal         string `json:"goal,omitempty"`
	Source       string `json:"source,omitempty"`
	Space        string `json:"space,omitempty"`
	Status       string `json:"status,omitempty"`
	ProjectID    string `json:"project_id,omitempty"`
	ProjectName  string `json:"project_name,omitempty"`
	ProjectPath  string `json:"project_path,omitempty"`
	CurrentPhase string `json:"current_phase,omitempty"`
}

// DoneEvent is emitted when the stream completes.
// Frontend type: DoneEvent
type DoneEvent struct {
	Content    string `json:"content,omitempty"`
	Turns      int    `json:"turns,omitempty"`
	StopReason string `json:"stop_reason,omitempty"`
}

// Event type constants for the protocol.
const (
	TypeToolCall    = "tool.call"
	TypeToolResult  = "tool.result"
	TypeStatus      = "status"
	TypeTurnStart   = "turn.start"
	TypeTurnEnd     = "turn.end"
	TypeText        = "text"
	TypeStream      = "stream" // Vibe batched text
	TypeDone        = "done"
	TypeVibeSession = "vibe.session"
)
