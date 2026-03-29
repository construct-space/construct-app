package tool

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"construct-operator/internal/provider"
)

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
