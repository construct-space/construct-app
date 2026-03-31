package runner

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"construct-operator/internal/agent"
	"construct-operator/internal/provider"
	"construct-operator/internal/stream"
)

// DefaultToolTimeout is the default per-tool execution timeout.
// Individual tools can override via ToolTimeouts on the Runner.
const DefaultToolTimeout = 5 * time.Minute

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

func (r *Runner) executeSingleTool(ctx context.Context, req *RunRequest, tc provider.ToolCall) agent.ToolExecution {
	exec := agent.ToolExecution{Call: tc}

	// Log tool call to project log file
	if req.Project != nil && req.Project.RootPath != "" {
		logToolCall(req.Project.RootPath, req.Agent, tc)
	}

	// Pre-hooks — hook errors on blocking hooks must stop execution
	hookResult, hookErr := r.hooks.RunPre(ctx, tc.Name, tc.Input)
	if hookErr != nil {
		exec.Result = provider.ToolResult{
			CallID:  tc.ID,
			Content: fmt.Sprintf("pre-hook execution failed: %v", hookErr),
			IsError: true,
		}
		return exec
	}
	if hookResult != nil {
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
		// Apply per-tool timeout
		timeout := DefaultToolTimeout
		if r.toolTimeouts != nil {
			if t, ok := r.toolTimeouts[tc.Name]; ok {
				timeout = t
			}
		}
		toolCtx, toolCancel := context.WithTimeout(ctx, timeout)
		result, execErr := t.Executor.Execute(toolCtx, tc.Input)
		toolCancel()
		if execErr != nil {
			errMsg := execErr.Error()
			if toolCtx.Err() == context.DeadlineExceeded {
				errMsg = fmt.Sprintf("tool %s timed out after %s", tc.Name, timeout)
			}
			exec.Result = provider.ToolResult{
				CallID:  tc.ID,
				Content: errMsg,
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

	// Post-hooks — log errors but don't block
	postResult, postErr := r.hooks.RunPost(ctx, tc.Name, exec.Result.Content)
	if postErr != nil {
		fmt.Fprintf(os.Stderr, "[runner] post-hook error for tool %s: %v\n", tc.Name, postErr)
	}
	if postResult != nil {
		exec.Hooks = append(exec.Hooks, *postResult)
	}

	return exec
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
