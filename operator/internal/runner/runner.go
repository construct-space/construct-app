// Package runner implements the agent loop — the core of Operator.
// Receive task → loop (LLM → tools → LLM) → result.
package runner

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"construct-operator/internal/agent"
	"construct-operator/internal/appdir"
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
			r.sessions.Save(sess)
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
			Model:    model,
			Messages: messages,
			Tools:    toolDefs,
			System:   system,
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
		// On first turn auth failure, try fallback provider
		if err != nil && turn == 0 && isAuthError(err) {
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
			r.sessions.Save(sess)
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
					r.sessions.Save(sess)
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
			r.sessions.Save(sess)
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
			r.sessions.Save(sess)
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
	r.sessions.Save(sess)
	return &agent.RunResult{
		AgentID:    req.Agent.ID,
		SessionID:  sess.ID,
		Content:    "max turns reached",
		Turns:      turns,
		Usage:      totalUsage,
		StopReason: "max_turns",
	}, nil
}

// sanitizeToolName replaces characters not allowed by the Anthropic API
// (which requires ^[a-zA-Z0-9_-]{1,128}$) with underscores.
func sanitizeToolName(name string) string {
	out := make([]byte, 0, len(name))
	for i := 0; i < len(name); i++ {
		c := name[i]
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-' {
			out = append(out, c)
		} else {
			out = append(out, '_')
		}
	}
	return string(out)
}

// isStuckInLoop detects repetitive tool call patterns:
// - Same tool+args 3x in a row (AAA)
// - Alternating pattern 3x (ABABAB = 6 turns)
// - Small set of unique tools repeated (e.g., only 2 unique tools in last 8 turns)
func isStuckInLoop(turns []agent.Turn) bool {
	if len(turns) < 4 {
		return false
	}

	// Get signatures of recent turns
	lookback := 8
	if lookback > len(turns) {
		lookback = len(turns)
	}
	sigs := make([]string, lookback)
	for i := 0; i < lookback; i++ {
		t := turns[len(turns)-1-i]
		if len(t.ToolCalls) == 0 {
			sigs[i] = "__no_tools__"
		} else {
			tc := t.ToolCalls[0]
			sigs[i] = tc.Call.Name + ":" + truncateForCompare(tc.Call.Input, 200)
		}
	}

	// Check: same command 3x in a row
	if len(sigs) >= 3 && sigs[0] == sigs[1] && sigs[1] == sigs[2] {
		return true
	}

	// Check: alternating pattern (ABAB) over last 6 turns
	if len(sigs) >= 6 && sigs[0] == sigs[2] && sigs[2] == sigs[4] && sigs[1] == sigs[3] && sigs[3] == sigs[5] {
		return true
	}

	// Check: only 1-2 unique tool signatures in last 8 turns
	if len(sigs) >= 8 {
		unique := make(map[string]bool)
		for _, s := range sigs {
			unique[s] = true
		}
		if len(unique) <= 2 {
			return true
		}
	}

	return false
}

func truncateForCompare(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max]
}

func compactToolResultForModelContext(result provider.ToolResult) provider.ToolResult {
	compacted := result
	compacted.Content = compactTextForModelContext(result.Content)
	return compacted
}

func compactTextForModelContext(content string) string {
	if len(content) <= maxToolResultContextChars {
		return content
	}

	headChars := toolResultContextHeadChars
	tailChars := toolResultContextTailChars
	if headChars > len(content) {
		headChars = len(content)
	}
	if tailChars > len(content)-headChars {
		tailChars = len(content) - headChars
	}
	if tailChars < 0 {
		tailChars = 0
	}

	truncatedChars := len(content) - headChars - tailChars
	if truncatedChars < 0 {
		truncatedChars = 0
	}

	head := content[:headChars]
	tail := ""
	if tailChars > 0 {
		tail = content[len(content)-tailChars:]
	}
	return head + fmt.Sprintf("\n\n...[truncated %d chars for model context]...\n\n", truncatedChars) + tail
}

func stuckLoopMessage(agentCfg *agent.Config) string {
	if agentCfg != nil {
		switch strings.TrimSpace(strings.ToLower(agentCfg.ID)) {
		case "vibe", "space:vibe":
			return "Stopped after repeated identical tool calls without making progress. Start a fresh run and follow the docs first, especially docs/goals and docs/construct-context when they exist."
		}
	}
	return "Stopped after repeated identical tool calls without making progress."
}

func shouldRetryForToolUse(agentTools []*tool.Tool, content string) bool {
	trimmed := strings.TrimSpace(content)
	if len(agentTools) == 0 {
		return false
	}
	// Don't retry on empty content — streaming may have already delivered the text
	if trimmed == "" {
		return false
	}
	return looksLikePlaintextToolDirective(trimmed, agentTools)
}

func requiresInitialToolUse(agentCfg *agent.Config) bool {
	if agentCfg == nil {
		return false
	}
	switch strings.TrimSpace(strings.ToLower(agentCfg.ID)) {
	case "vibe", "space:vibe":
		return true
	default:
		return false
	}
}

func toolUseNudge(agentCfg *agent.Config) string {
	if agentCfg != nil {
		switch strings.TrimSpace(strings.ToLower(agentCfg.ID)) {
		case "vibe", "space:vibe":
			return "You must issue a real tool call now. Use bash only for shell commands, write_file to create files, and edit_file for targeted edits. Do not narrate commands, and do not pass path/content payloads to bash."
		}
	}
	return "You must use tool calls, not text. Call the bash tool to run commands and write_file to create files. Do not output commands as plain text — invoke the tools."
}

