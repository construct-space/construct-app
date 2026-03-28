// Package provider defines the LLM provider abstraction.
// Operator uses a unified message-based interface that works with any LLM.
package provider

import "context"

// Message is a provider-agnostic chat message.
type Message struct {
	Role             string      `json:"role"` // system, user, assistant, tool
	Content          string      `json:"content,omitempty"`
	ReasoningContent string      `json:"reasoning_content,omitempty"` // DeepSeek reasoner thinking
	ToolCalls        []ToolCall  `json:"tool_calls,omitempty"`
	ToolResult       *ToolResult `json:"tool_result,omitempty"`
}

// ToolCall is an LLM's request to invoke a tool.
type ToolCall struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Input string `json:"input"` // JSON string
}

// ToolResult is the result of executing a tool.
type ToolResult struct {
	CallID  string `json:"call_id"`
	Content string `json:"content"`
	IsError bool   `json:"is_error,omitempty"`
}

// ToolDef describes a tool the LLM can call.
type ToolDef struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	InputSchema any    `json:"input_schema"` // JSON Schema
}

// Request is a provider-agnostic completion request.
type Request struct {
	Model       string    `json:"model"`
	Messages    []Message `json:"messages"`
	Tools       []ToolDef `json:"tools,omitempty"`
	ToolChoice  string    `json:"tool_choice,omitempty"` // "auto", "required"
	MaxTokens   int       `json:"max_tokens,omitempty"`
	Temperature *float64  `json:"temperature,omitempty"`
	System      string    `json:"system,omitempty"`
	Stream      bool      `json:"stream,omitempty"`
}

// Response is a provider-agnostic completion response.
type Response struct {
	Content          string     `json:"content,omitempty"`
	ReasoningContent string     `json:"reasoning_content,omitempty"` // DeepSeek reasoner thinking
	ToolCalls        []ToolCall `json:"tool_calls,omitempty"`
	StopReason       string     `json:"stop_reason"` // end_turn, tool_use, max_tokens
	Usage            Usage      `json:"usage"`
}

// Usage tracks token consumption.
type Usage struct {
	InputTokens  int `json:"input_tokens"`
	OutputTokens int `json:"output_tokens"`
	CacheRead    int `json:"cache_read,omitempty"`
	CacheWrite   int `json:"cache_write,omitempty"`
}

// StreamEvent is a chunk from a streaming response.
type StreamEvent struct {
	Type      string    `json:"type"` // text_delta, tool_call_start, tool_call_delta, done, error
	Text      string    `json:"text,omitempty"`
	ToolCall  *ToolCall `json:"tool_call,omitempty"`
	Response  *Response `json:"response,omitempty"` // Set on "done"
	Error     string    `json:"error,omitempty"`
}

// Provider is the interface every LLM backend must implement.
type Provider interface {
	// ID returns the provider key (e.g. "anthropic", "deepseek", "openai").
	ID() string

	// Models returns the list of model IDs this provider supports.
	Models() []string

	// Complete sends a request and returns a response.
	Complete(ctx context.Context, req *Request) (*Response, error)

	// Stream sends a request and returns a channel of streaming events.
	Stream(ctx context.Context, req *Request) (<-chan StreamEvent, error)
}
