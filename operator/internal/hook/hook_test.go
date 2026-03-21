package hook

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestRegisterAndList(t *testing.T) {
	reg := NewRegistry()
	reg.Register(Hook{ID: "h1", Type: PreTool})
	reg.Register(Hook{ID: "h2", Type: PostTool})

	if len(reg.List()) != 2 {
		t.Fatalf("expected 2 hooks, got %d", len(reg.List()))
	}
}

func TestRunPreNoHooks(t *testing.T) {
	reg := NewRegistry()
	result, err := reg.RunPre(context.Background(), "read_file", `{"path":"test.go"}`)
	if err != nil {
		t.Fatal(err)
	}
	if result != nil {
		t.Fatal("should return nil when no hooks match")
	}
}

func TestRunPreWithCommand(t *testing.T) {
	reg := NewRegistry()
	reg.Register(Hook{
		ID:      "test-hook",
		Type:    PreTool,
		Command: "echo 'hook ran'",
	})

	result, err := reg.RunPre(context.Background(), "bash", "ls")
	if err != nil {
		t.Fatal(err)
	}
	if result == nil {
		t.Fatal("should return result when hook has output")
	}
	if result.Block {
		t.Fatal("should not block (exit 0)")
	}
}

func TestRunPreBlocking(t *testing.T) {
	reg := NewRegistry()
	reg.Register(Hook{
		ID:      "blocker",
		Type:    PreTool,
		Command: "echo 'blocked'; exit 1",
	})

	result, err := reg.RunPre(context.Background(), "bash", "rm -rf /")
	if err != nil {
		t.Fatal(err)
	}
	if result == nil || !result.Block {
		t.Fatal("should block on non-zero exit")
	}
}

func TestRunPreToolFiltering(t *testing.T) {
	reg := NewRegistry()
	reg.Register(Hook{
		ID:      "write-only",
		Type:    PreTool,
		Tools:   []string{"write_file"},
		Command: "echo filtered",
	})

	// Should not fire for read_file
	result, err := reg.RunPre(context.Background(), "read_file", "")
	if err != nil {
		t.Fatal(err)
	}
	if result != nil {
		t.Fatal("should not fire for read_file")
	}

	// Should fire for write_file
	result, err = reg.RunPre(context.Background(), "write_file", "")
	if err != nil {
		t.Fatal(err)
	}
	if result == nil {
		t.Fatal("should fire for write_file")
	}
}

func TestRunPreJsonResult(t *testing.T) {
	reg := NewRegistry()
	reg.Register(Hook{
		ID:      "json-hook",
		Type:    PreTool,
		Command: `echo '{"block":true,"message":"custom block message"}'`,
	})

	result, err := reg.RunPre(context.Background(), "bash", "")
	if err != nil {
		t.Fatal(err)
	}
	if result == nil || !result.Block {
		t.Fatal("should block via JSON output")
	}
	if result.Message != "custom block message" {
		t.Fatalf("expected custom message, got %q", result.Message)
	}
}

func TestRunPost(t *testing.T) {
	reg := NewRegistry()
	reg.Register(Hook{
		ID:      "post-hook",
		Type:    PostTool,
		Command: "echo 'post hook ran'",
	})

	result, err := reg.RunPost(context.Background(), "bash", "some output")
	if err != nil {
		t.Fatal(err)
	}
	if result == nil {
		t.Fatal("should return result")
	}
}

func TestMatchesTool(t *testing.T) {
	// Empty list matches all
	if !matchesTool(nil, "anything") {
		t.Fatal("nil tools should match all")
	}

	// Exact match
	if !matchesTool([]string{"bash", "read_file"}, "bash") {
		t.Fatal("should match exact tool name")
	}

	// Glob pattern
	if !matchesTool([]string{"space-*"}, "space-code-run") {
		t.Fatal("should match glob pattern")
	}

	// No match
	if matchesTool([]string{"bash"}, "read_file") {
		t.Fatal("should not match different tool")
	}
}

func TestLoadConfig(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "hooks.json")

	config := `{
		"hooks": [
			{"id": "h1", "type": "pre_tool", "tools": ["bash"], "command": "echo check"},
			{"id": "h2", "type": "post_tool", "command": "echo done"}
		]
	}`
	os.WriteFile(cfgPath, []byte(config), 0644)

	hooks, err := LoadConfig(cfgPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(hooks) != 2 {
		t.Fatalf("expected 2 hooks, got %d", len(hooks))
	}
}

func TestLoadConfigNotFound(t *testing.T) {
	hooks, err := LoadConfig("/nonexistent/hooks.json")
	if err != nil {
		t.Fatal("should not error on missing file")
	}
	if hooks != nil {
		t.Fatal("should return nil for missing file")
	}
}