func retryNudge(agentCfg *agent.Config, recoveringToolError bool) string {
	if recoveringToolError {
		if agentCfg != nil {
			switch strings.TrimSpace(strings.ToLower(agentCfg.ID)) {
			case "vibe", "space:vibe":
				return "The environment does support tool execution. The previous tool call failed because its input was malformed. Fix the tool input and call the appropriate tool again now. Do not apologize, do not stop, and do not claim tool access is unavailable."
			}
		}
		return "The previous tool call failed because its input was malformed. Fix the tool input and call the correct tool now."
	}
	return toolUseNudge(agentCfg)
}

func toolUseRetryLimit(agentCfg *agent.Config, hasUsedTools bool) int {
	if !hasUsedTools && requiresInitialToolUse(agentCfg) {
		return 4
	}
	return 2
}

func shouldRetryAfterToolError(agentCfg *agent.Config, content string) bool {
	if agentCfg == nil {
		return false
	}
	switch strings.TrimSpace(strings.ToLower(agentCfg.ID)) {
	case "vibe", "space:vibe":
	default:
		return false
	}

	normalized := strings.ToLower(strings.TrimSpace(content))
	if normalized == "" {
		return true
	}
	for _, phrase := range []string{
		"can't continue this task",
		"cannot continue this task",
		"don't have access to valid tool execution",
		"do not have access to valid tool execution",
		"don't have access to tool execution",
		"do not have access to tool execution",
		"tool execution in this environment",
	} {
		if strings.Contains(normalized, phrase) {
			return true
		}
	}
	return false
}

func looksLikePlaintextToolDirective(content string, agentTools []*tool.Tool) bool {
	normalized := strings.ToLower(strings.TrimSpace(content))
	if normalized == "" {
		return false
	}

	for _, toolDef := range agentTools {
		if toolDef == nil {
			continue
		}
		name := strings.ToLower(strings.TrimSpace(toolDef.Def.Name))
		if name == "" {
			continue
		}
		aliases := []string{
			name,
			strings.ReplaceAll(name, "_", "-"),
			name + "_code",
			strings.ReplaceAll(name, "_", "") + "_code",
		}
		for _, alias := range aliases {
			alias = strings.TrimSpace(alias)
			if alias == "" {
				continue
			}
			if strings.Contains(normalized, "to="+alias) ||
				strings.Contains(normalized, "tool:"+alias) ||
				strings.Contains(normalized, "tool = "+alias) ||
				strings.Contains(normalized, "function:"+alias) ||
				strings.Contains(normalized, "function = "+alias) {
				return true
			}
		}
	}

	return false
}

type plaintextToolDirective struct {
	Name string
	Body string
}

func synthesizePlaintextToolCalls(content string, agentTools []*tool.Tool) []provider.ToolCall {
	directives := parsePlaintextToolDirectives(content, agentTools)
	if len(directives) == 0 {
		return synthesizeInlineJSONToolCalls(content, agentTools)
	}

	toolCalls := make([]provider.ToolCall, 0, len(directives))
	for index, directive := range directives {
		input, ok := plaintextToolInput(directive.Name, directive.Body)
		if !ok {
			return nil
		}
		toolCalls = append(toolCalls, provider.ToolCall{
			ID:    fmt.Sprintf("plaintext-tool-%d", index+1),
			Name:  directive.Name,
			Input: input,
		})
	}
	return toolCalls
}

func synthesizeInlineJSONToolCalls(content string, agentTools []*tool.Tool) []provider.ToolCall {
	remaining := content
	toolCalls := make([]provider.ToolCall, 0)
	for len(remaining) > 0 {
		idx := strings.Index(strings.ToLower(remaining), "to=")
		if idx == -1 {
			break
		}
		remaining = remaining[idx+3:]
		aliasPart := strings.TrimSpace(remaining)
		if aliasPart == "" {
			break
		}
		end := len(aliasPart)
		for index, r := range aliasPart {
			if r == ':' || r == ' ' || r == '\t' || r == '\n' {
				end = index
				break
			}
		}
		alias := strings.TrimSpace(aliasPart[:end])
		name, ok := canonicalToolName(alias, agentTools)
		if !ok {
			remaining = aliasPart[end:]
			continue
		}
		jsonOffset := strings.Index(aliasPart[end:], "{")
		if jsonOffset == -1 {
			remaining = aliasPart[end:]
			continue
		}
		jsonStart := aliasPart[end+jsonOffset:]
		payload, ok := extractLeadingJSONObject(jsonStart)
		if !ok {
			remaining = aliasPart[end+jsonOffset:]
			continue
		}
		toolCalls = append(toolCalls, provider.ToolCall{
			ID:    fmt.Sprintf("plaintext-inline-tool-%d", len(toolCalls)+1),
			Name:  name,
			Input: payload,
		})
		remaining = jsonStart[len(payload):]
	}
	if len(toolCalls) == 0 {
		return nil
	}
	return toolCalls
}

func parsePlaintextToolDirectives(content string, agentTools []*tool.Tool) []plaintextToolDirective {
	lines := strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n")
	directives := make([]plaintextToolDirective, 0)
	currentName := ""
	var bodyLines []string
	flush := func() {
		if currentName == "" {
			return
		}
		directives = append(directives, plaintextToolDirective{
			Name: currentName,
			Body: strings.TrimSpace(strings.Join(bodyLines, "\n")),
		})
		currentName = ""
		bodyLines = nil
	}

	for _, rawLine := range lines {
		if name, ok := parsePlaintextToolHeader(rawLine, agentTools); ok {
			flush()
			currentName = name
			bodyLines = nil
			continue
		}
		if currentName == "" {
			if strings.TrimSpace(rawLine) != "" {
				return nil
			}
			continue
		}
		bodyLines = append(bodyLines, rawLine)
	}
	flush()

	if len(directives) == 0 {
		return nil
	}
	for _, directive := range directives {
		if directive.Body == "" {
			return nil
		}
	}
	return directives
}

