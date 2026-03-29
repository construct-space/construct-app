package tool

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"construct-operator/internal/provider"
)

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
				guarded, pathErr := guardPath(wd, args.Path)
				if pathErr != nil {
					return &Result{Content: pathErr.Error(), IsError: true}, nil
				}
				dir = guarded
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
