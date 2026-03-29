package tool

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"construct-operator/internal/provider"
)

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