func parsePlaintextToolHeader(line string, agentTools []*tool.Tool) (string, bool) {
	trimmed := strings.TrimSpace(line)
	if !strings.HasPrefix(strings.ToLower(trimmed), "to=") {
		return "", false
	}
	aliasPart := strings.TrimSpace(trimmed[3:])
	if aliasPart == "" {
		return "", false
	}
	end := len(aliasPart)
	for index, r := range aliasPart {
		if r == ':' || r == ' ' || r == '\t' {
			end = index
			break
		}
	}
	alias := strings.TrimSpace(aliasPart[:end])
	if alias == "" {
		return "", false
	}
	if name, ok := canonicalToolName(alias, agentTools); ok {
		return name, true
	}
	return "", false
}

func canonicalToolName(alias string, agentTools []*tool.Tool) (string, bool) {
	normalizedAlias := normalizePlaintextToolAlias(alias)
	if normalizedAlias == "" {
		return "", false
	}
	for _, toolDef := range agentTools {
		if toolDef == nil {
			continue
		}
		name := strings.TrimSpace(toolDef.Def.Name)
		if name == "" {
			continue
		}
		for _, candidate := range []string{
			name,
			strings.ReplaceAll(name, "_", "-"),
			name + "_code",
			strings.ReplaceAll(name, "_", "") + "_code",
			name + " code",
		} {
			if normalizePlaintextToolAlias(candidate) == normalizedAlias {
				return name, true
			}
		}
	}
	return "", false
}

func normalizePlaintextToolAlias(alias string) string {
	normalized := strings.ToLower(strings.TrimSpace(alias))
	normalized = strings.TrimSuffix(normalized, ":")
	normalized = strings.TrimSpace(normalized)
	normalized = strings.TrimPrefix(normalized, "functions.")
	normalized = strings.TrimSuffix(normalized, "_code")
	normalized = strings.TrimSuffix(normalized, " code")
	normalized = strings.ReplaceAll(normalized, "-", "_")
	return strings.TrimSpace(normalized)
}

func plaintextToolInput(name, body string) (string, bool) {
	trimmed := strings.TrimSpace(body)
	if trimmed == "" {
		return "", false
	}
	if strings.HasPrefix(trimmed, "{") {
		if candidate, ok := extractLeadingJSONObject(trimmed); ok {
			var raw map[string]any
			if err := json.Unmarshal([]byte(candidate), &raw); err == nil {
				return candidate, true
			}
		}
	}

	switch name {
	case "bash":
		command := sanitizePlaintextBashBody(trimmed)
		if command == "" {
			return "", false
		}
		payload, err := json.Marshal(map[string]string{"command": command})
		return string(payload), err == nil
	case "write_file":
		fields := parsePlaintextToolFields(trimmed, map[string]bool{"path": true, "content": true})
		if fields["path"] == "" || fields["content"] == "" {
			return "", false
		}
		payload, err := json.Marshal(map[string]string{
			"path":    fields["path"],
			"content": fields["content"],
		})
		return string(payload), err == nil
	case "edit_file":
		fields := parsePlaintextToolFields(trimmed, map[string]bool{"path": true, "old_string": true, "new_string": true})
		if fields["path"] == "" || fields["old_string"] == "" || fields["new_string"] == "" {
			return "", false
		}
		payload, err := json.Marshal(map[string]string{
			"path":       fields["path"],
			"old_string": fields["old_string"],
			"new_string": fields["new_string"],
		})
		return string(payload), err == nil
	case "read_file", "list_dir":
		fields := parsePlaintextToolFields(trimmed, map[string]bool{"path": true})
		pathValue := fields["path"]
		if pathValue == "" {
			pathValue = firstNonEmptyLine(trimmed)
		}
		if pathValue == "" {
			return "", false
		}
		payload, err := json.Marshal(map[string]string{"path": pathValue})
		return string(payload), err == nil
	case "glob":
		fields := parsePlaintextToolFields(trimmed, map[string]bool{"pattern": true})
		pattern := fields["pattern"]
		if pattern == "" {
			pattern = firstNonEmptyLine(trimmed)
		}
		if pattern == "" {
			return "", false
		}
		payload, err := json.Marshal(map[string]string{"pattern": pattern})
		return string(payload), err == nil
	case "grep":
		fields := parsePlaintextToolFields(trimmed, map[string]bool{"pattern": true, "path": true})
		if fields["pattern"] == "" {
			return "", false
		}
		payload, err := json.Marshal(map[string]string{
			"pattern": fields["pattern"],
			"path":    fields["path"],
		})
		return string(payload), err == nil
	case "spawn_agent":
		fields := parsePlaintextToolFields(trimmed, map[string]bool{"agent_id": true, "task": true})
		if fields["agent_id"] == "" || fields["task"] == "" {
			return "", false
		}
		payload, err := json.Marshal(map[string]string{
			"agent_id": fields["agent_id"],
			"task":     fields["task"],
		})
		return string(payload), err == nil
	default:
		return "", false
	}
}

func sanitizePlaintextBashBody(body string) string {
	lines := strings.Split(body, "\n")
	commands := make([]string, 0, len(lines))
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			if len(commands) > 0 {
				commands = append(commands, "")
			}
			continue
		}
		if !looksLikeShellCommandLine(trimmed) {
			break
		}
		commands = append(commands, line)
	}
	return strings.TrimSpace(strings.Join(commands, "\n"))
}

