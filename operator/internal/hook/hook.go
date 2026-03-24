// Package hook implements pre/post execution hooks.
// Hooks run before and after tool execution, allowing users to
// customize behavior (e.g., block writes to certain paths, log tool usage).
package hook

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

func constructProjectsRoot() string {
	if root := os.Getenv("CONSTRUCT_PROJECTS_ROOT"); root != "" {
		return root
	}
	if home, err := os.UserHomeDir(); err == nil {
		return filepath.Join(home, "ConstructProjects")
	}
	return ""
}

func isInsideProjectsRoot(path string) bool {
	root := constructProjectsRoot()
	if root == "" {
		return false
	}
	return strings.HasPrefix(path, root+string(filepath.Separator)) || path == root
}

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

// Registry holds all registered hooks.
type Registry struct {
	mu             sync.RWMutex
	hooks          []Hook
	enabled        map[string]bool
	metrics        map[string]Metrics
	getProjectRoot func(context.Context) string // dynamic project root for safety hooks
}

func NewRegistry() *Registry {
	return &Registry{
		enabled: make(map[string]bool),
		metrics: make(map[string]Metrics),
	}
}

func (r *Registry) Register(h Hook) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if h.Name == "" {
		h.Name = h.ID
	}
	r.hooks = append(r.hooks, h)
	if _, ok := r.enabled[h.ID]; !ok {
		r.enabled[h.ID] = true
	}
}

// List returns all registered hooks.
func (r *Registry) List() []Hook {
	r.mu.RLock()
	defer r.mu.RUnlock()

	result := make([]Hook, len(r.hooks))
	copy(result, r.hooks)
	return result
}

func (r *Registry) Get(id string) (Hook, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	for _, h := range r.hooks {
		if h.ID == id {
			return h, true
		}
	}
	return Hook{}, false
}

func (r *Registry) IsEnabled(id string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	enabled, ok := r.enabled[id]
	return ok && enabled
}

func (r *Registry) SetEnabled(id string, enabled bool) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	for _, h := range r.hooks {
		if h.ID == id {
			r.enabled[id] = enabled
			return true
		}
	}
	return false
}

func (r *Registry) Metrics() map[string]Metrics {
	r.mu.RLock()
	defer r.mu.RUnlock()

	result := make(map[string]Metrics, len(r.metrics))
	for id, metric := range r.metrics {
		metric.totalDuration = 0
		result[id] = metric
	}
	return result
}

// dynamicEnv returns extra env vars injected by the registry (e.g. project root).
func (r *Registry) dynamicEnv(ctx context.Context) map[string]string {
	env := map[string]string{}
	if r.getProjectRoot != nil {
		if root := r.getProjectRoot(ctx); root != "" {
			env["CONSTRUCT_PROJECT_ROOT"] = root
		}
	}
	return env
}

func (r *Registry) activeHooksByType(hookType Type) []Hook {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var result []Hook
	for _, h := range r.hooks {
		if h.Type != hookType {
			continue
		}
		if enabled, ok := r.enabled[h.ID]; ok && !enabled {
			continue
		}
		result = append(result, h)
	}
	return result
}

func (r *Registry) recordMetric(id string, duration time.Duration, hadError bool) {
	r.mu.Lock()
	defer r.mu.Unlock()

	metric := r.metrics[id]
	metric.ExecutionCount++
	if hadError {
		metric.ErrorCount++
	}
	metric.totalDuration += duration
	metric.AvgDuration = float64(metric.totalDuration.Milliseconds()) / float64(metric.ExecutionCount)
	metric.LastExecuted = time.Now().UTC().Format(time.RFC3339)
	r.metrics[id] = metric
}

// RunPre executes pre-tool hooks for the given tool name.
// All matching hooks run unless one blocks — only a blocking result stops early.
func (r *Registry) RunPre(ctx context.Context, toolName, input string) (*Result, error) {
	extraEnv := r.dynamicEnv(ctx)
	hooks := r.activeHooksByType(PreTool)
	var lastResult *Result
	for _, h := range hooks {
		if !matchesTool(h.Tools, toolName) {
			continue
		}
		if !matchesPatterns(h.Patterns, input) {
			continue
		}

		env := map[string]string{
			"HOOK_TYPE":  "pre",
			"TOOL_NAME":  toolName,
			"TOOL_INPUT": input,
		}
		for k, v := range extraEnv {
			env[k] = v
		}
		startedAt := time.Now()
		result, err := executeHook(ctx, h, env)
		r.recordMetric(h.ID, time.Since(startedAt), err != nil)
		if err != nil {
			return nil, err
		}
		if result != nil {
			lastResult = result
			if result.Block {
				return result, nil // Stop immediately on block
			}
		}
	}
	return lastResult, nil
}

