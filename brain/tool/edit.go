package tool

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

type Edit struct{}

func (Edit) Name() string { return "edit" }

func (Edit) Description() string {
	return "Replace one exact substring in a file. Fails if 'old' is not found, or if it appears more than once. Use a larger surrounding window in 'old' to disambiguate."
}

func (Edit) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"path": map[string]any{
				"type":        "string",
				"description": "Absolute path to the file.",
			},
			"old": map[string]any{
				"type":        "string",
				"description": "Exact substring to replace. Must occur exactly once.",
			},
			"new": map[string]any{
				"type":        "string",
				"description": "Replacement text.",
			},
		},
		"required": []string{"path", "old", "new"},
	}
}

func (Edit) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		Path string `json:"path"`
		Old  string `json:"old"`
		New  string `json:"new"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fmt.Errorf("invalid input: %w", err)
	}
	if in.Path == "" || in.Old == "" {
		return "", fmt.Errorf("path and old are required")
	}
	// Discipline: refuse to edit a file the model hasn't read in this
	// session, or one that's changed on disk since the read. Prevents
	// surgical edits against stale assumptions.
	if reason := CheckReadBeforeWrite(ctx, in.Path); reason != "" {
		return "", fmt.Errorf("%s: %s", in.Path, reason)
	}
	b, err := os.ReadFile(in.Path)
	if err != nil {
		return "", err
	}
	src := string(b)
	count := strings.Count(src, in.Old)
	if count == 0 {
		return "", fmt.Errorf("old substring not found in %s", in.Path)
	}
	if count > 1 {
		return "", fmt.Errorf("old substring appears %d times in %s; widen the window", count, in.Path)
	}
	out := strings.Replace(src, in.Old, in.New, 1)
	if err := os.WriteFile(in.Path, []byte(out), 0o644); err != nil {
		return "", err
	}
	MarkWritten(ctx, in.Path)
	return fmt.Sprintf("edited %s (%d → %d bytes)", in.Path, len(src), len(out)), nil
}
