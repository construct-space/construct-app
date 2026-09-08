// Package telemetry persists per-turn usage records as JSONL. Operator
// uses SQLite for per-day rollups + a periodic sync to the central
// /api/telemetry endpoint; brain v0 writes raw events and leaves
// aggregation to the server (or to a later step). One file per day
// keeps individual files manageable without daily rotation logic.
package telemetry

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Event is one record. Type discriminates: "turn" for a model call,
// "tool_call" for a tool execution, "error" for a failure.
type Event struct {
	Type      string    `json:"type"`
	Time      time.Time `json:"ts"`
	UserID    string    `json:"user_id,omitempty"`
	SessionID string    `json:"session_id,omitempty"`
	Model     string    `json:"model,omitempty"`
	Provider  string    `json:"provider,omitempty"`

	// Turn fields
	InputTokens  int     `json:"input_tokens,omitempty"`
	OutputTokens int     `json:"output_tokens,omitempty"`
	CacheRead    int     `json:"cache_read,omitempty"`
	CacheWrite   int     `json:"cache_write,omitempty"`
	DurationMs   int64   `json:"duration_ms,omitempty"`
	StopReason   string  `json:"stop_reason,omitempty"`
	CostUSD      float64 `json:"cost_usd,omitempty"`

	// Tool-call fields
	ToolName string `json:"tool_name,omitempty"`
	IsError  bool   `json:"is_error,omitempty"`

	// Error fields
	Error string `json:"error,omitempty"`
}

// Sink writes events to JSONL files at <dir>/YYYY-MM-DD.jsonl. Thread-safe.
// Errors during write are logged to stderr but never block the agent loop —
// telemetry should never break a real user interaction.
type Sink struct {
	dir string
	mu  sync.Mutex
}

func NewSink(dir string) *Sink { return &Sink{dir: dir} }

// Record appends one event. Failure is logged, not returned.
func (s *Sink) Record(e Event) {
	if e.Time.IsZero() {
		e.Time = time.Now()
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		fmt.Fprintf(os.Stderr, "[telemetry] mkdir: %v\n", err)
		return
	}
	path := filepath.Join(s.dir, e.Time.Format("2006-01-02")+".jsonl")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[telemetry] open: %v\n", err)
		return
	}
	defer f.Close()
	body, err := json.Marshal(e)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[telemetry] marshal: %v\n", err)
		return
	}
	body = append(body, '\n')
	if _, err := f.Write(body); err != nil {
		fmt.Fprintf(os.Stderr, "[telemetry] write: %v\n", err)
	}
}
