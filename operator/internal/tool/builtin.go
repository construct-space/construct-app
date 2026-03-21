// Built-in tools — the core tools that make agents useful.
// Same philosophy as Claude Code: Read, Write, Edit, Bash, Glob, Grep, Agent.
// These are the hands and eyes of the LLM.
package tool

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"construct-operator/internal/provider"
)

// WorkDirFunc returns the current working directory for tools.
// This is called on every tool execution so tools always use the active project root.
type WorkDirFunc func(context.Context) string

// RegisterBuiltins adds all built-in tools to the registry.
// getWorkDir is called on every tool invocation to resolve the current project directory.
func RegisterBuiltins(r *Registry, getWorkDir WorkDirFunc) {
	r.Register(readFileTool(getWorkDir))
	r.Register(writeFileTool(getWorkDir))
	r.Register(editFileTool(getWorkDir))
	r.Register(bashTool(getWorkDir))
	r.Register(globTool(getWorkDir))
	r.Register(grepTool(getWorkDir))
	r.Register(listDirTool(getWorkDir))
}

// --- Read File ---

func readFileTool(getWorkDir WorkDirFunc) *Tool {
	return &Tool{
		Def: provider.ToolDef{
			Name:        "read_file",
			Description: "Read the contents of a file. Returns the file content with line numbers.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"path": map[string]any{
						"type":        "string",
						"description": "File path (relative to project root or absolute)",
					},
				},
				"required": []string{"path"},
			},
		},
		Executor: &funcExecutor{fn: func(ctx context.Context, input string) (*Result, error) {
			var args struct {
				Path string `json:"path"`
			}
			if err := json.Unmarshal([]byte(input), &args); err != nil {
				return &Result{Content: err.Error(), IsError: true}, nil
			}
			path, pathErr := guardPath(getWorkDir(ctx), args.Path)
			if pathErr != nil {
				return &Result{Content: pathErr.Error(), IsError: true}, nil
			}
			data, err := os.ReadFile(path)
			if err != nil {
				return &Result{Content: err.Error(), IsError: true}, nil
			}
			// Add line numbers
			lines := strings.Split(string(data), "\n")
			var sb strings.Builder
			for i, line := range lines {
				fmt.Fprintf(&sb, "%4d│ %s\n", i+1, line)
			}
			return &Result{Content: sb.String()}, nil
		}},
		Source: "builtin",
	}
}

// --- Write File ---

func writeFileTool(getWorkDir WorkDirFunc) *Tool {
	return &Tool{
		Def: provider.ToolDef{
			Name:        "write_file",
			Description: "Write content to a file. Creates the file and parent directories if they don't exist.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"path": map[string]any{
						"type":        "string",
						"description": "File path (relative to project root or absolute)",
					},
					"content": map[string]any{
						"type":        "string",
						"description": "Content to write to the file",
					},
				},
				"required": []string{"path", "content"},
			},
		},
		Executor: &funcExecutor{fn: func(ctx context.Context, input string) (*Result, error) {
			var args struct {
				Path    string `json:"path"`
				Content string `json:"content"`
			}
			if err := json.Unmarshal([]byte(input), &args); err != nil {
				return &Result{Content: err.Error(), IsError: true}, nil
			}
			path, pathErr := guardPath(getWorkDir(ctx), args.Path)
			if pathErr != nil {
				return &Result{Content: pathErr.Error(), IsError: true}, nil
			}
			if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
				return &Result{Content: err.Error(), IsError: true}, nil
			}
			if err := os.WriteFile(path, []byte(args.Content), 0644); err != nil {
				return &Result{Content: err.Error(), IsError: true}, nil
			}
			return &Result{Content: fmt.Sprintf("wrote %d bytes to %s", len(args.Content), args.Path)}, nil
		}},
		Source: "builtin",
	}
}

// --- Edit File ---

