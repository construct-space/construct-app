package tool

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
)

type Read struct{}

func (Read) Name() string { return "read" }

func (Read) Description() string {
	return "Read a file from disk. Returns the file contents as a string. Use for source files, config, skill markdown, anything text-based."
}

func (Read) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"path": map[string]any{
				"type":        "string",
				"description": "Absolute path to the file.",
			},
		},
		"required": []string{"path"},
	}
}

func (Read) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		Path string `json:"path"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fmt.Errorf("invalid input: %w", err)
	}
	if in.Path == "" {
		return "", fmt.Errorf("path is required")
	}
	b, err := os.ReadFile(in.Path)
	if err != nil {
		return "", err
	}
	// Track the read so Edit/Write can enforce read-before-write within
	// this session. Captures mtime/size; if the file changes on disk
	// before Edit runs, the gate will require a fresh read.
	MarkRead(ctx, in.Path)
	return string(b), nil
}