func looksLikeShellCommandLine(line string) bool {
	if line == "" {
		return false
	}
	for _, prefix := range []string{
		"#", "$", "./", "../", "/", "cd ", "mkdir ", "npm ", "npx ", "pnpm ", "yarn ", "git ", "go ", "flutter ", "rails ",
		"ruby ", "bundle ", "gem ", "cat ", "tee ", "echo ", "printf ", "cp ", "mv ", "rm ", "touch ", "export ", "set ", "if ",
		"then", "fi", "for ", "do", "done", "while ", "pwd", "ls ", "find ", "sed ", "awk ", "chmod ", "source ", "brew ", "sudo ",
		"cargo ", "rustc ", "python ", "python3 ", "pip ", "uv ", "composer ", "docker ", "make ", "env ", "test ", "[", "{", "}",
	} {
		if strings.HasPrefix(line, prefix) {
			return true
		}
	}
	if strings.Contains(line, "&&") || strings.Contains(line, "||") || strings.Contains(line, ";") ||
		strings.Contains(line, " | ") || strings.Contains(line, ">") || strings.Contains(line, "<") ||
		strings.Contains(line, "$(") || strings.HasSuffix(line, "\\") {
		return true
	}
	if index := strings.Index(line, "="); index > 0 {
		left := line[:index]
		if isSimpleShellWord(left) {
			return true
		}
	}
	return false
}

func isSimpleShellWord(value string) bool {
	if value == "" {
		return false
	}
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' {
			continue
		}
		return false
	}
	return true
}

func parsePlaintextToolFields(body string, allowed map[string]bool) map[string]string {
	result := make(map[string]string)
	currentKey := ""
	for _, line := range strings.Split(body, "\n") {
		trimmed := strings.TrimSpace(line)
		if key, value, ok := strings.Cut(line, ":"); ok {
			normalizedKey := strings.TrimSpace(strings.ToLower(key))
			if allowed[normalizedKey] {
				currentKey = normalizedKey
				result[currentKey] = strings.TrimLeft(value, " ")
				continue
			}
		}
		if currentKey == "" {
			if trimmed == "" {
				continue
			}
			continue
		}
		if result[currentKey] != "" {
			result[currentKey] += "\n"
		}
		result[currentKey] += line
	}
	for key, value := range result {
		result[key] = strings.TrimSpace(value)
	}
	return result
}

func extractLeadingJSONObject(content string) (string, bool) {
	depth := 0
	inString := false
	escaped := false
	started := false
	for index, r := range content {
		if !started {
			if r == '{' {
				started = true
				depth = 1
			}
			continue
		}

		if escaped {
			escaped = false
			continue
		}
		if r == '\\' {
			escaped = true
			continue
		}
		if r == '"' {
			inString = !inString
			continue
		}
		if inString {
			continue
		}
		switch r {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return content[:index+1], true
			}
		}
	}
	return "", false
}

