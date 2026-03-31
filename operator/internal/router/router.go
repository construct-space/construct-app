// Package router handles request routing and agent selection.
//
// Routing is a multi-phase pipeline that picks the best agent for a task.
// Each phase is evaluated in order; the first match wins.
//
// Phase 0: Deterministic handoff — structured [prefix] tags bypass all heuristics.
//          Used for architect→coder handoff and other inter-agent transitions.
// Phase 1: Active context priority — if the user is in a specific space,
//          prefer that space's agent for ambiguous queries.
// Phase 2: Specialist keyword routing — multi-word phrases (space tools) and
//          single keywords (code, plan, brainstorm) route to specialists.
// Phase 3: LLM-based classification — for truly ambiguous tasks, ask a fast
//          model to pick the agent (only if a provider is configured).
// Phase 4: Fallback — route to the general-purpose agent.
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

// ────────────────────────────────────────────────────────────────────────────
// Deterministic prefix tags — used for inter-agent handoff.
//
// When an agent (e.g. architect) finishes and wants to pass control, it
// prefixes the task with a tag like [code]. This is deterministic: no
// keyword ambiguity, no LLM call, no active-context override.
//
// Supported tags → agent mappings:
//   [architect], [generate_plan] → architect
//   [code], [implement]          → coder
//   [brainstorm]                 → brainstorm
//   [review]                     → reviewer
//   [design]                     → designer
// ────────────────────────────────────────────────────────────────────────────

var prefixRoutes = []struct {
	prefix  string
	agentID string
}{
	{"[generate_plan]", "architect"},
	{"[architect]", "architect"},
	{"[code]", "coder"},
	{"[implement]", "coder"},
	{"[brainstorm]", "brainstorm"},
	{"[review]", "reviewer"},
	{"[design]", "designer"},
}

// ────────────────────────────────────────────────────────────────────────────
// Specialist keyword routes — ordered by specificity.
//
// Multi-word patterns are checked first (more specific), then single keywords.
// Each keyword maps to exactly one agent ID.
// ────────────────────────────────────────────────────────────────────────────

// spacePatterns are multi-word phrases that indicate Construct space operations.
var spacePatterns = []string{
	"create a space", "create space", "new space", "scaffold space",
	"build space", "space build", "validate space", "space validate",
	"install space", "publish space", "list spaces", "space dev",
	"construct space",
}

// specialistKeyword is a keyword → agent mapping, checked in order.
// Longer/more-specific patterns must come first to avoid ambiguous matches.
type specialistKeyword struct {
	keyword string
	agentID string
}

// specialistKeywords is an ordered slice — Go maps have non-deterministic
// iteration, so we use a slice to guarantee longer patterns match first.
var specialistKeywords = []specialistKeyword{
	// Multi-word patterns first (more specific)
	{"design doc", "architect"},
	{"what if", "brainstorm"},

	// Architect
	{"architecture", "architect"},
	{"plan", "architect"},
	{"spec", "architect"},

	// Coder
	{"implement", "coder"},
	{"refactor", "coder"},
	{"scaffold", "coder"},
	{"build", "coder"},
	{"debug", "coder"},
	{"code", "coder"},
	{"fix", "coder"},

	// Brainstorm
	{"brainstorm", "brainstorm"},
	{"explore", "brainstorm"},
	{"ideas", "brainstorm"},

	// Other specialists
	{"design", "designer"},
	{"review", "reviewer"},
	{"test", "tester"},
	{"deploy", "devops"},
}

// ────────────────────────────────────────────────────────────────────────────
// Active context — the space the user is currently in.
//
// When active_context is set and no deterministic prefix matched, the router
// checks whether the task is ambiguous enough to route to the active space's
// agent. This gives priority to the space the user is looking at.
//
// The active context is passed as a string agent/space ID (e.g. "coder",
// "architect", "project") from the frontend via RouteWithContext.
// ────────────────────────────────────────────────────────────────────────────

