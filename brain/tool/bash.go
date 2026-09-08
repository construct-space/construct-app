package tool

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"time"
)

type Bash struct {
	// DefaultTimeout caps a single command. Zero falls back to
	// fallbackTimeout — an unbounded hang wedges the whole agent turn.
	DefaultTimeout time.Duration
}

// fallbackTimeout guards commands with no explicit timeout_ms and no
// configured DefaultTimeout. Generous — builds and installs are slow —
// but finite, so a credential prompt or stuck server can't hang the
// loop forever.
const fallbackTimeout = 5 * time.Minute

func (Bash) Name() string { return "bash" }

func (Bash) Description() string {
	return "Run a shell command. Use for git, package managers, build tools, CLIs, anything not file-edit. stdout and stderr come back combined; non-zero exit is reported but doesn't fail the tool call."
}

func (Bash) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"command": map[string]any{
				"type":        "string",
				"description": "Shell command (sh -c). Quote args containing spaces.",
			},
			"cwd": map[string]any{
				"type":        "string",
				"description": "Optional working directory. Defaults to brain's cwd.",
			},
			"timeout_ms": map[string]any{
				"type":        "integer",
				"description": "Per-call timeout in milliseconds (overrides default).",
			},
		},
		"required": []string{"command"},
	}
}

func (b Bash) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		Command   string `json:"command"`
		Cwd       string `json:"cwd"`
		TimeoutMs int    `json:"timeout_ms"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fmt.Errorf("invalid input: %w", err)
	}
	if in.Command == "" {
		return "", fmt.Errorf("command is required")
	}

	timeout := b.DefaultTimeout
	if timeout <= 0 {
		timeout = fallbackTimeout
	}
	if in.TimeoutMs > 0 {
		timeout = time.Duration(in.TimeoutMs) * time.Millisecond
	}
	var cancel context.CancelFunc
	ctx, cancel = context.WithTimeout(ctx, timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "sh", "-c", in.Command)
	if in.Cwd != "" {
		cmd.Dir = in.Cwd
	} else {
		cmd.Dir = Cwd(ctx)
	}
	// Run the command in its own process group and kill the GROUP on
	// cancel/timeout (Unix; Windows keeps the default kill). Command-
	// Context's default kills only `sh`; children (dev servers, package
	// managers) survived as orphans holding the stdout pipe open, so
	// Run() blocked forever even after the timeout.
	setupProcessGroup(cmd)
	// Even a killed group can leave the pipe held (e.g. a grandchild
	// double-forked into a new group) — WaitDelay forces Run to return.
	cmd.WaitDelay = 5 * time.Second
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	err := cmd.Run()
	body := out.String()
	if ctx.Err() == context.DeadlineExceeded {
		return body + "\n[timed out]", nil
	}
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return fmt.Sprintf("%s\n[exit %d]", body, exitErr.ExitCode()), nil
		}
		return body + "\n[error: " + err.Error() + "]", nil
	}
	return body, nil
}
