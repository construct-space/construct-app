package tool

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"construct-operator/internal/provider"
)

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
