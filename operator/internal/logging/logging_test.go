package logging

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestParseLevel(t *testing.T) {
	tests := []struct {
		in   string
		want Level
	}{
		{"debug", LevelDebug},
		{"info", LevelInfo},
		{"warn", LevelWarn},
		{"error", LevelError},
		{"unknown", LevelInfo}, // default
		{"", LevelInfo},
	}
	for _, tt := range tests {
		got := ParseLevel(tt.in)
		if got != tt.want {
			t.Errorf("ParseLevel(%q) = %v, want %v", tt.in, got, tt.want)
		}
	}
}

func TestLevelString(t *testing.T) {
	if LevelDebug.String() != "debug" {
		t.Fatal("expected 'debug'")
	}
	if LevelInfo.String() != "info" {
		t.Fatal("expected 'info'")
	}
	if LevelWarn.String() != "warn" {
		t.Fatal("expected 'warn'")
	}
	if LevelError.String() != "error" {
		t.Fatal("expected 'error'")
	}
}

func TestLoggerWritesJSON(t *testing.T) {
	dir := t.TempDir()
	lg, err := NewLogger(dir, LevelDebug)
	if err != nil {
		t.Fatal(err)
	}
	defer lg.Close()

	lg.Info("hello world", "user", "alice", "count", 42)

	lg.Close() // flush

	// Read the log file
	date := time.Now().UTC().Format("2006-01-02")
	data, err := os.ReadFile(filepath.Join(dir, "operator-"+date+".log"))
	if err != nil {
		t.Fatal(err)
	}

	lines := strings.TrimSpace(string(data))
	if lines == "" {
		t.Fatal("log file should not be empty")
	}

	var m map[string]any
	if err := json.Unmarshal([]byte(lines), &m); err != nil {
		t.Fatalf("invalid JSON: %v\nraw: %s", err, lines)
	}

	if m["level"] != "info" {
		t.Fatalf("expected level 'info', got %v", m["level"])
	}
	if m["msg"] != "hello world" {
		t.Fatalf("expected msg 'hello world', got %v", m["msg"])
	}
	if m["user"] != "alice" {
		t.Fatalf("expected user 'alice', got %v", m["user"])
	}
	// JSON numbers decode as float64
	if m["count"] != float64(42) {
		t.Fatalf("expected count 42, got %v", m["count"])
	}
	if _, ok := m["time"]; !ok {
		t.Fatal("expected 'time' field")
	}
}

func TestLoggerFiltersLevel(t *testing.T) {
	dir := t.TempDir()
	lg, err := NewLogger(dir, LevelWarn)
	if err != nil {
		t.Fatal(err)
	}
	defer lg.Close()

	lg.Debug("should be skipped")
	lg.Info("also skipped")
	lg.Warn("this should appear")
	lg.Error("this too")

	lg.Close()

	date := time.Now().UTC().Format("2006-01-02")
	data, err := os.ReadFile(filepath.Join(dir, "operator-"+date+".log"))
	if err != nil {
		t.Fatal(err)
	}

	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) != 2 {
		t.Fatalf("expected 2 log lines (warn + error), got %d: %v", len(lines), lines)
	}
}

func TestLoggerConvenienceMethods(t *testing.T) {
	dir := t.TempDir()
	lg, err := NewLogger(dir, LevelDebug)
	if err != nil {
		t.Fatal(err)
	}
	defer lg.Close()

	lg.Debug("d")
	lg.Info("i")
	lg.Warn("w")
	lg.Error("e")

	lg.Close()

	date := time.Now().UTC().Format("2006-01-02")
	data, err := os.ReadFile(filepath.Join(dir, "operator-"+date+".log"))
	if err != nil {
		t.Fatal(err)
	}

	lines := strings.Split(strings.TrimSpace(string(data)), "\n")
	if len(lines) != 4 {
		t.Fatalf("expected 4 lines, got %d", len(lines))
	}

	expected := []string{"debug", "info", "warn", "error"}
	for i, line := range lines {
		var m map[string]any
		if err := json.Unmarshal([]byte(line), &m); err != nil {
			t.Fatalf("line %d invalid JSON: %v", i, err)
		}
		if m["level"] != expected[i] {
			t.Fatalf("line %d: expected level %q, got %v", i, expected[i], m["level"])
		}
	}
}

func TestLoggerCreatesDir(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "nested", "logs")
	lg, err := NewLogger(dir, LevelInfo)
	if err != nil {
		t.Fatal(err)
	}
	defer lg.Close()

	lg.Info("test")
	lg.Close()

	// Verify the directory was created.
	info, err := os.Stat(dir)
	if err != nil {
		t.Fatalf("directory should exist: %v", err)
	}
	if !info.IsDir() {
		t.Fatal("expected a directory")
	}
}

func TestLoggerLogPath(t *testing.T) {
	dir := t.TempDir()
	lg, err := NewLogger(dir, LevelInfo)
	if err != nil {
		t.Fatal(err)
	}
	defer lg.Close()

	path := lg.LogPath()
	date := time.Now().UTC().Format("2006-01-02")
	expected := filepath.Join(dir, "operator-"+date+".log")
	if path != expected {
		t.Fatalf("LogPath() = %q, want %q", path, expected)
	}
}

func TestLoggerOddFields(t *testing.T) {
	// Odd number of fields — the dangling key is silently dropped.
	dir := t.TempDir()
	lg, err := NewLogger(dir, LevelDebug)
	if err != nil {
		t.Fatal(err)
	}
	defer lg.Close()

	lg.Info("test", "key1", "val1", "dangling")
	lg.Close()

	date := time.Now().UTC().Format("2006-01-02")
	data, err := os.ReadFile(filepath.Join(dir, "operator-"+date+".log"))
	if err != nil {
		t.Fatal(err)
	}

	var m map[string]any
	if err := json.Unmarshal([]byte(strings.TrimSpace(string(data))), &m); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if m["key1"] != "val1" {
		t.Fatalf("expected key1=val1, got %v", m["key1"])
	}
	// dangling key should NOT be present
	if _, ok := m["dangling"]; ok {
		t.Fatal("dangling key should not appear in output")
	}
}