func editFileTool(getWorkDir WorkDirFunc) *Tool {
	return &Tool{
		Def: provider.ToolDef{
			Name:        "edit_file",
			Description: "Edit a file by replacing an exact string match with new content.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"path": map[string]any{
						"type":        "string",
						"description": "File path",
					},
					"old_string": map[string]any{
						"type":        "string",
						"description": "The exact string to find and replace",
					},
					"new_string": map[string]any{
						"type":        "string",
						"description": "The replacement string",
					},
				},
				"required": []string{"path", "old_string", "new_string"},
			},
		},
		Executor: &funcExecutor{fn: func(ctx context.Context, input string) (*Result, error) {
			var args struct {
				Path      string `json:"path"`
				OldString string `json:"old_string"`
				NewString string `json:"new_string"`
			}
			if err := json.Unmarshal([]byte(input), &args); err != nil {
				return &Result{Content: err.Error(), IsError: true}, nil
			}
			path, pathErr := guardPath(getWorkDir(ctx), args.Path)
			if pathErr != nil {
				return &Result{Content: pathErr.Error(), IsError: true}, nil
			}
			data, err := os.ReadFile(path)
			if err != nil {
				return &Result{Content: err.Error(), IsError: true}, nil
			}
			content := string(data)
			count := strings.Count(content, args.OldString)
			if count == 0 {
				return &Result{Content: "old_string not found in file", IsError: true}, nil
			}
			if count > 1 {
				return &Result{Content: fmt.Sprintf("old_string found %d times — must be unique", count), IsError: true}, nil
			}
			newContent := strings.Replace(content, args.OldString, args.NewString, 1)
			if err := os.WriteFile(path, []byte(newContent), 0644); err != nil {
				return &Result{Content: err.Error(), IsError: true}, nil
			}
			return &Result{Content: "edit applied"}, nil
		}},
		Source: "builtin",
	}
}

// --- Bash ---

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
			cmd := exec.CommandContext(ctx, "bash", "-c", args.Command)
			if dir := existingCommandDir(getWorkDir(ctx)); dir != "" {
				cmd.Dir = dir
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

// --- Glob ---

func globTool(getWorkDir WorkDirFunc) *Tool {
	return &Tool{
		Def: provider.ToolDef{
			Name:        "glob",
			Description: "Find files matching a glob pattern. Returns matching file paths.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"pattern": map[string]any{
						"type":        "string",
						"description": "Glob pattern (e.g. '**/*.go', 'src/**/*.ts')",
					},
				},
				"required": []string{"pattern"},
			},
		},
		Executor: &funcExecutor{fn: func(ctx context.Context, input string) (*Result, error) {
			var args struct {
				Pattern string `json:"pattern"`
			}
			if err := json.Unmarshal([]byte(input), &args); err != nil {
				return &Result{Content: err.Error(), IsError: true}, nil
			}
			wd := getWorkDir(ctx)
			matches, err := filepath.Glob(filepath.Join(wd, args.Pattern))
			if err != nil {
				return &Result{Content: err.Error(), IsError: true}, nil
			}
			// Make paths relative
			var lines []string
			for _, m := range matches {
				rel, _ := filepath.Rel(wd, m)
				lines = append(lines, rel)
			}
			if len(lines) == 0 {
				return &Result{Content: "no matches"}, nil
			}
			return &Result{Content: strings.Join(lines, "\n")}, nil
		}},
		Source: "builtin",
	}
}

// --- Grep ---

