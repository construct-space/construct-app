// Package provider abstracts LLM backends. v0 ships Anthropic; xiaomi,
// google, openrouter etc. plug in through the same interface.
package provider

import "context"

// Provider streams a single completion. Tool calls and tool results live in
// the message blocks; the loop above the provider decides what to do with
// them.
type Provider interface {
	Name() string
	Stream(ctx context.Context, req Request, emit func(Event)) error
}

type Request struct {
	Model     string
	System    string
	Messages  []Message
	Tools     []Tool
	MaxTokens int

	// Temperature, when non-nil, is forwarded to the upstream (pointer
	// so an explicit 0.0 is honoured). Callers that don't care leave it
	// nil and the provider default applies.
	Temperature *float64

	// Caps that the caller resolved from the catalog. Empty flags = "we
	// don't know" — the provider defaults to conservative (no caching,
	// no strict tools). When flags include "caching" / "structured" /
	// "tools", the provider opts into the corresponding API features.
	CapFlags []string

	// Tier is a Construct-gateway hint forwarded into the chat body so
	// provider-api's Source-family dispatcher picks the right operator
	// chain. Empty / unrecognised → medium. Only the Construct provider
	// actually reads this; other providers ignore it (BYOK callers map
	// tier → model id on the desktop side, so the model field already
	// reflects the choice).
	Tier string
}

// HasCap reports whether the caller-resolved capabilities include flag.
func (r Request) HasCap(flag string) bool {
	for _, f := range r.CapFlags {
		if f == flag {
			return true
		}
	}
	return false
}

type Message struct {
	Role    string  // "user" | "assistant" | "tool"
	Content []Block // text, tool_use, tool_result
}

type Block struct {
	Type       string           `json:"type"` // "text" | "tool_use" | "tool_result" | "image"
	Text       string           `json:"text,omitempty"`
	ToolUse    *ToolUseBlock    `json:"-"`
	ToolResult *ToolResultBlock `json:"-"`
	Image      *ImageBlock      `json:"-"`
}

// ImageBlock carries a single image for a user-message content block.
// Either Data (base64, with MediaType) or URL (http/https) is set, never
// both. Producers should leave the unused field empty.
type ImageBlock struct {
	MediaType string // e.g. "image/png" — required when Data is set
	Data      string // base64 payload (no "data:..;base64," prefix)
	URL       string // remote http(s) source; set instead of Data
}

type ToolUseBlock struct {
	ID    string
	Name  string
	Input map[string]any
}

type ToolResultBlock struct {
	ToolUseID string
	Content   string
	IsError   bool
	// Images, when non-empty, are returned to the model alongside Content
	// as image blocks inside the tool_result (Anthropic supports an array
	// of content blocks here). Lets a tool — e.g. screenshot_window — hand
	// the model something to actually look at, not just a file path.
	// Providers that don't support image tool results fall back to Content.
	Images []ImageBlock
}

type Tool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"input_schema"`
}

// Event is what a provider streams as it generates. Consumers translate to
// whatever wire format they need.
type Event struct {
	Type       string // "text_start" | "text_delta" | "tool_use_start" | "tool_use_input_delta" | "block_stop" | "usage" | "stop" | "routing"
	Index      int    // content block index this event applies to (when relevant)
	TextDelta  string
	ToolUseID  string
	ToolName   string
	InputDelta string // partial_json from Anthropic
	StopReason string // populated on Type=="stop"
	Usage      Usage  // populated on Type=="usage" (cumulative, final values on stop)

	// Routing carries Construct gateway routing metadata when Type=="routing".
	// Emitted once per turn, before the first text_delta, when the upstream
	// is provider-api and exposed X-Construct-* response headers. Lets the
	// UI render "via apoc/backup #1 → openrouter/deepseek-v4-pro" chips.
	Routing Routing
}

// Routing carries the gateway's routing decision for one turn, plus
// the per-user credit snapshot the gateway returned alongside it.
// CreditsDailyAllowance == 0 means the upstream didn't report credits
// (e.g. BYOK call to OpenAI directly).
type Routing struct {
	Operator      string `json:"operator,omitempty"`       // e.g. "tank"
	Slot          string `json:"slot,omitempty"`           // e.g. "tank/primary" or "apoc/backup #1"
	RoutingTarget string `json:"routing_target,omitempty"` // e.g. "construct-tank"
	Upstream      string `json:"upstream,omitempty"`       // e.g. "fireworks/accounts/fireworks/models/gpt-oss-120b"

	CreditsUsed      int `json:"credits_used,omitempty"`
	CreditsAllowance int `json:"credits_allowance,omitempty"`
	CreditsBalance   int `json:"credits_balance,omitempty"`
}

// Usage carries token accounting reported by the provider.
type Usage struct {
	InputTokens  int `json:"input_tokens,omitempty"`
	OutputTokens int `json:"output_tokens,omitempty"`
	CacheRead    int `json:"cache_read,omitempty"`
	CacheWrite   int `json:"cache_write,omitempty"`
}
