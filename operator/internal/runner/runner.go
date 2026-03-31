// Package runner implements the agent loop — the core of Operator.
// Receive task → loop (LLM → tools → LLM) → result.
package runner

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"construct-operator/internal/agent"
	"construct-operator/internal/hook"
	"construct-operator/internal/provider"
	"construct-operator/internal/session"
	"construct-operator/internal/skill"
	"construct-operator/internal/stream"
	"construct-operator/internal/tool"
)

// ProjectContext describes the active project the frontend is working in.
type ProjectContext struct {
	Name        string   `json:"name"`
	Type        string   `json:"type"`
	RootPath    string   `json:"rootPath"`
	Framework   string   `json:"framework"`
	UILibrary   string   `json:"uiLibrary,omitempty"`
	StyleSystem string   `json:"styleSystem,omitempty"`
	Components  []string `json:"components,omitempty"`
}

// AgentResolver finds agent configs by ID (used for sub-agent spawning).
type AgentResolver func(id string) *agent.Config

// Runner orchestrates agent execution.
type Runner struct {
	providersMu   sync.RWMutex
	providers     map[string]provider.Provider
	tools         *tool.Registry
	hooks         *hook.Registry
	skills        *skill.Registry
	sessions      *session.Store
	defaultModel  string
	agentResolver AgentResolver
	toolTimeouts  map[string]time.Duration // per-tool timeout overrides
}

const (
	maxToolResultContextChars  = 1200
	toolResultContextHeadChars = 700
	toolResultContextTailChars = 260
	stuckLoopStopReason        = "stuck_loop"
)

// New creates a Runner with all dependencies injected.
func New(opts ...Option) *Runner {
	r := &Runner{
		providers:    make(map[string]provider.Provider),
		tools:        tool.NewRegistry(),
		hooks:        hook.NewRegistry(),
		skills:       skill.NewRegistry(),
		sessions:     session.NewStore(""),
		defaultModel: "claude-sonnet-4-6",
	}
	for _, opt := range opts {
		opt(r)
	}
	return r
}

// Option configures a Runner.
type Option func(*Runner)

func WithProvider(p provider.Provider) Option {
	return func(r *Runner) {
		r.providers[p.ID()] = p
	}
}

func WithTools(reg *tool.Registry) Option {
	return func(r *Runner) { r.tools = reg }
}

func WithHooks(reg *hook.Registry) Option {
	return func(r *Runner) { r.hooks = reg }
}

func WithSkills(reg *skill.Registry) Option {
	return func(r *Runner) { r.skills = reg }
}

func WithDefaultModel(model string) Option {
	return func(r *Runner) { r.defaultModel = model }
}

// WithSessionStore sets a persistent session store.
func WithSessionStore(s *session.Store) Option {
	return func(r *Runner) { r.sessions = s }
}

// WithAgentResolver sets the function used to find agent configs for sub-agent spawning.
func WithAgentResolver(resolver AgentResolver) Option {
	return func(r *Runner) { r.agentResolver = resolver }
}

// WithToolTimeout sets a per-tool execution timeout override.
// Tools not specified will use DefaultToolTimeout.
func WithToolTimeout(toolName string, timeout time.Duration) Option {
	return func(r *Runner) {
		if r.toolTimeouts == nil {
			r.toolTimeouts = make(map[string]time.Duration)
		}
		r.toolTimeouts[toolName] = timeout
	}
}

// RunRequest is what you pass to Run().
type RunRequest struct {
	Agent    *agent.Config      `json:"agent"`
	Task     string             `json:"task"`
	Model    string             `json:"model,omitempty"`
	Messages []provider.Message `json:"messages,omitempty"`
	Context  map[string]any     `json:"context,omitempty"`
	Stream   *stream.Emitter    `json:"-"`
	Project  *ProjectContext    `json:"project,omitempty"`
	MaxTurns int                `json:"max_turns,omitempty"`

	// Assistant type metadata — carried through for logging and future
	// structured-output support. Does not change routing behavior.
	AssistantType string `json:"assistant_type,omitempty"`
	OutputSchema  string `json:"output_schema,omitempty"`
}

