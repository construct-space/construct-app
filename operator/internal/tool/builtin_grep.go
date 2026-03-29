package tool

import (
	"context"
	"encoding/json"
	"os/exec"

	"construct-operator/internal/provider"
)

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
				guarded, pathErr := guardPath(wd, args.Path)
				if pathErr != nil {
					return &Result{Content: pathErr.Error(), IsError: true}, nil
				}
				searchPath = guarded
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