// RunPost executes post-tool hooks for the given tool name.
// All matching hooks run — post hooks never block.
func (r *Registry) RunPost(ctx context.Context, toolName, output string) (*Result, error) {
	extraEnv := r.dynamicEnv(ctx)
	hooks := r.activeHooksByType(PostTool)
	var lastResult *Result
	for _, h := range hooks {
		if !matchesTool(h.Tools, toolName) {
			continue
		}

		env := map[string]string{
			"HOOK_TYPE":   "post",
			"TOOL_NAME":   toolName,
			"TOOL_OUTPUT": output,
		}
		for k, v := range extraEnv {
			env[k] = v
		}
		startedAt := time.Now()
		result, err := executeHook(ctx, h, env)
		r.recordMetric(h.ID, time.Since(startedAt), err != nil)
		if err != nil {
			return nil, err
		}
		if result != nil {
			lastResult = result
		}
	}
	return lastResult, nil
}

func executeHook(ctx context.Context, h Hook, env map[string]string) (*Result, error) {
	// Go-native check — no shell, no external dependencies
	if h.Check != nil {
		block, msg := h.Check(ctx, env["TOOL_NAME"], env["TOOL_INPUT"])
		if block || msg != "" {
			return &Result{HookID: h.ID, Block: block, Message: msg}, nil
		}
		return nil, nil
	}

	if h.Command == "" {
		return nil, nil
	}

	timeout := h.Timeout
	if timeout <= 0 {
		timeout = 10
	}
	execCtx, cancel := context.WithTimeout(ctx, time.Duration(timeout)*time.Second)
	defer cancel()

	shell, shellFlag := platformShell()
	cmd := exec.CommandContext(execCtx, shell, shellFlag, h.Command)
	cmd.Env = os.Environ()
	for k, v := range env {
		cmd.Env = append(cmd.Env, k+"="+v)
	}

	// For plugin hooks: serialize a JSON-RPC request safely in Go
	if h.RpcHookID != "" {
		params := map[string]string{
			"hook_id":   h.RpcHookID,
			"hook_type": env["HOOK_TYPE"],
			"tool_name": env["TOOL_NAME"],
		}
		// Pre hooks get tool input, post hooks get tool output
		if env["HOOK_TYPE"] == "post" {
			params["output"] = env["TOOL_OUTPUT"]
		} else {
			params["input"] = env["TOOL_INPUT"]
		}
		rpcReq := map[string]any{
			"jsonrpc": "2.0",
			"method":  "hook.execute",
			"id":      1,
			"params":  params,
		}
		rpcData, _ := json.Marshal(rpcReq)
		cmd.Env = append(cmd.Env, "HOOK_RPC_REQUEST="+string(rpcData))
	}

	output, err := cmd.CombinedOutput()
	outputStr := strings.TrimSpace(string(output))

	if execCtx.Err() == context.DeadlineExceeded {
		return &Result{
			HookID:  h.ID,
			Block:   false,
			Message: fmt.Sprintf("hook %s timed out after %ds", h.ID, timeout),
			Output:  outputStr,
		}, nil
	}

	if err != nil {
		// Non-zero exit = block the tool
		return &Result{
			HookID:  h.ID,
			Block:   true,
			Message: fmt.Sprintf("hook %s blocked: %s", h.ID, outputStr),
			Output:  outputStr,
		}, nil
	}

	// Try to parse JSON output for structured result
	var jsonResult struct {
		Block   bool   `json:"block"`
		Message string `json:"message"`
	}
	if json.Unmarshal(output, &jsonResult) == nil && jsonResult.Message != "" {
		return &Result{
			HookID:  h.ID,
			Block:   jsonResult.Block,
			Message: jsonResult.Message,
			Output:  outputStr,
		}, nil
	}

	// Zero exit, no JSON = hook passed (no blocking)
	if outputStr != "" {
		return &Result{
			HookID:  h.ID,
			Block:   false,
			Message: outputStr,
			Output:  outputStr,
		}, nil
	}

	return nil, nil
}

func matchesTool(tools []string, name string) bool {
	if len(tools) == 0 {
		return true // empty = all tools
	}
	for _, t := range tools {
		if t == name {
			return true
		}
		// Support glob patterns
		if matched, _ := filepath.Match(t, name); matched {
			return true
		}
	}
	return false
}

func matchesPatterns(patterns []string, input string) bool {
	if len(patterns) == 0 {
		return true
	}
	// Try to extract "path" from JSON input (for tools like write_file, edit_file)
	targets := []string{input}
	var parsed struct {
		Path     string `json:"path"`
		FilePath string `json:"file_path"`
	}
	if json.Unmarshal([]byte(input), &parsed) == nil {
		if parsed.Path != "" {
			targets = append(targets, parsed.Path)
		}
		if parsed.FilePath != "" {
			targets = append(targets, parsed.FilePath)
		}
	}
	for _, pattern := range patterns {
		for _, target := range targets {
			if matched, _ := filepath.Match(pattern, target); matched {
				return true
			}
			if strings.Contains(target, pattern) {
				return true
			}
		}
	}
	return false
}

// platformShell returns the shell executable and flag for the current OS.
func platformShell() (string, string) {
	if runtime.GOOS == "windows" {
		return "cmd", "/c"
	}
	return "sh", "-c"
}

// --- Built-in Safety Hooks ---

type ProjectRootFunc func(context.Context) string