func firstNonEmptyLine(content string) string {
	for _, line := range strings.Split(content, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

// buildSystemWithContext enriches the agent's system prompt with project context
// and instructions from agents.md/AGENTS.md/CLAUDE.md files in the project root.
func buildSystemWithContext(base string, project *ProjectContext, ctx map[string]any) string {
	if project == nil && len(ctx) == 0 {
		return base
	}

	var parts []string
	parts = append(parts, base)

	// Add project metadata
	var projectInfo []string
	if project != nil {
		if project.Name != "" {
			projectInfo = append(projectInfo, fmt.Sprintf("Project: %s", project.Name))
		}
		if project.Type != "" {
			projectInfo = append(projectInfo, fmt.Sprintf("Type: %s", project.Type))
		}
		if project.Framework != "" {
			projectInfo = append(projectInfo, fmt.Sprintf("Framework: %s", project.Framework))
		}
		if project.RootPath != "" {
			projectInfo = append(projectInfo, fmt.Sprintf("Root: %s", project.RootPath))
		}
	}
	if len(projectInfo) > 0 {
		parts = append(parts, "\n\n## Project Context\n"+strings.Join(projectInfo, "\n"))
	}

	if len(ctx) > 0 {
		var contextInfo []string
		if mode, _ := ctx["mode"].(string); mode != "" {
			contextInfo = append(contextInfo, fmt.Sprintf("Mode: %s", mode))
		}
		if component, ok := ctx["component"].(map[string]any); ok {
			if name, _ := component["name"].(string); name != "" {
				kind, _ := component["type"].(string)
				if kind != "" {
					contextInfo = append(contextInfo, fmt.Sprintf("Component: %s (%s)", name, kind))
				} else {
					contextInfo = append(contextInfo, fmt.Sprintf("Component: %s", name))
				}
			}
			if filePath, _ := component["filePath"].(string); filePath != "" {
				contextInfo = append(contextInfo, fmt.Sprintf("Component File: %s", filePath))
			}
		}
		if selection, ok := ctx["selection"].(map[string]any); ok {
			if selectionType, _ := selection["type"].(string); selectionType != "" {
				contextInfo = append(contextInfo, fmt.Sprintf("Selection: %s", selectionType))
			}
			if content, _ := selection["content"].(string); content != "" {
				contextInfo = append(contextInfo, fmt.Sprintf("Selection Content: %s", content))
			}
		}
		if len(contextInfo) > 0 {
			parts = append(parts, "\n\n## Active UI Context\n"+strings.Join(contextInfo, "\n"))
		}

		var runtimeInfo []string
		if projectName, _ := ctx["project_name"].(string); strings.TrimSpace(projectName) != "" {
			runtimeInfo = append(runtimeInfo, fmt.Sprintf("Project Name: %s", strings.TrimSpace(projectName)))
		}
		if projectPath, _ := ctx["project_path"].(string); strings.TrimSpace(projectPath) != "" {
			runtimeInfo = append(runtimeInfo, fmt.Sprintf("Project Path: %s", strings.TrimSpace(projectPath)))
		}
		if projectsRoot, _ := ctx["projects_root"].(string); strings.TrimSpace(projectsRoot) != "" {
			runtimeInfo = append(runtimeInfo, fmt.Sprintf("Projects Root: %s", strings.TrimSpace(projectsRoot)))
		}
		if projectDescription, _ := ctx["project_description"].(string); strings.TrimSpace(projectDescription) != "" {
			runtimeInfo = append(runtimeInfo, fmt.Sprintf("Project Description: %s", strings.TrimSpace(projectDescription)))
		}
		if vibeCtx, ok := ctx["vibe"].(map[string]any); ok {
			if goal, _ := vibeCtx["goal"].(string); strings.TrimSpace(goal) != "" {
				runtimeInfo = append(runtimeInfo, fmt.Sprintf("Vibe Goal: %s", strings.TrimSpace(goal)))
			}
			if source, _ := vibeCtx["source"].(string); strings.TrimSpace(source) != "" {
				runtimeInfo = append(runtimeInfo, fmt.Sprintf("Vibe Source: %s", strings.TrimSpace(source)))
			}
		}
		if vibeSession, ok := ctx["vibe_session"].(map[string]any); ok {
			if sessionID, _ := vibeSession["session_id"].(string); strings.TrimSpace(sessionID) != "" {
				runtimeInfo = append(runtimeInfo, fmt.Sprintf("Vibe Session ID: %s", strings.TrimSpace(sessionID)))
			}
			if status, _ := vibeSession["status"].(string); strings.TrimSpace(status) != "" {
				runtimeInfo = append(runtimeInfo, fmt.Sprintf("Vibe Session Status: %s", strings.TrimSpace(status)))
			}
			if currentPhase, _ := vibeSession["current_phase"].(string); strings.TrimSpace(currentPhase) != "" {
				runtimeInfo = append(runtimeInfo, fmt.Sprintf("Vibe Current Phase: %s", strings.TrimSpace(currentPhase)))
			}
		}
		if len(runtimeInfo) > 0 {
			parts = append(parts, "\n\n## Runtime Context\n"+strings.Join(runtimeInfo, "\n"))
		}
	}

	// Read project instruction files (agents.md, AGENTS.md, CLAUDE.md)
	if project != nil && project.RootPath != "" {
		for _, name := range []string{"agents.md", "AGENTS.md", "CLAUDE.md"} {
			path := filepath.Join(project.RootPath, name)
			data, err := os.ReadFile(path)
			if err != nil {
				continue
			}
			content := strings.TrimSpace(string(data))
			if content != "" {
				parts = append(parts, fmt.Sprintf("\n\n## Instructions from %s\n%s", name, content))
			}
		}
	}

	return strings.Join(parts, "")
}

// executeToolCalls runs tool calls, using parallel execution when there are
// multiple independent calls (no data dependencies between tool calls).
func (r *Runner) executeToolCalls(ctx context.Context, req *RunRequest, toolCalls []provider.ToolCall) []agent.ToolExecution {
	if len(toolCalls) <= 1 {
		// Single call — no parallelism needed
		results := make([]agent.ToolExecution, len(toolCalls))
		for i, tc := range toolCalls {
			results[i] = r.executeSingleTool(ctx, req, tc)
		}
		return results
	}

	// Multiple calls — execute in parallel
	results := make([]agent.ToolExecution, len(toolCalls))
	var wg sync.WaitGroup
	for i, tc := range toolCalls {
		wg.Add(1)
		go func(idx int, call provider.ToolCall) {
			defer wg.Done()
			results[idx] = r.executeSingleTool(ctx, req, call)
		}(i, tc)
	}
	wg.Wait()
	return results
}

// emitStatus sends a human-readable status event to the stream.
func emitStatus(em *stream.Emitter, state string, message string, extra map[string]any) {
	if em == nil {
		return
	}
	data := map[string]any{"state": state, "message": message}
	for k, v := range extra {
		data[k] = v
	}
	em.Emit(stream.Event{Type: "status", Data: data})
}

// toolTitle generates a human-readable description of a tool call.
func toolTitle(name, input string) string {
	var args map[string]any
	_ = json.Unmarshal([]byte(input), &args)

	str := func(key string) string {
		if args == nil {
			return ""
		}
		v, _ := args[key].(string)
		return v
	}

	short := func(s string, max int) string {
		if len(s) <= max {
			return s
		}
		return s[:max] + "…"
	}

	basename := func(path string) string {
		if i := strings.LastIndex(path, "/"); i >= 0 {
			return path[i+1:]
		}
		return path
	}

	switch name {
	case "bash":
		cmd := str("command")
		if cmd == "" {
			return "Running command"
		}
		// Make bash commands human-readable
		trimCmd := strings.TrimSpace(cmd)
		if strings.HasPrefix(trimCmd, "cd ") {
			// Extract the meaningful part after cd && ...
			if idx := strings.Index(trimCmd, "&&"); idx > 0 {
				after := strings.TrimSpace(trimCmd[idx+2:])
				if strings.HasPrefix(after, "npm run build") || strings.HasPrefix(after, "npm run") {
					return "Building project"
				}
				if strings.HasPrefix(after, "npm install") || strings.HasPrefix(after, "npm i") {
					return "Installing dependencies"
				}
				if strings.HasPrefix(after, "npm test") {
					return "Running tests"
				}
				return short(after, 50)
			}
		}
		if strings.HasPrefix(trimCmd, "mkdir") {
			return "Creating directories"
		}
		if strings.HasPrefix(trimCmd, "npm run build") {
			return "Building project"
		}
		if strings.HasPrefix(trimCmd, "npm install") || strings.HasPrefix(trimCmd, "npm i ") {
			return "Installing dependencies"
		}
		if strings.HasPrefix(trimCmd, "npm test") || strings.HasPrefix(trimCmd, "npx vitest") {
			return "Running tests"
		}
		if strings.HasPrefix(trimCmd, "git ") {
			return "Git: " + short(trimCmd[4:], 40)
		}
		return short(trimCmd, 50)
	case "read_file":
		if p := str("path"); p != "" {
			return "Reading " + basename(p)
		}
		return "Reading file"
	case "write_file":
		if p := str("path"); p != "" {
			return "Creating " + basename(p)
		}
		return "Creating file"
	case "edit_file":
		if p := str("path"); p != "" {
			return "Editing " + basename(p)
		}
		return "Editing file"
	case "list_dir":
		if p := str("path"); p != "" {
			return "Exploring " + basename(p)
		}
		return "Exploring directory"
	case "glob":
		if p := str("pattern"); p != "" {
			return "Finding files matching " + short(basename(p), 30)
		}
		return "Finding files"
	case "grep":
		if p := str("pattern"); p != "" {
			return "Searching for '" + short(p, 30) + "'"
		}
		return "Searching code"
	case "spawn_agent":
		if id := str("agent_id"); id != "" {
			task := str("task")
			if task != "" {
				return "Delegating to " + id + ": " + short(task, 40)
			}
			return "Delegating to " + id + " agent"
		}
		return "Delegating to sub-agent"
	case "get_project_context":
		return "Loading project context"
	default:
		return strings.ReplaceAll(name, "_", " ")
	}
}

func (r *Runner) executeSingleTool(ctx context.Context, req *RunRequest, tc provider.ToolCall) agent.ToolExecution {
	exec := agent.ToolExecution{Call: tc}

	// Log tool call to project log file
	if req.Project != nil && req.Project.RootPath != "" {
		logToolCall(req.Project.RootPath, req.Agent, tc)
	}

	// Pre-hooks
	if hookResult, err := r.hooks.RunPre(ctx, tc.Name, tc.Input); err == nil && hookResult != nil {
		exec.Hooks = append(exec.Hooks, *hookResult)
		if hookResult.Block {
			exec.Result = provider.ToolResult{
				CallID:  tc.ID,
				Content: fmt.Sprintf("blocked by hook: %s", hookResult.Message),
				IsError: true,
			}
			return exec
		}
	}

	// Handle spawn_agent specially
	if tc.Name == "spawn_agent" {
		exec.Result = r.handleSpawnAgent(ctx, req, tc)
		return exec
	}

	t, ok := r.tools.Get(tc.Name)
	if !ok {
		exec.Result = provider.ToolResult{
			CallID:  tc.ID,
			Content: fmt.Sprintf("unknown tool: %s", tc.Name),
			IsError: true,
		}
	} else {
		result, execErr := t.Executor.Execute(ctx, tc.Input)
		if execErr != nil {
			exec.Result = provider.ToolResult{
				CallID:  tc.ID,
				Content: execErr.Error(),
				IsError: true,
			}
		} else {
			exec.Result = provider.ToolResult{
				CallID:  tc.ID,
				Content: result.Content,
				IsError: result.IsError,
			}
		}
	}

	// Post-hooks
	if hookResult, err := r.hooks.RunPost(ctx, tc.Name, exec.Result.Content); err == nil && hookResult != nil {
		exec.Hooks = append(exec.Hooks, *hookResult)
	}

	return exec
}

// handleSpawnAgent creates and runs a child agent.
func (r *Runner) handleSpawnAgent(ctx context.Context, parentReq *RunRequest, tc provider.ToolCall) provider.ToolResult {
	if r.agentResolver == nil {
		return provider.ToolResult{
			CallID:  tc.ID,
			Content: "agent spawning not configured",
			IsError: true,
		}
	}

	var args struct {
		AgentID string `json:"agent_id"`
		Task    string `json:"task"`
	}
	if err := json.Unmarshal([]byte(tc.Input), &args); err != nil {
		return provider.ToolResult{
			CallID:  tc.ID,
			Content: fmt.Sprintf("invalid spawn_agent input: %v", err),
			IsError: true,
		}
	}

	// Check spawn allowlist if set
	if len(parentReq.Agent.SpawnAllowed) > 0 {
		allowed := false
		for _, a := range parentReq.Agent.SpawnAllowed {
			if a == args.AgentID {
				allowed = true
				break
			}
		}
		if !allowed {
			return provider.ToolResult{
				CallID:  tc.ID,
				Content: fmt.Sprintf("agent %q not in spawn allowlist: %v", args.AgentID, parentReq.Agent.SpawnAllowed),
				IsError: true,
			}
		}
	}

	childAgent := r.agentResolver(args.AgentID)
	if childAgent == nil {
		return provider.ToolResult{
			CallID:  tc.ID,
			Content: fmt.Sprintf("agent %q not found", args.AgentID),
			IsError: true,
		}
	}

	result, err := r.Run(ctx, &RunRequest{
		Agent:   childAgent,
		Task:    args.Task,
		Model:   parentReq.Model,
		Project: parentReq.Project,
		Stream:  parentReq.Stream, // Forward parent's stream so sub-agent events are visible
	})
	if err != nil {
		return provider.ToolResult{
			CallID:  tc.ID,
			Content: fmt.Sprintf("sub-agent error: %v", err),
			IsError: true,
		}
	}

	return provider.ToolResult{
		CallID:  tc.ID,
		Content: result.Content,
	}
}

// RegisterSpawnTool adds the spawn_agent tool to the registry if any agent can spawn.
func RegisterSpawnTool(reg *tool.Registry) {
	reg.Register(&tool.Tool{
		Def: provider.ToolDef{
			Name:        "spawn_agent",
			Description: "Spawn a sub-agent to handle a specific task. The sub-agent runs independently and returns its result.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"agent_id": map[string]any{
						"type":        "string",
						"description": "ID of the agent to spawn (e.g. 'architect', 'general')",
					},
					"task": map[string]any{
						"type":        "string",
						"description": "The task for the sub-agent to perform",
					},
				},
				"required": []string{"agent_id", "task"},
			},
		},
		// Executor is handled specially in the runner (not via the registry)
		Executor: &noopExecutor{},
		Source:   "builtin",
	})
}

