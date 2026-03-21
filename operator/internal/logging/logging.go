// Package logging provides structured JSON logging with daily file rotation.
package logging

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Level represents a log severity level.
type Level int

const (
	LevelDebug Level = iota
	LevelInfo
	LevelWarn
	LevelError
)

// String returns the lowercase name for the level.
func (l Level) String() string {
	switch l {
	case LevelDebug:
		return "debug"
	case LevelInfo:
		return "info"
	case LevelWarn:
		return "warn"
	case LevelError:
		return "error"
	default:
		return "unknown"
	}
}

// ParseLevel converts a string to a Level.
func ParseLevel(s string) Level {
	switch s {
	case "debug":
		return LevelDebug
	case "info":
		return LevelInfo
	case "warn":
		return LevelWarn
	case "error":
		return LevelError
	default:
		return LevelInfo
	}
}

// entry is a single log line serialised as JSON.
type entry struct {
	Time  string `json:"time"`
	Level string `json:"level"`
	Msg   string `json:"msg"`
	// Extra fields are added dynamically via json.Marshal of a map.
}

// Logger writes structured JSON log lines to daily-rotated files.
type Logger struct {
	mu       sync.Mutex
	dir      string
	minLevel Level
	curDate  string   // "2006-01-02" of the currently-open file
	file     *os.File // nil until first write
}

// NewLogger creates a Logger that writes to {dir}/operator-{date}.log.
// The directory is created if it does not exist.
func NewLogger(dir string, level Level) (*Logger, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("logging: create dir: %w", err)
	}
	return &Logger{dir: dir, minLevel: level}, nil
}

// Log writes a structured log entry at the given level.
// Fields are key-value pairs (e.g. "user", "alice", "count", 42).
// Odd-length fields lists silently drop the dangling key.
func (l *Logger) Log(level Level, msg string, fields ...any) {
	if level < l.minLevel {
		return
	}

	now := time.Now().UTC()

	// Build the JSON map.
	m := map[string]any{
		"time":  now.Format(time.RFC3339Nano),
		"level": level.String(),
		"msg":   msg,
	}
	for i := 0; i+1 < len(fields); i += 2 {
		key, ok := fields[i].(string)
		if !ok {
			key = fmt.Sprintf("%v", fields[i])
		}
		m[key] = fields[i+1]
	}

	data, err := json.Marshal(m)
	if err != nil {
		return // best-effort
	}
	data = append(data, '\n')

	l.mu.Lock()
	defer l.mu.Unlock()

	if err := l.ensureFile(now); err != nil {
		// Can't write to file — emit to stderr as fallback.
		fmt.Fprintf(os.Stderr, "logging: %v\n", err)
		return
	}

	l.file.Write(data)
}

// Debug logs at debug level.
func (l *Logger) Debug(msg string, fields ...any) { l.Log(LevelDebug, msg, fields...) }

// Info logs at info level.
func (l *Logger) Info(msg string, fields ...any) { l.Log(LevelInfo, msg, fields...) }

// Warn logs at warn level.
func (l *Logger) Warn(msg string, fields ...any) { l.Log(LevelWarn, msg, fields...) }

// Error logs at err level.
func (l *Logger) Error(msg string, fields ...any) { l.Log(LevelError, msg, fields...) }

// Close closes the current log file.
func (l *Logger) Close() error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.file != nil {
		err := l.file.Close()
		l.file = nil
		return err
	}
	return nil
}

// ensureFile opens (or rotates to) the correct daily log file.
// Must be called with l.mu held.
func (l *Logger) ensureFile(now time.Time) error {
	date := now.Format("2006-01-02")
	if l.file != nil && l.curDate == date {
		return nil // already on the right file
	}

	// Close previous file if rotating.
	if l.file != nil {
		l.file.Close()
		l.file = nil
	}

	name := filepath.Join(l.dir, fmt.Sprintf("operator-%s.log", date))
	f, err := os.OpenFile(name, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	l.file = f
	l.curDate = date
	return nil
}

// LogPath returns the path to the log file that would be used right now.
func (l *Logger) LogPath() string {
	date := time.Now().UTC().Format("2006-01-02")
	return filepath.Join(l.dir, fmt.Sprintf("operator-%s.log", date))
}
