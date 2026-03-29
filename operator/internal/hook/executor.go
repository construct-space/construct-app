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
	"time"
)

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