type noopExecutor struct{}

func (n *noopExecutor) Execute(ctx context.Context, input string) (*tool.Result, error) {
	return &tool.Result{Content: "spawn_agent is handled by the runner"}, nil
}

// resolveProvider finds a provider for the given model.
// Returns the provider and the actual model to use (may differ from input if fallback).
// Accepts both bare model names ("claude-sonnet-4-6") and composite IDs ("anthropic-oauth:claude-sonnet-4-6").
func (r *Runner) resolveProvider(model string) (provider.Provider, string, error) {
	r.providersMu.RLock()
	defer r.providersMu.RUnlock()

	// Handle composite "provider:model" format from frontend
	if parts := strings.SplitN(model, ":", 2); len(parts) == 2 {
		providerID, modelName := parts[0], parts[1]
		if p, ok := r.providers[providerID]; ok {
			for _, m := range p.Models() {
				if m == modelName {
					return p, modelName, nil
				}
			}
			return nil, "", fmt.Errorf("provider %q does not support model %q", providerID, modelName)
		}
		// Some model IDs include ":" as part of the raw model name
		// (for example OpenRouter free-tier suffixes like ":free").
		// If the provider prefix is unknown, treat the whole string as a
		// bare model ID before surfacing a registration error.
		for _, p := range r.providers {
			for _, m := range p.Models() {
				if m == model {
					return p, model, nil
				}
			}
		}
		return nil, "", fmt.Errorf("provider %q not registered (need to authenticate?)", providerID)
	}

	// Exact match on bare model name
	for _, p := range r.providers {
		for _, m := range p.Models() {
			if m == model {
				return p, model, nil
			}
		}
	}
	// No silent cross-family fallback — if we asked for claude-*, don't route to Codex
	return nil, "", fmt.Errorf("no provider supports model %q (is the provider authenticated?)", model)
}

