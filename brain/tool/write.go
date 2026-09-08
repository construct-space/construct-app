package tool

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type Write struct{}

func (Write) Name() string { return "write" }

func (Write) Description() string {
	return "Write a file to disk, creating it if it doesn't exist and overwriting if it does. Creates parent directories as needed."
}

func (Write) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"path": map[string]any{
				"type":        "string",
				"description": "Absolute path to the file.",
			},
			"content": map[string]any{
				"type":        "string",
				"description": "Full file contents.",
			},
		},
		"required": []string{"path", "content"},
	}
}

func (Write) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fmt.Errorf("invalid input: %w", err)
	}
	if in.Path == "" {
		return "", fmt.Errorf("path is required")
	}
	// Discipline: overwriting an existing file the model hasn't read is
	// almost always a mistake. Creating a new file is fine — the check
	// short-circuits if the path doesn't exist yet.
	if reason := CheckReadBeforeWrite(ctx, in.Path); reason != "" {
		return "", fmt.Errorf("%s: %s", in.Path, reason)
	}
	if err := os.MkdirAll(filepath.Dir(in.Path), 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(in.Path, []byte(in.Content), 0o644); err != nil {
		return "", err
	}
	MarkWritten(ctx, in.Path)
	return fmt.Sprintf("wrote %d bytes to %s", len(in.Content), in.Path), nil
}
