package tool

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"

	"construct-operator/internal/provider"
)

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