// fallbackProvider returns a different provider than the given one,
// preferring providers from the same model family (claude→anthropic, gpt→openai).
func (r *Runner) fallbackProvider(skipID string) (provider.Provider, string, error) {
	r.providersMu.RLock()
	defer r.providersMu.RUnlock()

	// Determine the family of the skipped provider so we prefer same-family fallback
	skipFamily := providerFamily(skipID)

	// First pass: same family
	for _, p := range r.providers {
		if p.ID() == skipID {
			continue
		}
		if providerFamily(p.ID()) == skipFamily {
			if models := p.Models(); len(models) > 0 {
				return p, models[0], nil
			}
		}
	}
	return nil, "", fmt.Errorf("no fallback provider available for family %q", skipFamily)
}

// providerFamily returns "anthropic", "openai", or the raw ID.
func providerFamily(providerID string) string {
	if strings.Contains(providerID, "anthropic") {
		return "anthropic"
	}
	if strings.Contains(providerID, "openai") || strings.Contains(providerID, "codex") {
		return "openai"
	}
	return providerID
}

// isAuthError checks if an error is an authentication/authorization failure.
func isAuthError(err error) bool {
	msg := err.Error()
	return strings.Contains(msg, "auth:") ||
		strings.Contains(msg, "401") ||
		strings.Contains(msg, "403") ||
		strings.Contains(msg, "refresh failed") ||
		strings.Contains(msg, "invalid_grant")
}

func (r *Runner) streamCall(ctx context.Context, p provider.Provider, req *provider.Request, emitter *stream.Emitter) (*provider.Response, error) {
	req.Stream = true
	ch, err := p.Stream(ctx, req)
	if err != nil {
		return nil, err
	}

	var fullContent string
	var toolCalls []provider.ToolCall
	var finalResp *provider.Response

	for event := range ch {
		switch event.Type {
		case "text_delta":
			fullContent += event.Text
			emitter.Emit(stream.Event{Type: "text", Data: map[string]any{"text": event.Text}})
		case "tool_call_start", "tool_call_delta", "tool_call_done":
			if event.ToolCall != nil {
				toolCalls = append(toolCalls, *event.ToolCall)
			}
		case "done":
			finalResp = event.Response
		case "error":
			return nil, fmt.Errorf("stream error: %s", event.Error)
		}
	}

	if finalResp != nil {
		if finalResp.Content == "" && fullContent != "" {
			finalResp.Content = fullContent
		}
		if len(finalResp.ToolCalls) == 0 && len(toolCalls) > 0 {
			finalResp.ToolCalls = toolCalls
		}
		if len(finalResp.ToolCalls) > 0 && (finalResp.StopReason == "" || finalResp.StopReason == "end_turn") {
			finalResp.StopReason = "tool_use"
		}
		return finalResp, nil
	}

	return &provider.Response{
		Content:   fullContent,
		ToolCalls: toolCalls,
		StopReason: func() string {
			if len(toolCalls) > 0 {
				return "tool_use"
			}
			return "end_turn"
		}(),
	}, nil
}