// Run executes the agent loop.
//
// The loop:
//  1. Build messages (system prompt + task + conversation history)
//  2. Call LLM with available tools
//  3. If LLM returns tool_calls → execute tools (with hooks) → append results → goto 2
//  4. If LLM returns end_turn → return final content
//  5. If max turns reached → return with partial result
func (r *Runner) Run(ctx context.Context, req *RunRequest) (*agent.RunResult, error) {
	// Ensure space action tools are registered before dispatch
	r.tools.EnsureSpaceActions()

	if req != nil && req.Agent != nil {
		ctx = hook.WithAgentID(ctx, req.Agent.ID)
	}

	model := req.Model
	if model == "" {
		model = req.Agent.Model
	}
	if model == "" {
		model = r.defaultModel
	}

	p, actualModel, err := r.resolveProvider(model)
	if err != nil {
		return nil, fmt.Errorf("no provider for model %q: %w", model, err)
	}
	model = actualModel

	sess := r.sessions.Create(req.Agent.ID)
	if req.Stream != nil {
		req.Stream.Emit(stream.Event{Type: "session.start", Data: map[string]any{
			"session_id": sess.ID, "agent_id": req.Agent.ID, "model": model,
		}})
	}

	// Log session start to project directory
	if req.Project != nil && req.Project.RootPath != "" {
		task := req.Task
		if task == "" && len(req.Messages) > 0 {
			for i := len(req.Messages) - 1; i >= 0; i-- {
				if strings.EqualFold(req.Messages[i].Role, "user") {
					task = req.Messages[i].Content
					break
				}
			}
		}
		if len(task) > 200 {
			task = task[:200] + "..."
		}
		appendProjectLog(req.Project.RootPath, req.Agent, fmt.Sprintf("session start | model=%s | task: %s", model, task))
	}

	// Build system prompt with project context
	system := buildSystemWithContext(req.Agent.System, req.Project, req.Context)

	// Inject available skills index + matched skill prompts
	var skillTools []string
	if r.skills != nil {
		// List all skills available to this agent so it knows what it has
		allForAgent := r.skills.AllForAgent(req.Agent.ID)
		if len(allForAgent) > 0 {
			var skillIndex []string
			for _, s := range allForAgent {
				skillIndex = append(skillIndex, fmt.Sprintf("- %s: %s", s.Name, s.Description))
			}
			system += "\n\n## Available Skills\nYou have these skills. Follow them when their trigger matches the task.\n" + strings.Join(skillIndex, "\n")
		}

		// Match skills against the task and inject their full prompts
		if matched := r.skills.MatchForAgent(req.Task, req.Agent.ID); len(matched) > 0 {
			vars := map[string]any{"task": req.Task}
			if req.Project != nil {
				vars["project.name"] = req.Project.Name
				vars["project.root"] = req.Project.RootPath
				vars["project.framework"] = req.Project.Framework
			}
			for _, s := range matched {
				expanded := s.Expand(ctx, vars)
				system += "\n\n## Skill: " + s.Name + "\n" + expanded
				skillTools = append(skillTools, s.Tools...)
			}
		}
	}

	messages := make([]provider.Message, 0, len(req.Messages)+1)
	if len(req.Messages) > 0 {
		for _, msg := range req.Messages {
			if strings.EqualFold(msg.Role, "system") {
				if content := strings.TrimSpace(msg.Content); content != "" {
					system += "\n\n## Request Instructions\n" + content
				}
				continue
			}
			messages = append(messages, msg)
		}
	}
	if len(messages) == 0 && strings.TrimSpace(req.Task) != "" {
		messages = append(messages, provider.Message{Role: "user", Content: req.Task})
	}

	agentTools := r.tools.ForAgent(req.Agent.Tools, req.Agent.BlockTools)
	// Add skill-declared tools that the agent doesn't already have
	if len(skillTools) > 0 {
		existing := make(map[string]bool)
		for _, t := range agentTools {
			existing[t.Def.Name] = true
		}
		for _, name := range skillTools {
			if !existing[name] {
				if t, ok := r.tools.Get(name); ok {
					agentTools = append(agentTools, t)
					existing[name] = true
				}
			}
		}
	}
	// Remove spawn_agent if agent cannot spawn sub-agents
	if !req.Agent.CanSpawn {
		filtered := make([]*tool.Tool, 0, len(agentTools))
		for _, t := range agentTools {
			if t.Def.Name != "spawn_agent" {
				filtered = append(filtered, t)
			}
		}
		agentTools = filtered
	}
	// Build tool definitions with API-safe names (no dots — Anthropic requires ^[a-zA-Z0-9_-]+$)
	toolDefs := make([]provider.ToolDef, len(agentTools))
	apiNameToReal := make(map[string]string) // sanitized name → original name
	for i, t := range agentTools {
		def := t.Def
		apiName := sanitizeToolName(def.Name)
		if apiName != def.Name {
			apiNameToReal[apiName] = def.Name
			def.Name = apiName
		}
		toolDefs[i] = def
	}

	var turns []agent.Turn
	var totalUsage provider.Usage
	maxTurns := req.Agent.GetMaxTurns()
	if req.MaxTurns > 0 {
		maxTurns = req.MaxTurns
	}
	toolUseRetries := 0
	hadToolErrorLastTurn := false
	hasUsedTools := false

	hardCap := maxTurns * 4 // absolute upper bound to prevent runaway
	if hardCap > 500 {
		hardCap = 500
	}

	for turn := 0; turn < maxTurns; turn++ {
		// Stop if the caller cancelled (e.g. frontend disconnected)
		if ctx.Err() != nil {
			sess.SetError("cancelled")
			sess.Messages = messages
			if saveErr := r.sessions.Save(sess); saveErr != nil {
				log.Printf("[runner] session save failed (session=%s): %v", sess.ID, saveErr)
			}
			if req.Project != nil && req.Project.RootPath != "" {
				appendProjectLog(req.Project.RootPath, req.Agent, "cancelled — client disconnected")
			}
			return &agent.RunResult{
				AgentID:    req.Agent.ID,
				SessionID:  sess.ID,
				Content:    "cancelled",
				Turns:      turns,
				Usage:      totalUsage,
				StopReason: "cancelled",
			}, nil
		}

		if req.Stream != nil {
			req.Stream.Emit(stream.Event{Type: "turn.start", Data: map[string]any{
				"turn": turn, "max_turns": maxTurns,
			}})
		}

		// Status: thinking
		emitStatus(req.Stream, stream.StatusThinking, "Thinking…", map[string]any{
			"turn": turn, "max_turns": maxTurns,
		})

		provReq := &provider.Request{
			Model:      model,
			Messages:   messages,
			Tools:      toolDefs,
			ToolChoice: "auto",
			System:     system,
		}
		// Attach structured output schema when requested.
		// Providers that support structured output will use it; others ignore it.
		if req.OutputSchema != "" {
			if schema := builtinOutputSchema(req.OutputSchema); schema != nil {
				provReq.OutputSchema = schema
			}
		}
		if requiresInitialToolUse(req.Agent) && !hasUsedTools && len(toolDefs) > 0 {
			provReq.ToolChoice = "required"
		}
		if req.Agent.Temperature != nil {
			provReq.Temperature = req.Agent.Temperature
		}

		// Log raw request
		logConversation(req.Agent, turn, "request", provReq, nil)

		var resp *provider.Response
		if req.Stream != nil {
			resp, err = r.streamCall(ctx, p, provReq, req.Stream)
		} else {
			resp, err = p.Complete(ctx, provReq)
		}
		// On auth failure, try fallback provider (any turn, not just the first)
		if err != nil && isAuthError(err) {
			if fallbackP, fallbackModel, fallbackErr := r.fallbackProvider(p.ID()); fallbackErr == nil {
				fmt.Printf("[runner] provider %s failed (%v), falling back to %s/%s\n", p.ID(), err, fallbackP.ID(), fallbackModel)
				p = fallbackP
				model = fallbackModel
				provReq.Model = model
				if req.Stream != nil {
					resp, err = r.streamCall(ctx, p, provReq, req.Stream)
				} else {
					resp, err = p.Complete(ctx, provReq)
				}
			}
		}
		if err != nil {
			sess.SetError(err.Error())
			sess.Messages = messages
			if saveErr := r.sessions.Save(sess); saveErr != nil {
				log.Printf("[runner] session save failed (session=%s): %v", sess.ID, saveErr)
			}
			return nil, fmt.Errorf("turn %d: %w", turn, err)
		}
		if len(resp.ToolCalls) == 0 {
			if synthesized := synthesizePlaintextToolCalls(resp.Content, agentTools); len(synthesized) > 0 {
				resp.ToolCalls = synthesized
				resp.StopReason = "tool_use"
				resp.Content = ""
			}
		}
		if len(resp.ToolCalls) > 0 && (resp.StopReason == "" || resp.StopReason == "end_turn") {
			resp.StopReason = "tool_use"
		}

		totalUsage.InputTokens += resp.Usage.InputTokens
		totalUsage.OutputTokens += resp.Usage.OutputTokens

		// Log model text if present
		if text := strings.TrimSpace(resp.Content); text != "" && req.Project != nil && req.Project.RootPath != "" {
			if len(text) > 300 {
				text = text[:300] + "..."
			}
			appendProjectLog(req.Project.RootPath, req.Agent, ">>> "+text)
		}

		if len(resp.ToolCalls) > 0 {
			names := make([]string, 0, len(resp.ToolCalls))
			for _, tc := range resp.ToolCalls {
				names = append(names, tc.Name)
			}
			logLine := fmt.Sprintf("turn %d: %s", turn, strings.Join(names, ", "))
			fmt.Fprintln(os.Stderr, "[runner] "+logLine)
			if req.Project != nil && req.Project.RootPath != "" {
				appendProjectLog(req.Project.RootPath, req.Agent, logLine)
			}
		} else if resp.StopReason != "" {
			logLine := fmt.Sprintf("turn %d: %s", turn, resp.StopReason)
			fmt.Fprintln(os.Stderr, "[runner] "+logLine)
			if req.Project != nil && req.Project.RootPath != "" {
				appendProjectLog(req.Project.RootPath, req.Agent, logLine)
			}
		}

		// Log raw response
		logConversation(req.Agent, turn, "response", provReq, resp)

		if req.Stream != nil {
			req.Stream.Emit(stream.Event{Type: "token.usage", Data: map[string]any{
				"input_tokens":  resp.Usage.InputTokens,
				"output_tokens": resp.Usage.OutputTokens,
				"total_input":   totalUsage.InputTokens,
				"total_output":  totalUsage.OutputTokens,
			}})
		}

		thisTurn := agent.Turn{
			Request:  provReq,
			Response: resp,
		}

		if len(resp.ToolCalls) == 0 || resp.StopReason == "end_turn" {
			shouldForceInitialToolUse := requiresInitialToolUse(req.Agent) && !hasUsedTools && len(agentTools) > 0
			shouldRecoverToolError := hadToolErrorLastTurn && shouldRetryAfterToolError(req.Agent, resp.Content)
			if len(resp.ToolCalls) == 0 && (shouldRetryForToolUse(agentTools, resp.Content) || shouldForceInitialToolUse || shouldRecoverToolError) {
				if toolUseRetries >= toolUseRetryLimit(req.Agent, hasUsedTools) {
					sess.SetError("model failed to use tools after multiple retries")
					sess.Messages = messages
					if saveErr := r.sessions.Save(sess); saveErr != nil {
						log.Printf("[runner] session save failed (session=%s): %v", sess.ID, saveErr)
					}
					return nil, fmt.Errorf("turn %d: model failed to use tools after %d retries", turn, toolUseRetries+1)
				}
				toolUseRetries++
				messages = append(messages, provider.Message{
					Role:             "assistant",
					Content:          resp.Content,
					ReasoningContent: resp.ReasoningContent,
				})
				messages = append(messages, provider.Message{
					Role:    "user",
					Content: retryNudge(req.Agent, shouldRecoverToolError),
				})
				turns = append(turns, thisTurn)
				sess.AddTurn()
				if req.Stream != nil {
					req.Stream.Emit(stream.Event{Type: "turn.end", Data: map[string]any{
						"turn": turn, "nudge": true,
					}})
				}
				continue
			}
			toolUseRetries = 0
			hadToolErrorLastTurn = false

			turns = append(turns, thisTurn)
			// Append final assistant message
			messages = append(messages, provider.Message{
				Role:             "assistant",
				Content:          resp.Content,
				ReasoningContent: resp.ReasoningContent,
			})
			emitStatus(req.Stream, stream.StatusComplete, "Done", map[string]any{
				"turns": len(turns), "stop_reason": resp.StopReason,
			})
			sess.Complete()
			sess.Messages = messages
			if saveErr := r.sessions.Save(sess); saveErr != nil {
				log.Printf("[runner] session save failed (session=%s): %v", sess.ID, saveErr)
			}
			return &agent.RunResult{
				AgentID:    req.Agent.ID,
				SessionID:  sess.ID,
				Content:    resp.Content,
				Turns:      turns,
				Usage:      totalUsage,
				StopReason: resp.StopReason,
			}, nil
		}
		toolUseRetries = 0

		// Map sanitized tool names back to original names
		for i := range resp.ToolCalls {
			if realName, ok := apiNameToReal[resp.ToolCalls[i].Name]; ok {
				resp.ToolCalls[i].Name = realName
			}
		}

		messages = append(messages, provider.Message{
			Role:             "assistant",
			Content:          resp.Content,
			ReasoningContent: resp.ReasoningContent,
			ToolCalls:        resp.ToolCalls,
		})
		hasUsedTools = true

		if req.Stream != nil {
			for _, tc := range resp.ToolCalls {
				title := toolTitle(tc.Name, tc.Input)
				req.Stream.Emit(stream.Event{Type: "tool.call", Data: map[string]any{
					"tool":    tc.Name,
					"call_id": tc.ID,
					"input":   tc.Input,
					"title":   title,
				}})
				// Status: tool running
				emitStatus(req.Stream, stream.StatusToolRunning, title, map[string]any{
					"tool": tc.Name, "call_id": tc.ID,
				})
			}
		}

		// Execute tool calls (parallel when multiple independent calls)
		executions := r.executeToolCalls(ctx, req, resp.ToolCalls)
		for _, exec := range executions {
			title := toolTitle(exec.Call.Name, exec.Call.Input)
			if req.Stream != nil {
				req.Stream.Emit(stream.Event{Type: "tool.result", Data: map[string]any{
					"tool":     exec.Call.Name,
					"call_id":  exec.Call.ID,
					"input":    exec.Call.Input,
					"content":  exec.Result.Content,
					"is_error": exec.Result.IsError,
					"title":    title,
				}})
				// Status: tool done
				emitStatus(req.Stream, stream.StatusToolDone, title, map[string]any{
					"tool": exec.Call.Name, "call_id": exec.Call.ID, "is_error": exec.Result.IsError,
				})
			}
			thisTurn.ToolCalls = append(thisTurn.ToolCalls, exec)
			modelResult := compactToolResultForModelContext(exec.Result)
			messages = append(messages, provider.Message{
				Role:       "tool",
				ToolResult: &modelResult,
			})
		}
		hadToolErrorLastTurn = false
		for _, exec := range executions {
			if exec.Result.IsError {
				hadToolErrorLastTurn = true
				break
			}
		}

		turns = append(turns, thisTurn)
		sess.AddTurn()

		if isStuckInLoop(turns) {
			content := stuckLoopMessage(req.Agent)
			messages = append(messages, provider.Message{
				Role:    "assistant",
				Content: content,
			})
			if req.Stream != nil {
				req.Stream.Emit(stream.Event{Type: "turn.end", Data: map[string]any{
					"turn": turn, "tool_calls": len(resp.ToolCalls),
				}})
			}
			emitStatus(req.Stream, stream.StatusComplete, "Stopped repetitive tool loop", map[string]any{
				"turns":       len(turns),
				"stop_reason": stuckLoopStopReason,
			})
			sess.Complete()
			sess.Messages = messages
			if saveErr := r.sessions.Save(sess); saveErr != nil {
				log.Printf("[runner] session save failed (session=%s): %v", sess.ID, saveErr)
			}
			return &agent.RunResult{
				AgentID:    req.Agent.ID,
				SessionID:  sess.ID,
				Content:    content,
				Turns:      turns,
				Usage:      totalUsage,
				StopReason: stuckLoopStopReason,
			}, nil
		}

		if req.Stream != nil {
			req.Stream.Emit(stream.Event{Type: "turn.end", Data: map[string]any{
				"turn": turn, "tool_calls": len(resp.ToolCalls),
			}})
		}

		// Auto-continue: when approaching the limit, if agent is still productive
		// (has tool calls) and not stuck in a loop, extend the turn budget.
		if turn == maxTurns-1 && maxTurns < hardCap && len(resp.ToolCalls) > 0 && !isStuckInLoop(turns) {
			extension := maxTurns / 2
			if extension < 10 {
				extension = 10
			}
			if maxTurns+extension > hardCap {
				extension = hardCap - maxTurns
			}
			maxTurns += extension
			fmt.Fprintf(os.Stderr, "[runner] auto-continue: agent still productive, extending to %d turns (hard cap %d)\n", maxTurns, hardCap)
			if req.Stream != nil {
				req.Stream.Emit(stream.Event{Type: "status", Data: map[string]any{
					"state":   "thinking",
					"message": fmt.Sprintf("Continuing… (turn %d, extended to %d)", turn+1, maxTurns),
				}})
			}
		}
	}

	sess.Complete()
	sess.Messages = messages
	if saveErr := r.sessions.Save(sess); saveErr != nil {
		log.Printf("[runner] session save failed (session=%s): %v", sess.ID, saveErr)
	}
	return &agent.RunResult{
		AgentID:    req.Agent.ID,
		SessionID:  sess.ID,
		Content:    "max turns reached",
		Turns:      turns,
		Usage:      totalUsage,
		StopReason: "max_turns",
	}, nil
}
