package provider

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// DebugLogger wraps any Provider and writes one JSONL record per
// completion request: the full Request (system, messages, tools) and a
// summary of the stream (text chunks concatenated, tool calls emitted,
// stop_reason, usage). Lets you see *exactly* what brain is feeding the
// model and what comes back.
//
// Output: one file per brain process at ~/ConstructLogs/log_<datetime>.jsonl.
// Set CONSTRUCT_BRAIN_DEBUG=0 to disable. The logsDir argument is kept
// in the signature for callers that might want to override the location
// later but is currently ignored.
type DebugLogger struct {
	Inner Provider
	w     *debugWriter
}

// BuildDebugLogger returns inner wrapped with a DebugLogger unless
// disabled by CONSTRUCT_BRAIN_DEBUG=0. logsDir is currently unused —
// logs always land in ~/ConstructLogs/log_<datetime>.jsonl (one file per
// brain process). Kept in the signature so we can swap behavior later
// without churning callers.
func BuildDebugLogger(inner Provider, _ string) Provider {
	if os.Getenv("CONSTRUCT_BRAIN_DEBUG") == "0" {
		return inner
	}
	w, err := getProcessDebugWriter()
	if err != nil {
		fmt.Fprintf(os.Stderr, "[brain] debug log disabled: %v\n", err)
		return inner
	}
	return &DebugLogger{Inner: inner, w: w}
}

// processDebugWriter is a single writer shared by every wrapped provider
// in this brain process, so multi-provider runs all land in one file.
var (
	processDebugWriter     *debugWriter
	processDebugWriterErr  error
	processDebugWriterOnce sync.Once
)

func getProcessDebugWriter() (*debugWriter, error) {
	processDebugWriterOnce.Do(func() {
		home, err := os.UserHomeDir()
		if err != nil {
			processDebugWriterErr = err
			return
		}
		dir := filepath.Join(home, "ConstructLogs")
		pruneOldDebugLogs(dir, 7*24*time.Hour)
		stamp := time.Now().Format("2006-01-02_15-04-05")
		processDebugWriter, processDebugWriterErr = newDebugWriter(dir, fmt.Sprintf("log_%s.jsonl", stamp))
		if processDebugWriterErr == nil {
			fmt.Fprintf(os.Stderr, "[brain] debug log → %s\n", processDebugWriter.path)
		}
	})
	return processDebugWriter, processDebugWriterErr
}

// pruneOldDebugLogs deletes log_*.jsonl files older than maxAge. These
// logs hold full plaintext conversations and grew unboundedly — a heavy
// user accumulated gigabytes across months of brain processes.
func pruneOldDebugLogs(dir string, maxAge time.Duration) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	cutoff := time.Now().Add(-maxAge)
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasPrefix(name, "log_") || !strings.HasSuffix(name, ".jsonl") {
			continue
		}
		info, err := e.Info()
		if err != nil || info.ModTime().After(cutoff) {
			continue
		}
		_ = os.Remove(filepath.Join(dir, name))
	}
}

func (d *DebugLogger) Name() string { return d.Inner.Name() }

func (d *DebugLogger) Stream(ctx context.Context, req Request, emit func(Event)) error {
	id := nextDebugID()
	d.w.logRequest(id, d.Inner.Name(), req)

	var (
		textOut    strings.Builder
		toolCalls  []map[string]any
		stopReason string
		usage      Usage
	)
	wrappedEmit := func(ev Event) {
		switch ev.Type {
		case "text_delta":
			textOut.WriteString(ev.TextDelta)
		case "tool_use_start":
			toolCalls = append(toolCalls, map[string]any{
				"id":    ev.ToolUseID,
				"name":  ev.ToolName,
				"input": "",
			})
		case "tool_use_input_delta":
			if n := len(toolCalls); n > 0 {
				prev, _ := toolCalls[n-1]["input"].(string)
				toolCalls[n-1]["input"] = prev + ev.InputDelta
			}
		case "stop":
			stopReason = ev.StopReason
		case "usage":
			usage = ev.Usage
		}
		emit(ev)
	}

	err := d.Inner.Stream(ctx, req, wrappedEmit)
	d.w.logResponse(id, textOut.String(), toolCalls, stopReason, usage, err)
	return err
}

