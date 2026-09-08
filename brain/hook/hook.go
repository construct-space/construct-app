// Package hook runs user-defined shell snippets around tool calls.
// Format is intentionally identical to operator's: a JSON file with a
// "hooks" array, each entry naming a `tools` list and a `command` shell
// script. The command sees the tool input via $TOOL_INPUT and signals
// blocking decisions on stdout as a single JSON line:
//
//	{"block": true, "message": "why this was blocked"}
//
// Anything else is logged and treated as no-op. Hook source files live
// next to space skills: <space>/agent/hooks/*.json.
package hook

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// Hook is one rule loaded from a JSON file.
type Hook struct {
	ID      string   `json:"id"`
	Type    string   `json:"type"`    // "pre_tool" | "post_tool"
	Tools   []string `json:"tools"`   // tool names this applies to; empty = all
	Command string   `json:"command"` // sh -c body; sees $TOOL_INPUT, $TOOL_NAME
	Source  string   `json:"source"`  // free-form provenance label
}

// Decision is what a hook returned.
type Decision struct {
	Block   bool   `json:"block"`
	Message string `json:"message"`
}

// Set is a loaded hook collection.
type Set struct {
	pre  []Hook
	post []Hook
}

func NewSet() *Set { return &Set{} }

// LoadDir reads every <dir>/*.json file and merges hooks into the set.
// Returns the number of hooks loaded from this dir (for boot logging).
func (s *Set) LoadDir(dir string) (int, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, nil
		}
		return 0, err
	}
	count := 0
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasSuffix(name, ".json") {
			continue
		}
		// Skip macOS resource-fork artifacts (e.g. "._safety.json").
		if strings.HasPrefix(name, "._") {
			continue
		}
		body, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			fmt.Fprintf(os.Stderr, "[hook] read %s: %v\n", e.Name(), err)
			continue
		}
		var file struct {
			Hooks []Hook `json:"hooks"`
		}
		if err := json.Unmarshal(body, &file); err != nil {
			fmt.Fprintf(os.Stderr, "[hook] parse %s: %v\n", e.Name(), err)
			continue
		}
		for _, h := range file.Hooks {
			if h.Command == "" {
				continue
			}
			switch h.Type {
			case "pre_tool":
				s.pre = append(s.pre, h)
				count++
			case "post_tool":
				s.post = append(s.post, h)
				count++
			}
		}
	}
	return count, nil
}

// Pre runs every pre_tool hook matching toolName. Returns the first
// blocking decision, or Decision{} if all hooks allow.
func (s *Set) Pre(ctx context.Context, toolName string, input json.RawMessage) Decision {
	for _, h := range s.pre {
		if !matches(h.Tools, toolName) {
			continue
		}
		d := run(ctx, h, toolName, input)
		if d.Block {
			return d
		}
	}
	return Decision{}
}

// Post runs every post_tool hook matching toolName. Block isn't meaningful
// for post hooks (the call already happened) but the hook can still log or
// trigger side effects.
func (s *Set) Post(ctx context.Context, toolName string, input json.RawMessage) {
	for _, h := range s.post {
		if !matches(h.Tools, toolName) {
			continue
		}
		_ = run(ctx, h, toolName, input)
	}
}

func matches(tools []string, name string) bool {
	if len(tools) == 0 {
		return true
	}
	for _, t := range tools {
		if t == name {
			return true
		}
	}
	return false
}

func run(parent context.Context, h Hook, toolName string, input json.RawMessage) Decision {
	ctx, cancel := context.WithTimeout(parent, 5*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "sh", "-c", h.Command)
	cmd.Env = append(os.Environ(),
		"TOOL_NAME="+toolName,
		"TOOL_INPUT="+string(input),
	)
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	if err := cmd.Run(); err != nil {
		// A hook that errored doesn't block; we log and continue.
		fmt.Fprintf(os.Stderr, "[hook] %s: %v: %s\n", h.ID, err, out.String())
		return Decision{}
	}
	body := strings.TrimSpace(out.String())
	if body == "" {
		return Decision{}
	}
	// Hooks may print logs before the JSON line; parse the last non-blank line.
	last := lastJSONLine(body)
	if last == "" {
		return Decision{}
	}
	var d Decision
	if err := json.Unmarshal([]byte(last), &d); err != nil {
		fmt.Fprintf(os.Stderr, "[hook] %s: bad JSON: %v: %s\n", h.ID, err, last)
		return Decision{}
	}
	return d
}

func lastJSONLine(body string) string {
	lines := strings.Split(body, "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		t := strings.TrimSpace(lines[i])
		if strings.HasPrefix(t, "{") && strings.HasSuffix(t, "}") {
			return t
		}
	}
	return ""
}