// Route picks the best agent for the given task (no active context).
func (r *Router) Route(ctx context.Context, task string) *agent.Config {
	return r.RouteWithContext(ctx, task, "")
}

// RouteWithContext picks the best agent, giving priority to activeContext
// when no deterministic prefix matches and the task is ambiguous.
func (r *Router) RouteWithContext(ctx context.Context, task string, activeContext string) *agent.Config {
	lower := strings.ToLower(task)

	// ── Phase 0: Deterministic prefix matching ──
	// These are structured tags from inter-agent handoff. They always win.
	for _, pr := range prefixRoutes {
		if strings.HasPrefix(lower, pr.prefix) {
			if a, ok := r.agents[pr.agentID]; ok {
				return a
			}
		}
	}

	// ── Phase 1: Active context priority ──
	// If the user is in a specific space (e.g. coder) and the task doesn't
	// have a deterministic prefix, check if the active context's agent exists
	// and the task isn't clearly for a different specialist.
	if activeContext != "" {
		if a, ok := r.agents[activeContext]; ok {
			// Only defer to active context when no specialist keyword strongly
			// claims this task. This prevents "fix this bug" from going to
			// architect just because the user happens to be in the architect space.
			if !r.hasStrongSpecialistMatch(lower, activeContext) {
				return a
			}
		}
	}

	// ── Phase 2: Specialist keyword routing ──
	// Multi-word space patterns first (most specific).
	for _, pattern := range spacePatterns {
		if strings.Contains(lower, pattern) {
			if a, ok := r.agents["space"]; ok {
				return a
			}
		}
	}
	// Single keywords — first match wins (ordered by specificity).
	for _, sk := range specialistKeywords {
		if strings.Contains(lower, sk.keyword) {
			if a, ok := r.agents[sk.agentID]; ok {
				return a
			}
		}
	}

	// ── Phase 3: LLM-based routing (if provider configured) ──
	if r.provider != nil {
		if a := r.routeLLM(ctx, task); a != nil {
			return a
		}
	}

	// ── Phase 4: Fallback to general-purpose agent ──
	if a, ok := r.agents["general"]; ok {
		return a
	}

	// Last resort: return first registered agent
	for _, a := range r.agents {
		return a
	}
	return nil
}

// hasStrongSpecialistMatch returns true when a keyword in the task clearly
// belongs to a specialist agent that is different from the active context.
// This prevents active context from capturing tasks like "fix the login bug"
// when the user is in the architect space — those should still go to coder.
func (r *Router) hasStrongSpecialistMatch(lower string, activeContext string) bool {
	for _, sk := range specialistKeywords {
		if sk.agentID != activeContext && strings.Contains(lower, sk.keyword) {
			if _, ok := r.agents[sk.agentID]; ok {
				return true
			}
		}
	}
	for _, pattern := range spacePatterns {
		if activeContext != "space" && strings.Contains(lower, pattern) {
			if _, ok := r.agents["space"]; ok {
				return true
			}
		}
	}
	return false
}

// ────────────────────────────────────────────────────────────────────────────
// Deterministic handoff — architect → coder
//
// After the architect finishes planning, control must pass to the coder.
// This is not keyword-based — it's a direct, deterministic transition.
// The caller (runner/spawn) prefixes the task with [code] and routes through
// the standard pipeline, or calls DeterministicHandoff directly.
// ────────────────────────────────────────────────────────────────────────────

// DeterministicHandoff routes a task from one agent to another deterministically.
// Returns the target agent config, or nil if the target is not registered.
//
// Known handoff pairs:
//   architect → coder (after planning is complete)
//   project   → architect | coder | space (based on task analysis)
func (r *Router) DeterministicHandoff(fromAgentID, toAgentID string) *agent.Config {
	a, ok := r.agents[toAgentID]
	if !ok {
		return nil
	}
	return a
}

// ArchitectToCoderHandoff is a convenience for the most common handoff.
// Returns the coder agent, or nil if not registered.
func (r *Router) ArchitectToCoderHandoff() *agent.Config {
	return r.DeterministicHandoff("architect", "coder")
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
