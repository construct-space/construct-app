// Package router handles request routing and agent selection.
// Operator uses a hybrid approach:
//   - Deterministic routing for known request types (fast, no LLM call)
//   - LLM-based routing for ambiguous tasks (ask the model to pick the agent)
package router

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"construct-operator/internal/agent"
	"construct-operator/internal/provider"
)

// Router decides which agent handles a task.
type Router struct {
	agents   map[string]*agent.Config
	provider provider.Provider // optional: for LLM-based routing
	model    string
}

func New() *Router {
	return &Router{agents: make(map[string]*agent.Config)}
}

// SetProvider configures LLM-based routing.
func (r *Router) SetProvider(p provider.Provider, model string) {
	r.provider = p
	r.model = model
}

func (r *Router) Register(cfg *agent.Config) {
	r.agents[cfg.ID] = cfg
}

// Get returns an agent by ID.
func (r *Router) Get(id string) (*agent.Config, bool) {
	a, ok := r.agents[id]
	return a, ok
}

// List returns all registered agents.
func (r *Router) List() []*agent.Config {
	result := make([]*agent.Config, 0, len(r.agents))
	for _, a := range r.agents {
		result = append(result, a)
	}
	return result
}

// Route picks the best agent for the given task.
func (r *Router) Route(ctx context.Context, task string) *agent.Config {
	// Phase 1: Deterministic prefix matching
	lower := strings.ToLower(task)

	if strings.HasPrefix(lower, "[generate_plan]") || strings.HasPrefix(lower, "[architect]") {
		if a, ok := r.agents["architect"]; ok {
			return a
		}
	}
	if strings.HasPrefix(lower, "[code]") || strings.HasPrefix(lower, "[implement]") {
		if a, ok := r.agents["coder"]; ok {
			return a
		}
	}
	if strings.HasPrefix(lower, "[review]") {
		if a, ok := r.agents["reviewer"]; ok {
			return a
		}
	}
	if strings.HasPrefix(lower, "[design]") {
		if a, ok := r.agents["designer"]; ok {
			return a
		}
	}

	// Phase 2: Keyword heuristics (fast, no LLM call)
	keywords := map[string]string{
		"build":     "coder",
		"implement": "coder",
		"fix":       "coder",
		"debug":     "coder",
		"plan":      "architect",
		"design":    "designer",
		"review":    "reviewer",
		"test":      "tester",
		"deploy":    "devops",
	}

	// Space-specific: multi-word phrases checked first (more specific)
	spacePatterns := []string{
		"create a space", "create space", "new space", "scaffold space",
		"build space", "space build", "validate space", "space validate",
		"install space", "publish space", "list spaces", "space dev",
		"construct space",
	}
	for _, pattern := range spacePatterns {
		if strings.Contains(lower, pattern) {
			if a, ok := r.agents["space"]; ok {
				return a
			}
		}
	}
	for kw, agentID := range keywords {
		if strings.Contains(lower, kw) {
			if a, ok := r.agents[agentID]; ok {
				return a
			}
		}
	}

	// Phase 3: LLM-based routing (if provider configured)
	if r.provider != nil {
		if a := r.routeLLM(ctx, task); a != nil {
			return a
		}
	}

	// Phase 4: Fall back to general-purpose agent
	if a, ok := r.agents["general"]; ok {
		return a
	}

	// Last resort: return first registered agent
	for _, a := range r.agents {
		return a
	}
	return nil
}

// routeLLM asks a fast model to classify the task to an agent.
func (r *Router) routeLLM(ctx context.Context, task string) *agent.Config {
	// Build agent list for the prompt
	var agentDescs []string
	for _, a := range r.agents {
		agentDescs = append(agentDescs, fmt.Sprintf("- %s: %s", a.ID, a.Description))
	}

	prompt := fmt.Sprintf(`Given this task, pick the best agent from the list. Respond with ONLY the agent ID, nothing else.

Available agents:
%s

Task: %s`, strings.Join(agentDescs, "\n"), task)

	model := r.model
	if model == "" {
		model = "claude-haiku-4-5-20251001"
	}

	resp, err := r.provider.Complete(ctx, &provider.Request{
		Model: model,
		Messages: []provider.Message{
			{Role: "user", Content: prompt},
		},
		MaxTokens: 50,
	})
	if err != nil {
		return nil // fall back to heuristics
	}

	agentID := strings.TrimSpace(resp.Content)
	if a, ok := r.agents[agentID]; ok {
		return a
	}
	return nil
}

// RouteLLM explicitly uses LLM-based routing (exported for direct use).
func (r *Router) RouteLLM(ctx context.Context, task string) *agent.Config {
	if r.provider == nil {
		return r.Route(ctx, task) // fall back to heuristic
	}
	return r.routeLLM(ctx, task)
}

// HandoffContext extracts the relevant context from a parent session
// for transfer to a child agent.
type HandoffContext struct {
	Task           string             `json:"task"`
	ParentAgentID  string             `json:"parent_agent_id"`
	ParentMessages []provider.Message `json:"parent_messages,omitempty"`
	SharedMemory   map[string]any     `json:"shared_memory,omitempty"`
}

// BuildHandoff creates a HandoffContext from a parent session's state.
func BuildHandoff(parentAgentID string, messages []provider.Message, task string) *HandoffContext {
	// Only transfer the last N messages to avoid context overflow
	maxMessages := 10
	transferMsgs := messages
	if len(transferMsgs) > maxMessages {
		transferMsgs = transferMsgs[len(transferMsgs)-maxMessages:]
	}

	return &HandoffContext{
		Task:           task,
		ParentAgentID:  parentAgentID,
		ParentMessages: transferMsgs,
		SharedMemory:   make(map[string]any),
	}
}

// HandoffToSystemPrompt converts handoff context into a system prompt addition.
func HandoffToSystemPrompt(h *HandoffContext) string {
	if h == nil {
		return ""
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("\n\n## Handoff from %s\n", h.ParentAgentID))
	sb.WriteString(fmt.Sprintf("Original task: %s\n", h.Task))

	if len(h.ParentMessages) > 0 {
		sb.WriteString("\n### Conversation context:\n")
		for _, msg := range h.ParentMessages {
			if msg.Content != "" {
				sb.WriteString(fmt.Sprintf("[%s]: %s\n", msg.Role, truncate(msg.Content, 500)))
			}
		}
	}

	if len(h.SharedMemory) > 0 {
		if data, err := json.MarshalIndent(h.SharedMemory, "", "  "); err == nil {
			sb.WriteString(fmt.Sprintf("\n### Shared memory:\n```json\n%s\n```\n", string(data)))
		}
	}

	return sb.String()
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
