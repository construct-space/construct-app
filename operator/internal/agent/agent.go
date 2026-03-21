// Package agent defines agent configuration and the agentic loop.
// Agents are composable: config + loop + tools + hooks.
package agent

import (
	"construct-operator/internal/hook"
	"construct-operator/internal/provider"
)

// Config defines an agent's identity and capabilities.
type Config struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Category    string   `json:"category"`
	System      string   `json:"system"`       // System prompt (or template)
	Model       string   `json:"model"`        // Preferred model ID
	Tools       []string `json:"tools"`        // Allowed tool names (empty = all)
	BlockTools  []string `json:"block_tools"`  // Blocked tool names
	MaxTurns    int      `json:"max_turns"`    // Max agent loop iterations (0 = default 25)
	CanSpawn     bool     `json:"can_spawn"`      // Can this agent spawn sub-agents?
	SpawnAllowed []string `json:"spawn_allowed"`  // Which agent IDs can be spawned (empty + CanSpawn = any)
	Temperature *float64 `json:"temperature,omitempty"`
}

// DefaultMaxTurns is the fallback when Config.MaxTurns is 0.
const DefaultMaxTurns = 25

func (c *Config) GetMaxTurns() int {
	if c.MaxTurns > 0 {
		return c.MaxTurns
	}
	return DefaultMaxTurns
}

// Turn represents one iteration of the agent loop.
type Turn struct {
	Request   *provider.Request  `json:"request"`
	Response  *provider.Response `json:"response"`
	ToolCalls []ToolExecution    `json:"tool_calls,omitempty"`
}

// ToolExecution is a tool call + its result within a turn.
type ToolExecution struct {
	Call   provider.ToolCall   `json:"call"`
	Result provider.ToolResult `json:"result"`
	Hooks  []hook.Result       `json:"hooks,omitempty"` // Pre/post hook results
}

// RunResult is the final output of an agent run.
type RunResult struct {
	AgentID    string          `json:"agent_id"`
	SessionID  string          `json:"session_id"`
	Content    string          `json:"content"`     // Final text response
	Turns      []Turn          `json:"turns"`       // Full conversation history
	Usage      provider.Usage  `json:"usage"`       // Aggregate token usage
	StopReason string          `json:"stop_reason"` // why the loop stopped
}