// ListProviders returns info about all registered providers.
// Returns models as {id, label} objects to match frontend AIProvider type.
func (r *Runner) ListProviders() []map[string]any {
	r.providersMu.RLock()
	defer r.providersMu.RUnlock()

	result := make([]map[string]any, 0, len(r.providers))
	for _, p := range r.providers {
		// Use rich metadata if the provider supplies it
		var models []map[string]any
		if mp, ok := p.(provider.ModelMetaProvider); ok {
			meta := mp.ModelsMeta()
			models = make([]map[string]any, len(meta))
			for i, m := range meta {
				models[i] = map[string]any{
					"id":           m.ID,
					"label":        m.Label,
					"capabilities": m.Capabilities,
				}
			}
		} else {
			modelIDs := p.Models()
			models = make([]map[string]any, len(modelIDs))
			for i, m := range modelIDs {
				models[i] = map[string]any{"id": m, "label": m}
			}
		}
		result = append(result, map[string]any{
			"id":     p.ID(),
			"label":  p.ID(),
			"models": models,
		})
	}
	return result
}

// AddProvider registers a new provider at runtime (e.g. after OAuth).
func (r *Runner) AddProvider(p provider.Provider) {
	r.providersMu.Lock()
	defer r.providersMu.Unlock()
	r.providers[p.ID()] = p
}

// RemoveProvider unregisters a provider by ID (e.g. on OAuth logout).
func (r *Runner) RemoveProvider(id string) {
	r.providersMu.Lock()
	defer r.providersMu.Unlock()
	delete(r.providers, id)
}

// ListSessions returns all tracked sessions.
func (r *Runner) ListSessions() []*session.Session {
	return r.sessions.List()
}

// GetSession returns a session by ID.
func (r *Runner) GetSession(id string) (*session.Session, bool) {
	return r.sessions.Get(id)
}

// ─── Project-level logging ───
// Writes a human-readable log to {project_root}/.construct/coder.log
// so the user can monitor and review the full agent session.

var projectLogMu sync.Mutex

func projectLogPath(projectRoot string) string {
	dir := filepath.Join(projectRoot, ".construct")
	os.MkdirAll(dir, 0755)
	return filepath.Join(dir, "coder.log")
}

func appendProjectLog(projectRoot string, agentCfg *agent.Config, line string) {
	agentID := "agent"
	if agentCfg != nil {
		agentID = agentCfg.ID
	}
	ts := time.Now().Format("15:04:05")
	entry := fmt.Sprintf("[%s] [%s] %s\n", ts, agentID, line)

	projectLogMu.Lock()
	defer projectLogMu.Unlock()
	f, err := os.OpenFile(projectLogPath(projectRoot), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	defer f.Close()
	f.WriteString(entry)
}

func logToolCall(projectRoot string, agentCfg *agent.Config, tc provider.ToolCall) {
	// Extract primary arg for readable logging
	arg := ""
	if tc.Input != "" {
		var parsed map[string]any
		if json.Unmarshal([]byte(tc.Input), &parsed) == nil {
			for _, key := range []string{"path", "pattern", "command", "agent_id"} {
				if v, ok := parsed[key].(string); ok && v != "" {
					arg = v
					break
				}
			}
		}
	}
	line := tc.Name
	if arg != "" {
		if len(arg) > 120 {
			arg = arg[:120] + "..."
		}
		line += "(" + arg + ")"
	}
	appendProjectLog(projectRoot, agentCfg, line)
}

// conversationLogger groups logs by session into a single JSONL file.
var conversationLogMu sync.Mutex

// logConversation appends a raw LLM request or response to a per-session log file.
// Format: one JSON object per line (JSONL) in logs/conversations/{date}_{agent}.jsonl
func logConversation(agentCfg *agent.Config, turn int, phase string, req *provider.Request, resp *provider.Response) {
	logsDir := filepath.Join(appdir.LogsDir(), "conversations")
	os.MkdirAll(logsDir, 0755)

	agentID := "unknown"
	if agentCfg != nil {
		agentID = agentCfg.ID
	}

	entry := map[string]any{
		"ts":    time.Now().Format(time.RFC3339),
		"agent": agentID,
		"turn":  turn,
		"phase": phase,
		"model": req.Model,
	}

	if phase == "request" {
		entry["system"] = req.System
		entry["messages"] = req.Messages
		// Log tool names only (schemas are too large)
		toolNames := make([]string, 0, len(req.Tools))
		for _, t := range req.Tools {
			toolNames = append(toolNames, t.Name)
		}
		entry["tools"] = toolNames
	}

	if phase == "response" && resp != nil {
		entry["content"] = resp.Content
		entry["reasoning"] = resp.ReasoningContent
		entry["stop_reason"] = resp.StopReason
		entry["tool_calls"] = resp.ToolCalls
		entry["input_tokens"] = resp.Usage.InputTokens
		entry["output_tokens"] = resp.Usage.OutputTokens
	}

	line, err := json.Marshal(entry)
	if err != nil {
		return
	}
	line = append(line, '\n')

	// Append to daily per-agent JSONL file
	date := time.Now().Format("2006-01-02")
	filename := filepath.Join(logsDir, fmt.Sprintf("%s_%s.jsonl", date, agentID))

	conversationLogMu.Lock()
	defer conversationLogMu.Unlock()
	f, err := os.OpenFile(filename, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	defer f.Close()
	f.Write(line)
}