// RegisterSafetyHooks adds built-in safety hooks that block dangerous operations.
// All built-in hooks are pure Go — no shell, no python3, no grep.
// Works identically on macOS, Linux, and Windows.
func RegisterSafetyHooks(reg *Registry, getProjectRoot ProjectRootFunc) {
	reg.getProjectRoot = getProjectRoot

	// Block writes outside project root
	reg.Register(Hook{
		ID:          "safety-project-boundary",
		Name:        "Project Boundary",
		Description: "Blocks file writes outside the active project root.",
		Type:        PreTool,
		Tools:       []string{"write_file", "edit_file"},
		Source:      "builtin",
		Check: func(ctx context.Context, toolName, input string) (bool, string) {
			root := ""
			if getProjectRoot != nil {
				root = getProjectRoot(ctx)
			}
			if root == "" {
				return false, ""
			}
			// Parse path from JSON input
			var params struct {
				Path string `json:"path"`
			}
			if err := json.Unmarshal([]byte(input), &params); err != nil || params.Path == "" {
				return false, ""
			}
			p := params.Path
			if strings.HasPrefix(p, "~/") {
				if h, e := os.UserHomeDir(); e == nil {
					p = filepath.Join(h, p[2:])
				}
			}
			if !filepath.IsAbs(p) {
				p = filepath.Join(root, p)
			}
			resolved, err := filepath.Abs(p)
			if err != nil {
				return false, ""
			}
			resolved = filepath.Clean(resolved)
			// Allow writes inside ~/ConstructProjects
			if isInsideProjectsRoot(resolved) {
				return false, ""
			}
			root = filepath.Clean(root)
			if !strings.HasPrefix(resolved, root+string(filepath.Separator)) && resolved != root {
				return true, fmt.Sprintf("Cannot write outside project root: %s", root)
			}
			return false, ""
		},
	})

	// Block destructive bash commands
	reg.Register(Hook{
		ID:          "safety-destructive-commands",
		Name:        "Destructive Command Guard",
		Description: "Blocks obviously destructive shell commands before execution.",
		Type:        PreTool,
		Tools:       []string{"bash"},
		Source:      "builtin",
		Check: func(ctx context.Context, toolName, input string) (bool, string) {
			lower := strings.ToLower(input)
			dangerous := []string{
				"rm -rf /", "rm -rf ~/", "rm -rf ~",
				"git push --force", "git push -f ",
				"drop table", "drop database",
			}
			for _, pattern := range dangerous {
				if strings.Contains(lower, pattern) {
					return true, "Blocked potentially destructive command"
				}
			}
			return false, ""
		},
	})

	// Sandbox bash to project root — block commands that explicitly escape
	reg.Register(Hook{
		ID:          "safety-bash-sandbox",
		Name:        "Bash Project Sandbox",
		Description: "Prevents bash commands from operating outside the project root.",
		Type:        PreTool,
		Tools:       []string{"bash"},
		Source:      "builtin",
		Check: func(ctx context.Context, toolName, input string) (bool, string) {
			root := ""
			if getProjectRoot != nil {
				root = getProjectRoot(ctx)
			}
			if root == "" {
				return false, ""
			}
			// Parse command from JSON
			var params struct {
				Command string `json:"command"`
			}
			if err := json.Unmarshal([]byte(input), &params); err != nil || params.Command == "" {
				return false, ""
			}
			cmd := params.Command
			// Block explicit absolute paths outside project root
			// Allow: /usr/bin/*, /tmp/*, /dev/null, and the project root itself
			allowedPrefixes := []string{root, constructProjectsRoot(), "/usr/", "/bin/", "/tmp/", "/dev/", "/opt/homebrew/"}
			words := strings.Fields(cmd)
			for _, word := range words {
				if strings.HasPrefix(word, "/") && !strings.HasPrefix(word, "//") {
					allowed := false
					for _, prefix := range allowedPrefixes {
						if strings.HasPrefix(word, prefix) {
							allowed = true
							break
						}
					}
					if !allowed {
						return true, fmt.Sprintf("Command references path outside project root: %s (project: %s)", word, root)
					}
				}
			}
			return false, ""
		},
	})
}

// --- Config Loading ---

// HookConfig is the format of hook config files.
type HookConfig struct {
	Hooks []Hook `json:"hooks"`
}

// LoadFromDir loads hook configs from all .json files in a directory.
// Each file should be a HookConfig ({"hooks": [...]}).
// Returns nil if the directory doesn't exist.
func LoadFromDir(dir, source string) ([]Hook, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	var all []Hook
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".json" {
			continue
		}
		hooks, err := LoadConfig(filepath.Join(dir, e.Name()))
		if err != nil {
			fmt.Fprintf(os.Stderr, "[hook] warning: %s: %v\n", e.Name(), err)
			continue
		}
		for i := range hooks {
			if hooks[i].Source == "" {
				hooks[i].Source = source
			}
		}
		all = append(all, hooks...)
	}
	return all, nil
}

// LoadConfig reads a hook configuration file.
func LoadConfig(path string) ([]Hook, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	var cfg HookConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	return cfg.Hooks, nil
}
