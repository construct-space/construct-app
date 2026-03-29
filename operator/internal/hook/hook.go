// Package hook implements pre/post execution hooks.
// Hooks run before and after tool execution, allowing users to
// customize behavior (e.g., block writes to certain paths, log tool usage).
package hook

import (
	"context"
	"time"
)

// Context key for agent ID propagation through hooks.
type ctxKey string

const agentIDKey ctxKey = "hook_agent_id"

// WithAgentID returns a new context carrying the active agent ID.
func WithAgentID(ctx context.Context, agentID string) context.Context {
	return context.WithValue(ctx, agentIDKey, agentID)
}

// AgentIDFromContext extracts the agent ID from the context, if present.
func AgentIDFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(agentIDKey).(string); ok {
		return v
	}
	return ""
}

// Type is when a hook fires.
type Type string

const (
	PreTool  Type = "pre_tool"
	PostTool Type = "post_tool"
)

// CheckFunc is a Go-native hook check. Returns (block, message).
// Used by built-in hooks to avoid shelling out to external tools.
type CheckFunc func(ctx context.Context, toolName, input string) (block bool, message string)

// Hook is a registered hook definition.
type Hook struct {
	ID          string    `json:"id"`
	Name        string    `json:"name,omitempty"`
	Type        Type      `json:"type"`
	Priority    int       `json:"priority,omitempty"`
	SkillID     string    `json:"skill_id,omitempty"`
	Description string    `json:"description,omitempty"`
	Tools       []string  `json:"tools"`                 // Which tools this hook applies to (empty = all)
	Patterns    []string  `json:"patterns,omitempty"`    // File path patterns to match
	Command     string    `json:"command"`               // Shell command to run (for user/space hooks)
	Check       CheckFunc `json:"-"`                     // Go-native check (for built-in hooks, no shell needed)
	Timeout     int       `json:"timeout,omitempty"`     // Timeout in seconds (default 10)
	Source      string    `json:"source,omitempty"`      // "builtin", "space:<id>", "user"
	RpcHookID   string    `json:"rpc_hook_id,omitempty"` // If set, serialize a JSON-RPC request into HOOK_RPC_REQUEST env var
}

// Result is what a hook execution returns.
type Result struct {
	HookID  string `json:"hook_id"`
	Block   bool   `json:"block"`            // If true, prevent the tool from executing
	Message string `json:"message"`          // Human-readable message
	Output  string `json:"output,omitempty"` // stdout/stderr from hook command
}

type Metrics struct {
	ExecutionCount int     `json:"executionCount"`
	ErrorCount     int     `json:"errorCount"`
	AvgDuration    float64 `json:"avgDuration"`
	LastExecuted   string  `json:"lastExecuted,omitempty"`
	totalDuration  time.Duration
}

// --- Config Loading ---

// HookConfig is the format of hook config files.
type HookConfig struct {
	Hooks []Hook `json:"hooks"`
}

// ProjectRootFunc is used by safety hooks to get the dynamic project root.
type ProjectRootFunc func(context.Context) string
