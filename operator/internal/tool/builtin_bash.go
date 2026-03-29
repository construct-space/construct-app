package tool

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"strings"

	"construct-operator/internal/provider"
)

func bashTool(getWorkDir WorkDirFunc) *Tool {
	return &Tool{
		Def: provider.ToolDef{
			Name:        "bash",
			Description: "Execute a shell command. Returns stdout and stderr.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"command": map[string]any{
						"type":        "string",
						"description": "The shell command to execute",
					},
				},
				"required": []string{"command"},
			},
		},
		Executor: &funcExecutor{fn: func(ctx context.Context, input string) (*Result, error) {
			var args struct {
				Command string `json:"command"`
			}
			if err := json.Unmarshal([]byte(input), &args); err != nil {
				return &Result{Content: err.Error(), IsError: true}, nil
			}
			if strings.TrimSpace(args.Command) == "" {
				return &Result{Content: "missing required field: command", IsError: true}, nil
			}
			if looksLikeWriteFilePayload(args.Command) {
				return &Result{
					Content: "bash received a file payload. Use write_file for path/content file creation instead of bash.",
					IsError: true,
				}, nil
			}
			if looksLikeLongRunningDevServerCommand(args.Command) {
				return &Result{
					Content: "bash received a long-running dev server command. Do not start dev servers or watch processes in agent runs. Verify with a bounded command such as npm run build, npm test, vite build, or another non-interactive check instead.",
					IsError: true,
				}, nil
			}
			wd := getWorkDir(ctx)
			cmd := exec.CommandContext(ctx, "bash", "-c", args.Command)
			if dir := existingCommandDir(wd); dir != "" {
				cmd.Dir = dir
			}
			// Sandbox: set CONSTRUCT_PROJECT_ROOT so hooks/scripts can validate,
			// and prevent cd-escape by wrapping in a restricted env
			if wd != "" {
				cmd.Env = append(os.Environ(), "CONSTRUCT_PROJECT_ROOT="+wd)
			}
			output, err := cmd.CombinedOutput()
			if err != nil {
				return &Result{
					Content: string(output) + "\n" + err.Error(),
					IsError: true,
				}, nil
			}
			return &Result{Content: string(output)}, nil
		}},
		Source: "builtin",
	}
}

// --- Bash safety checks ---

func looksLikeWriteFilePayload(command string) bool {
	trimmed := strings.TrimSpace(command)
	if trimmed == "" {
		return false
	}

	lower := strings.ToLower(trimmed)
	if strings.HasPrefix(lower, "{") && strings.Contains(lower, `"path"`) && strings.Contains(lower, `"content"`) {
		return true
	}

	lines := strings.Split(lower, "\n")
	hasPath := false
	hasContent := false
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "path:") {
			hasPath = true
		}
		if strings.HasPrefix(line, "content:") {
			hasContent = true
		}
	}
	return hasPath && hasContent
}

func looksLikeLongRunningDevServerCommand(command string) bool {
	lower := strings.ToLower(strings.TrimSpace(command))
	if lower == "" {
		return false
	}

	patterns := []string{
		"npm run dev",
		"npm start",
		"pnpm dev",
		"yarn dev",
		"bun dev",
		"npx vite",
		"vite --host",
		"vite --port",
		"vite dev",
		"vite serve",
		"next dev",
		"next start",
		"nuxt dev",
		"nuxi dev",
		"rails server",
		"bin/rails server",
		"flutter run",
		"cargo tauri dev",
		"python -m http.server",
		"python3 -m http.server",
		"live-server",
		"http-server",
		"serve ",
	}
	// Also catch backgrounded commands (&) that try to sneak past
	if strings.Contains(lower, "& echo") || strings.HasSuffix(strings.TrimSpace(lower), "&") {
		for _, srv := range []string{"vite", "next", "nuxt", "serve", "http-server", "live-server", "flask", "uvicorn", "rails"} {
			if strings.Contains(lower, srv) {
				return true
			}
		}
	}
	for _, pattern := range patterns {
		if strings.Contains(lower, pattern) {
			return true
		}
	}
	return false
}