func grepTool(getWorkDir WorkDirFunc) *Tool {
	return &Tool{
		Def: provider.ToolDef{
			Name:        "grep",
			Description: "Search file contents using ripgrep. Returns matching lines with file paths and line numbers.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"pattern": map[string]any{
						"type":        "string",
						"description": "Regex pattern to search for",
					},
					"path": map[string]any{
						"type":        "string",
						"description": "Directory or file to search in (default: project root)",
					},
					"glob": map[string]any{
						"type":        "string",
						"description": "Filter files by glob pattern (e.g. '*.go')",
					},
				},
				"required": []string{"pattern"},
			},
		},
		Executor: &funcExecutor{fn: func(ctx context.Context, input string) (*Result, error) {
			var args struct {
				Pattern string `json:"pattern"`
				Path    string `json:"path"`
				Glob    string `json:"glob"`
			}
			if err := json.Unmarshal([]byte(input), &args); err != nil {
				return &Result{Content: err.Error(), IsError: true}, nil
			}
			wd := getWorkDir(ctx)
			searchPath := wd
			if args.Path != "" {
				searchPath = resolvePath(wd, args.Path)
			}

			var cmd *exec.Cmd
			if _, err := exec.LookPath("rg"); err == nil {
				rgArgs := []string{"-n", "--no-heading", args.Pattern}
				if args.Glob != "" {
					rgArgs = append(rgArgs, "--glob", args.Glob)
				}
				rgArgs = append(rgArgs, searchPath)
				cmd = exec.CommandContext(ctx, "rg", rgArgs...)
			} else if _, err := exec.LookPath("grep"); err == nil {
				grepArgs := []string{"-rn"}
				if args.Glob != "" {
					grepArgs = append(grepArgs, "--include="+args.Glob)
				}
				grepArgs = append(grepArgs, args.Pattern, searchPath)
				cmd = exec.CommandContext(ctx, "grep", grepArgs...)
			} else {
				return &Result{Content: "grep unavailable: install ripgrep (rg) or grep", IsError: true}, nil
			}

			output, _ := cmd.CombinedOutput() // rg/grep returns exit 1 on no match
			result := string(output)
			if result == "" {
				return &Result{Content: "no matches"}, nil
			}
			return &Result{Content: result}, nil
		}},
		Source: "builtin",
	}
}

// --- List Directory ---

func listDirTool(getWorkDir WorkDirFunc) *Tool {
	return &Tool{
		Def: provider.ToolDef{
			Name:        "list_dir",
			Description: "List the contents of a directory.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"path": map[string]any{
						"type":        "string",
						"description": "Directory path (default: project root)",
					},
				},
			},
		},
		Executor: &funcExecutor{fn: func(ctx context.Context, input string) (*Result, error) {
			var args struct {
				Path string `json:"path"`
			}
			json.Unmarshal([]byte(input), &args)
			wd := getWorkDir(ctx)
			dir := wd
			if args.Path != "" {
				dir = resolvePath(wd, args.Path)
			}
			entries, err := os.ReadDir(dir)
			if err != nil {
				return &Result{Content: err.Error(), IsError: true}, nil
			}
			var lines []string
			for _, e := range entries {
				prefix := "  "
				if e.IsDir() {
					prefix = "📁"
				}
				lines = append(lines, fmt.Sprintf("%s %s", prefix, e.Name()))
			}
			return &Result{Content: strings.Join(lines, "\n")}, nil
		}},
		Source: "builtin",
	}
}

// --- Helpers ---

type funcExecutor struct {
	fn func(ctx context.Context, input string) (*Result, error)
}

func (f *funcExecutor) Execute(ctx context.Context, input string) (*Result, error) {
	return f.fn(ctx, input)
}

func resolvePath(workDir, path string) string {
	if filepath.IsAbs(path) {
		return path
	}
	return filepath.Join(workDir, path)
}

// guardPath ensures the resolved path is within the project directory.
// Returns the cleaned path or an error if it escapes the sandbox.
func guardPath(workDir, path string) (string, error) {
	resolved := resolvePath(workDir, path)
	cleaned := filepath.Clean(resolved)
	root := filepath.Clean(workDir)
	if root == "" {
		return cleaned, nil // no sandbox if no workdir
	}
	if !strings.HasPrefix(cleaned, root+string(filepath.Separator)) && cleaned != root {
		return "", fmt.Errorf("path %q is outside project directory %q", path, root)
	}
	return cleaned, nil
}

func existingCommandDir(workDir string) string {
	workDir = strings.TrimSpace(workDir)
	if workDir == "" {
		return ""
	}

	dir := filepath.Clean(workDir)
	for {
		info, err := os.Stat(dir)
		if err == nil && info.IsDir() {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}

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
