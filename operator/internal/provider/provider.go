// Package provider defines the LLM provider abstraction.
// Operator uses a unified message-based interface that works with any LLM.
package provider

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

// Capabilities declares what a provider/model supports.
// Connectors report these at registration so the runner can make
// informed decisions (e.g. skip structured output for providers
// that do not support it).
type Capabilities struct {
	SupportsStructuredOutput bool `json:"supports_structured_output"`
	SupportsTools            bool `json:"supports_tools"`
	SupportsStreaming         bool `json:"supports_streaming"`
	MaxContextTokens         int  `json:"max_context_tokens,omitempty"`
}

// RateLimitError is returned when a provider responds with HTTP 429.
// It carries the suggested wait duration parsed from retry-after or
// x-ratelimit-reset-ms headers.
type RateLimitError struct {
	Provider    string
	RetryAfter  time.Duration
	Underlying  error
}

func (e *RateLimitError) Error() string {
	if e.RetryAfter > 0 {
		return fmt.Sprintf("%s rate limited, retry after %s: %v", e.Provider, e.RetryAfter, e.Underlying)
	}
	return fmt.Sprintf("%s rate limited: %v", e.Provider, e.Underlying)
}

func (e *RateLimitError) Unwrap() error { return e.Underlying }

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

	// OutputSchema requests structured output from the model.
	// The provider should use this for native JSON schema enforcement
	// when the model supports it, and ignore it otherwise.
	// SchemaName is a human label (e.g. "architect.v1").
	// SchemaJSON is the JSON Schema definition as raw bytes.
	OutputSchema *OutputSchemaConfig `json:"output_schema,omitempty"`
}

// OutputSchemaConfig describes a structured output request.
type OutputSchemaConfig struct {
	Name   string          `json:"name"`
	Schema json.RawMessage `json:"schema"`
	Strict bool            `json:"strict,omitempty"`
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
	TotalTokens  int `json:"total_tokens,omitempty"`
	CacheRead    int `json:"cache_read,omitempty"`
	CacheWrite   int `json:"cache_write,omitempty"`
}

// Total returns InputTokens + OutputTokens (or TotalTokens if set).
func (u Usage) Total() int {
	if u.TotalTokens > 0 {
		return u.TotalTokens
	}
	return u.InputTokens + u.OutputTokens
}

// StreamEvent is a chunk from a streaming response.
type StreamEvent struct {
	Type     string    `json:"type"` // text_delta, tool_call_start, tool_call_delta, done, error
	Text     string    `json:"text,omitempty"`
	ToolCall *ToolCall `json:"tool_call,omitempty"`
	Response *Response `json:"response,omitempty"` // Set on "done"
	Error    string    `json:"error,omitempty"`
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

// ModelMeta holds display metadata for a model. Providers that implement
// ModelMetaProvider can supply this for richer UI display.
type ModelMeta struct {
	ID           string   `json:"id"`
	Label        string   `json:"label"`
	Capabilities []string `json:"capabilities,omitempty"` // e.g. "tools", "vision", "reasoning"
}

// ModelMetaProvider is an optional interface providers can implement to
// supply per-model metadata beyond just the ID string.
type ModelMetaProvider interface {
	ModelsMeta() []ModelMeta
}

// CapabilitiesProvider is an optional interface providers can implement to
// declare what features they support.
type CapabilitiesProvider interface {
	Capabilities() Capabilities
}

// HealthChecker is an optional interface providers can implement to
// support health checks (e.g. API ping or model listing).
type HealthChecker interface {
	HealthCheck(ctx context.Context) error
}
