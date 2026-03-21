package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDefault(t *testing.T) {
	cfg := Default()
	if cfg.Port != PortOperator {
		t.Fatalf("expected port %d, got %d", PortOperator, cfg.Port)
	}
	if cfg.DefaultModel != "claude-sonnet-4-6" {
		t.Fatalf("expected default model claude-sonnet-4-6, got %q", cfg.DefaultModel)
	}
	if cfg.LogLevel != "info" {
		t.Fatalf("expected log level info, got %q", cfg.LogLevel)
	}
	if cfg.HookTimeout != 30 {
		t.Fatalf("expected hook timeout 30, got %d", cfg.HookTimeout)
	}
	if cfg.MaxSessions != 100 {
		t.Fatalf("expected max sessions 100, got %d", cfg.MaxSessions)
	}
	if cfg.RetryMax != 3 {
		t.Fatalf("expected retry max 3, got %d", cfg.RetryMax)
	}
	if cfg.Providers == nil {
		t.Fatal("providers map should not be nil")
	}
}

func TestLoadBasic(t *testing.T) {
	content := `# Construct Operator Config
port = 8080
work_dir = "/tmp/operator"
default_model = "claude-opus-4-6"
log_level = "debug"
log_dir = "/var/log/operator"
hook_timeout = 60
max_sessions = 50
retry_max = 5

[providers]
anthropic = sk-ant-abc123
deepseek = sk-ds-xyz789
`
	path := writeTemp(t, content)
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}

	if cfg.Port != 8080 {
		t.Fatalf("port: expected 8080, got %d", cfg.Port)
	}
	if cfg.WorkDir != "/tmp/operator" {
		t.Fatalf("work_dir: expected /tmp/operator, got %q", cfg.WorkDir)
	}
	if cfg.DefaultModel != "claude-opus-4-6" {
		t.Fatalf("default_model: expected claude-opus-4-6, got %q", cfg.DefaultModel)
	}
	if cfg.LogLevel != "debug" {
		t.Fatalf("log_level: expected debug, got %q", cfg.LogLevel)
	}
	if cfg.LogDir != "/var/log/operator" {
		t.Fatalf("log_dir: expected /var/log/operator, got %q", cfg.LogDir)
	}
	if cfg.HookTimeout != 60 {
		t.Fatalf("hook_timeout: expected 60, got %d", cfg.HookTimeout)
	}
	if cfg.MaxSessions != 50 {
		t.Fatalf("max_sessions: expected 50, got %d", cfg.MaxSessions)
	}
	if cfg.RetryMax != 5 {
		t.Fatalf("retry_max: expected 5, got %d", cfg.RetryMax)
	}

	if cfg.Providers["anthropic"] != "sk-ant-abc123" {
		t.Fatalf("provider anthropic: expected sk-ant-abc123, got %q", cfg.Providers["anthropic"])
	}
	if cfg.Providers["deepseek"] != "sk-ds-xyz789" {
		t.Fatalf("provider deepseek: expected sk-ds-xyz789, got %q", cfg.Providers["deepseek"])
	}
}

func TestLoadQuotedValues(t *testing.T) {
	content := `work_dir = "/path with spaces/work"
default_model = "claude-sonnet-4-6"
`
	path := writeTemp(t, content)
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.WorkDir != "/path with spaces/work" {
		t.Fatalf("expected quoted path, got %q", cfg.WorkDir)
	}
}

func TestLoadComments(t *testing.T) {
	content := `# This is a comment
port = 9090
# Another comment
`
	path := writeTemp(t, content)
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Port != 9090 {
		t.Fatalf("expected port 9090, got %d", cfg.Port)
	}
}

func TestLoadEmptyFile(t *testing.T) {
	path := writeTemp(t, "")
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	// Should return defaults.
	def := Default()
	if cfg.Port != def.Port {
		t.Fatalf("empty file should return default port %d, got %d", def.Port, cfg.Port)
	}
}

func TestLoadMissingFile(t *testing.T) {
	_, err := Load("/nonexistent/config.toml")
	if err == nil {
		t.Fatal("expected error for missing file")
	}
}

func TestLoadBadPort(t *testing.T) {
	content := `port = notanumber`
	path := writeTemp(t, content)
	_, err := Load(path)
	if err == nil {
		t.Fatal("expected error for non-integer port")
	}
}

func TestLoadUnknownKey(t *testing.T) {
	content := `bogus_key = whatever`
	path := writeTemp(t, content)
	_, err := Load(path)
	if err == nil {
		t.Fatal("expected error for unknown top-level key")
	}
}

func TestLoadUnknownKeyInSection(t *testing.T) {
	// Unknown keys inside a named section should be accepted (forward compat).
	content := `[future_section]
new_key = new_value
`
	path := writeTemp(t, content)
	_, err := Load(path)
	if err != nil {
		t.Fatalf("unknown key in section should be accepted: %v", err)
	}
}

func TestLoadBadSyntax(t *testing.T) {
	content := `this line has no equals sign`
	path := writeTemp(t, content)
	_, err := Load(path)
	if err == nil {
		t.Fatal("expected error for bad syntax")
	}
}

func TestLoadMinimal(t *testing.T) {
	// Only set port — everything else should be defaults.
	content := `port = 4000`
	path := writeTemp(t, content)
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Port != 4000 {
		t.Fatalf("expected port 4000, got %d", cfg.Port)
	}
	if cfg.DefaultModel != "claude-sonnet-4-6" {
		t.Fatalf("expected default model from defaults, got %q", cfg.DefaultModel)
	}
}

func writeTemp(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "test.conf")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}
