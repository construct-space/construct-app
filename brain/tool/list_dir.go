package tool

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

// ListDir is the cheap "what's in this folder" tool. Glob handles
// recursive searches; ListDir is for orientation — single level, no
// pattern. Operator parity.
type ListDir struct{}

func (ListDir) Name() string { return "list_dir" }

func (ListDir) Description() string {
	return "List the immediate contents of a directory. Cheap orientation tool — use glob when you need recursion or patterns."
}

func (ListDir) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"path": map[string]any{
				"type":        "string",
				"description": "Directory path. Defaults to the current working directory.",
			},
		},
	}
}

func (ListDir) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		Path string `json:"path"`
	}
	_ = json.Unmarshal(raw, &in)
	dir := in.Path
	if dir == "" {
		dir = Cwd(ctx)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", err
	}
	var lines []string
	for _, e := range entries {
		prefix := "  "
		if e.IsDir() {
			prefix = "📁"
		}
		lines = append(lines, fmt.Sprintf("%s %s", prefix, e.Name()))
	}
	if len(lines) == 0 {
		return "(empty)", nil
	}
	return strings.Join(lines, "\n"), nil
}