// ── implementation ──────────────────────────────────────────────────

var debugSeq uint64

func nextDebugID() string {
	n := atomic.AddUint64(&debugSeq, 1)
	return fmt.Sprintf("%d-%d", time.Now().UnixMilli(), n)
}

type debugWriter struct {
	path string
	mu   sync.Mutex
	f    *os.File
}

func newDebugWriter(logsDir, filename string) (*debugWriter, error) {
	if err := os.MkdirAll(logsDir, 0o755); err != nil {
		return nil, fmt.Errorf("mkdir %s: %w", logsDir, err)
	}
	path := filepath.Join(logsDir, filename)
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	return &debugWriter{path: path, f: f}, nil
}

// logRequest emits one JSON line describing the outgoing request. The
// envelope is intentionally flat (no nesting under "request") so jq-style
// inspection stays easy: `jq 'select(.kind=="request") | .system' file`.
func (w *debugWriter) logRequest(id, providerName string, req Request) {
	rec := map[string]any{
		"ts":       time.Now().Format(time.RFC3339Nano),
		"id":       id,
		"kind":     "request",
		"provider": providerName,
		"model":    req.Model,
		"system":   req.System,
		"messages": dumpMessages(req.Messages),
		"tools":    summarizeTools(req.Tools),
		"caps":     req.CapFlags,
	}
	w.write(rec)
}

func (w *debugWriter) logResponse(id, text string, toolCalls []map[string]any, stop string, usage Usage, streamErr error) {
	rec := map[string]any{
		"ts":          time.Now().Format(time.RFC3339Nano),
		"id":          id,
		"kind":        "response",
		"text":        text,
		"tool_calls":  toolCalls,
		"stop_reason": stop,
		"usage":       usage,
	}
	if streamErr != nil {
		rec["error"] = streamErr.Error()
	}
	w.write(rec)
}

func (w *debugWriter) write(rec map[string]any) {
	b, err := json.Marshal(rec)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[brain] debug log marshal: %v\n", err)
		return
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	w.f.Write(b)
	w.f.Write([]byte("\n"))
}

// dumpMessages flattens the Message/Block tree so tool_use / tool_result
// blocks appear in the log. provider.Block hides those via json:"-" so a
// naive json.Marshal would lose them entirely.
func dumpMessages(msgs []Message) []map[string]any {
	out := make([]map[string]any, 0, len(msgs))
	for _, m := range msgs {
		blocks := make([]map[string]any, 0, len(m.Content))
		for _, b := range m.Content {
			block := map[string]any{"type": b.Type}
			switch b.Type {
			case "text":
				block["text"] = b.Text
			case "tool_use":
				if b.ToolUse != nil {
					block["id"] = b.ToolUse.ID
					block["name"] = b.ToolUse.Name
					block["input"] = b.ToolUse.Input
				}
			case "tool_result":
				if b.ToolResult != nil {
					block["tool_use_id"] = b.ToolResult.ToolUseID
					block["content"] = b.ToolResult.Content
					block["is_error"] = b.ToolResult.IsError
				}
			default:
				// Unknown block type — keep the raw text field if present.
				if b.Text != "" {
					block["text"] = b.Text
				}
			}
			blocks = append(blocks, block)
		}
		out = append(out, map[string]any{
			"role":    m.Role,
			"content": blocks,
		})
	}
	return out
}

// summarizeTools keeps the schema visible but trims it down so the log
// is greppable. Full schema would dominate the line in a 20-tool turn.
func summarizeTools(tools []Tool) []map[string]any {
	out := make([]map[string]any, 0, len(tools))
	for _, t := range tools {
		out = append(out, map[string]any{
			"name":         t.Name,
			"description":  t.Description,
			"input_schema": t.InputSchema,
		})
	}
	return out
}
