package tool

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"

	"github.com/construct-space/brain/provider"
)

// Subagent kicks off a self-contained nested conversation. Brain runs the
// inner loop in this goroutine, gives it an isolated message history,
// and returns the final assistant text to the caller. Subagent tool
// calls ride the parent prompt's SSE channel (frontend dispatches them
// the same way) — there is no separate process, no IPC, just a
// goroutine with a fresh slice of messages.
//
// Loop guards: max 3 levels of nesting + 15 inner iterations. These are
// safety caps, not policies — adjust the constants if the model needs
// more rope.
type Subagent struct {
	// Runner is set by main.go after the registry exists; it builds a
	// fresh agent.Agent with the same tools + provider and runs one prompt.
	// Defined as a func so the tool/ package stays free of an agent/ import
	// cycle (agent/ already imports tool/).
	Runner SubagentRunner
}

// SubagentRunner runs one nested prompt and returns the final assistant
// text. Implementations live in main.go where the dependency wiring sits.
type SubagentRunner func(ctx context.Context, in SubagentInput) (string, error)

type SubagentInput struct {
	AgentID  string
	Task     string
	Model    string
	Provider string
	Depth    int // populated by Execute from context; subagents inherit + 1
}

const (
	maxSubagentDepth            = 3
	depthKey         contextKey = "brain.subagent.depth"
)

type contextKey string

// CurrentDepth reports the nesting level of the active call. Top-level
// prompts return 0. Used by main.go to set the inner agent's options.
func CurrentDepth(ctx context.Context) int {
	if v, ok := ctx.Value(depthKey).(int); ok {
		return v
	}
	return 0
}

// WithDepth returns a context where the depth is incremented. main.go
// wraps the subagent's ctx with this before calling agent.Run.
func WithDepth(ctx context.Context, d int) context.Context {
	return context.WithValue(ctx, depthKey, d)
}

func (Subagent) Name() string { return "dispatch_subagent" }

func (Subagent) Description() string {
	return "Spawn a fresh agent run on a focused sub-task and return its final answer. Use for parallel investigation or isolated verification when you want clean context. The subagent inherits your tools but starts fresh — pass everything it needs in `task`. Pass `skills` to pre-load specific skills into the sub-run. Max nesting depth is 3."
}

func (Subagent) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"agent_id": map[string]any{
				"type":        "string",
				"description": "Agent id. Brain ships one built-in agent: \"construct\". Marketplace spaces may register their own.",
			},
			"task": map[string]any{
				"type":        "string",
				"description": "The full task description — the subagent has no memory of your conversation.",
			},
			"model": map[string]any{
				"type":        "string",
				"description": "Optional model override. Defaults to the caller's model.",
			},
		},
		"required": []string{"agent_id", "task"},
	}
}

func (s Subagent) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	if s.Runner == nil {
		return "", fmt.Errorf("subagent runner not configured")
	}
	depth := CurrentDepth(ctx)
	if depth >= maxSubagentDepth {
		return "", fmt.Errorf("max subagent depth %d reached — flatten this call", maxSubagentDepth)
	}
	var in struct {
		AgentID string `json:"agent_id"`
		Task    string `json:"task"`
		Model   string `json:"model"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fmt.Errorf("invalid input: %w", err)
	}
	if strings.TrimSpace(in.AgentID) == "" {
		return "", fmt.Errorf("agent_id is required")
	}
	if strings.TrimSpace(in.Task) == "" {
		return "", fmt.Errorf("task is required")
	}
	return s.Runner(ctx, SubagentInput{
		AgentID: in.AgentID,
		Task:    in.Task,
		Model:   in.Model,
		Depth:   depth + 1,
	})
}

// SilentHandler is an agent.Handler implementation that buffers text and
// throws away streaming events. Subagent runs use it so the outer SSE
// stream sees only one tool_result with the final answer, not every
// inner delta. main.go assembles one of these per nested run.
type SilentHandler struct {
	mu    sync.Mutex
	text  strings.Builder
	stop  string
	err   error
	final provider.Message
}

func (s *SilentHandler) OnTextDelta(delta string) {
	s.mu.Lock()
	s.text.WriteString(delta)
	s.mu.Unlock()
}
func (s *SilentHandler) OnToolCall(id, name string, input json.RawMessage) {}
func (s *SilentHandler) OnToolResult(id, output string, isError bool)      {}
func (s *SilentHandler) OnStop(reason string)                              { s.stop = reason }
func (s *SilentHandler) OnError(err error) {
	s.mu.Lock()
	s.err = err
	s.mu.Unlock()
}
func (s *SilentHandler) OnUsage(u provider.Usage, durationMs int64) {}
func (s *SilentHandler) OnRouting(r provider.Routing)               {}
func (s *SilentHandler) OnMessages(assistant provider.Message, _ *provider.Message) {
	s.final = assistant
}

// Err returns the error the nested run reported, if any. Discarding it
// made failed subagent runs (provider error, max iterations, permission
// denial) look like a successful empty answer to the parent model.
func (s *SilentHandler) Err() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.err
}

// Result returns the assembled assistant text. Falls back to the final
// assistant message's text blocks when text deltas weren't captured
// (e.g. provider that doesn't stream).
func (s *SilentHandler) Result() string {
	out := s.text.String()
	if out != "" {
		return out
	}
	var b strings.Builder
	for _, blk := range s.final.Content {
		if blk.Type == "text" {
			b.WriteString(blk.Text)
		}
	}
	return b.String()
}
