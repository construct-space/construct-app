package tool

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
)

// gitCmd shells out to `git` in the caller's CWD. Mirrors operator's
// behavior — caller provides args, we return CombinedOutput as a string
// so model sees both stdout + stderr (git uses stderr for progress).
func gitCmd(ctx context.Context, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = Cwd(ctx)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return string(out), fmt.Errorf("%s: %s", err, strings.TrimSpace(string(out)))
	}
	return string(out), nil
}

// GitStatus — show working tree status. Porcelain v1 with branch line so
// the model gets a stable, parseable format instead of locale-dependent
// human output.
type GitStatus struct{}

func (GitStatus) Name() string { return "git_status" }

func (GitStatus) Description() string {
	return "Show working tree status (porcelain). Returns staged, unstaged, and untracked files plus the current branch."
}

func (GitStatus) InputSchema() map[string]any {
	return map[string]any{"type": "object", "properties": map[string]any{}}
}

func (GitStatus) Execute(ctx context.Context, _ json.RawMessage) (string, error) {
	out, err := gitCmd(ctx, "status", "--porcelain=v1", "-b")
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(out) == "" {
		return "Working tree clean", nil
	}
	return out, nil
}

// GitDiff — unified diff. Three modes: unstaged (default), staged, or
// against a ref. Capped at 30K chars so giant refactors don't blow the
// context window.
type GitDiff struct{}

func (GitDiff) Name() string { return "git_diff" }

func (GitDiff) Description() string {
	return "Show a unified diff. `target` empty = unstaged, 'staged' = index vs HEAD, a ref/path = compare. Output truncated at 30K chars."
}

func (GitDiff) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"target": map[string]any{
				"type":        "string",
				"description": "Empty for unstaged, 'staged' for index, a commit/branch/tag, or a path",
			},
		},
	}
}

func (GitDiff) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		Target string `json:"target"`
	}
	_ = json.Unmarshal(raw, &in)
	var args []string
	switch {
	case in.Target == "":
		args = []string{"diff"}
	case in.Target == "staged" || in.Target == "cached":
		args = []string{"diff", "--cached"}
	case strings.Contains(in.Target, "/") || strings.Contains(in.Target, "."):
		args = []string{"diff", "--", in.Target}
	default:
		args = []string{"diff", in.Target}
	}
	out, err := gitCmd(ctx, args...)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(out) == "" {
		return "No differences", nil
	}
	if len(out) > 30_000 {
		out = out[:30_000] + fmt.Sprintf("\n\n[diff truncated — %d chars total]", len(out))
	}
	return out, nil
}

// GitLog — recent commits in a stable machine-readable format.
type GitLog struct{}

func (GitLog) Name() string { return "git_log" }

func (GitLog) Description() string {
	return "Show recent commit history. Returns hash, author, date, message per commit."
}

func (GitLog) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"count":  map[string]any{"type": "integer", "description": "Commits to show (default 10, max 50)"},
			"path":   map[string]any{"type": "string", "description": "Restrict to commits touching this path"},
			"branch": map[string]any{"type": "string", "description": "Branch to log (default current)"},
		},
	}
}

func (GitLog) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		Count  int    `json:"count"`
		Path   string `json:"path"`
		Branch string `json:"branch"`
	}
	_ = json.Unmarshal(raw, &in)
	if in.Count <= 0 {
		in.Count = 10
	}
	if in.Count > 50 {
		in.Count = 50
	}
	args := []string{"log", fmt.Sprintf("-n%d", in.Count), "--format=%h %aI %an <%ae>%n  %s%n"}
	if in.Branch != "" {
		args = append(args, in.Branch)
	}
	if in.Path != "" {
		args = append(args, "--", in.Path)
	}
	return gitCmd(ctx, args...)
}

// GitCommit — stage + commit in one shot. Refuses if message is empty.
// `files` empty means `git add -A` per operator's contract.
type GitCommit struct{}

func (GitCommit) Name() string { return "git_commit" }

func (GitCommit) Description() string {
	return "Stage files (or `add -A` when empty) and commit with the given message. Use this rather than chaining Bash calls."
}

func (GitCommit) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"message": map[string]any{"type": "string", "description": "Commit message"},
			"files":   map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Paths to stage; empty stages all"},
		},
		"required": []string{"message"},
	}
}

func (GitCommit) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		Message string   `json:"message"`
		Files   []string `json:"files"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fmt.Errorf("invalid input: %w", err)
	}
	if in.Message == "" {
		return "", fmt.Errorf("message is required")
	}
	if len(in.Files) > 0 {
		args := append([]string{"add", "--"}, in.Files...)
		if _, err := gitCmd(ctx, args...); err != nil {
			return "", fmt.Errorf("git add failed: %w", err)
		}
	} else {
		if _, err := gitCmd(ctx, "add", "-A"); err != nil {
			return "", fmt.Errorf("git add failed: %w", err)
		}
	}
	out, err := gitCmd(ctx, "commit", "-m", in.Message)
	if err != nil {
		if strings.Contains(err.Error(), "nothing to commit") {
			return "Nothing to commit — working tree clean", nil
		}
		return "", err
	}
	return out, nil
}

// GitBranch — list / create / switch. One tool with an action enum so
// the model doesn't need three separate descriptors. Push is intentionally
// excluded — it's an external action that should go through Bash so the
// user sees it explicitly in the tool log.
type GitBranch struct{}

func (GitBranch) Name() string { return "git_branch" }

func (GitBranch) Description() string {
	return "List, create, or switch branches. Push/delete are not exposed — use bash for those so they show up clearly in the action log."
}

func (GitBranch) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"action": map[string]any{"type": "string", "enum": []string{"list", "create", "switch"}},
			"name":   map[string]any{"type": "string", "description": "Branch name (required for create/switch)"},
		},
		"required": []string{"action"},
	}
}

func (GitBranch) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		Action string `json:"action"`
		Name   string `json:"name"`
	}
	_ = json.Unmarshal(raw, &in)
	switch in.Action {
	case "list":
		out, err := gitCmd(ctx, "branch", "-a", "--format=%(refname:short) %(objectname:short) %(subject)")
		if err != nil {
			return "", err
		}
		current, _ := gitCmd(ctx, "rev-parse", "--abbrev-ref", "HEAD")
		return fmt.Sprintf("Current: %s\n\n%s", strings.TrimSpace(current), out), nil
	case "create":
		if in.Name == "" {
			return "", fmt.Errorf("name is required")
		}
		if _, err := gitCmd(ctx, "checkout", "-b", in.Name); err != nil {
			return "", err
		}
		return fmt.Sprintf("Created and switched to %q", in.Name), nil
	case "switch":
		if in.Name == "" {
			return "", fmt.Errorf("name is required")
		}
		if _, err := gitCmd(ctx, "checkout", in.Name); err != nil {
			return "", err
		}
		return fmt.Sprintf("Switched to %q", in.Name), nil
	}
	return "", fmt.Errorf("unknown action: %s", in.Action)
}
