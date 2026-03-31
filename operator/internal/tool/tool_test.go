package tool

import (
	"context"
	"testing"
	"time"

	"construct-operator/internal/provider"
)

// mockExecutor is a simple executor for testing.
type mockExecutor struct {
	result *Result
	err    error
}

func (m *mockExecutor) Execute(ctx context.Context, input string) (*Result, error) {
	return m.result, m.err
}

func makeTool(name, source string) *Tool {
	return &Tool{
		Def: provider.ToolDef{
			Name:        name,
			Description: "Test tool: " + name,
			InputSchema: map[string]any{
				"type":       "object",
				"properties": map[string]any{},
			},
		},
		Executor: &mockExecutor{result: &Result{Content: "ok"}},
		Source:   source,
	}
}

func TestRegister(t *testing.T) {
	r := NewRegistry()

	tool := makeTool("test_tool", "builtin")
	r.Register(tool)

	got, ok := r.Get("test_tool")
	if !ok {
		t.Fatal("expected tool to be registered")
	}
	if got.Def.Name != "test_tool" {
		t.Errorf("expected name=test_tool, got %q", got.Def.Name)
	}
	if got.Source != "builtin" {
		t.Errorf("expected source=builtin, got %q", got.Source)
	}
}

func TestRegisterOverwrite(t *testing.T) {
	r := NewRegistry()

	r.Register(makeTool("dup", "builtin"))
	r.Register(makeTool("dup", "mcp:server-1"))

	got, ok := r.Get("dup")
	if !ok {
		t.Fatal("expected tool to exist")
	}
	// Latest registration wins
	if got.Source != "mcp:server-1" {
		t.Errorf("expected source=mcp:server-1 (overwrite), got %q", got.Source)
	}
}

func TestGet(t *testing.T) {
	r := NewRegistry()
	r.Register(makeTool("read_file", "builtin"))
	r.Register(makeTool("write_file", "builtin"))

	// Found
	tool, ok := r.Get("read_file")
	if !ok {
		t.Fatal("expected read_file to exist")
	}
	if tool.Def.Name != "read_file" {
		t.Errorf("expected name=read_file, got %q", tool.Def.Name)
	}

	// Not found
	_, ok = r.Get("nonexistent")
	if ok {
		t.Error("expected nonexistent tool to not be found")
	}
}

func TestGetSupportsCanonicalAndLegacySanitizedNames(t *testing.T) {
	r := NewRegistry()
	r.Register(makeTool("space.snapshot", "builtin"))

	if _, ok := r.Get("space.snapshot"); !ok {
		t.Fatal("expected canonical dotted name to resolve")
	}
	if _, ok := r.Get("space__snapshot"); !ok {
		t.Fatal("expected legacy sanitized alias to resolve")
	}
	if _, ok := r.Get("space__2e__snapshot"); !ok {
		t.Fatal("expected provider-sanitized alias to resolve")
	}
}

func TestForAgent(t *testing.T) {
	r := NewRegistry()
	r.Register(makeTool("read_file", "builtin"))
	r.Register(makeTool("write_file", "builtin"))
	r.Register(makeTool("bash", "builtin"))
	r.Register(makeTool("glob", "builtin"))

	t.Run("no filters returns all", func(t *testing.T) {
		tools := r.ForAgent(nil, nil)
		if len(tools) != 4 {
			t.Fatalf("expected 4 tools, got %d", len(tools))
		}
	})

	t.Run("empty filters returns all", func(t *testing.T) {
		tools := r.ForAgent([]string{}, []string{})
		if len(tools) != 4 {
			t.Fatalf("expected 4 tools, got %d", len(tools))
		}
	})

	t.Run("allowed list", func(t *testing.T) {
		tools := r.ForAgent([]string{"read_file", "glob"}, nil)
		if len(tools) != 2 {
			t.Fatalf("expected 2 tools, got %d", len(tools))
		}
		names := toolNames(tools)
		if !names["read_file"] {
			t.Error("expected read_file in allowed list")
		}
		if !names["glob"] {
			t.Error("expected glob in allowed list")
		}
		if names["bash"] {
			t.Error("bash should not be in allowed list")
		}
	})

	t.Run("blocked list", func(t *testing.T) {
		tools := r.ForAgent(nil, []string{"bash"})
		if len(tools) != 3 {
			t.Fatalf("expected 3 tools, got %d", len(tools))
		}
		names := toolNames(tools)
		if names["bash"] {
			t.Error("bash should be blocked")
		}
		if !names["read_file"] {
			t.Error("read_file should not be blocked")
		}
	})

	t.Run("allowed and blocked", func(t *testing.T) {
		// Allow read_file and bash, but block bash
		tools := r.ForAgent([]string{"read_file", "bash"}, []string{"bash"})
		if len(tools) != 1 {
			t.Fatalf("expected 1 tool, got %d", len(tools))
		}
		if tools[0].Def.Name != "read_file" {
			t.Errorf("expected read_file, got %q", tools[0].Def.Name)
		}
	})
}

func TestAll(t *testing.T) {
	r := NewRegistry()

	// Empty
	tools := r.All()
	if len(tools) != 0 {
		t.Fatalf("expected 0 tools, got %d", len(tools))
	}

	// With tools
	r.Register(makeTool("a", "builtin"))
	r.Register(makeTool("b", "mcp:x"))
	r.Register(makeTool("c", "skill:y"))

	tools = r.All()
	if len(tools) != 3 {
		t.Fatalf("expected 3 tools, got %d", len(tools))
	}

	names := toolNames(tools)
	if !names["a"] || !names["b"] || !names["c"] {
		t.Errorf("expected all tools, got %v", names)
	}
}

func TestDefs(t *testing.T) {
	r := NewRegistry()
	r.Register(makeTool("tool_a", "builtin"))
	r.Register(makeTool("tool_b", "builtin"))

	defs := r.Defs()
	if len(defs) != 2 {
		t.Fatalf("expected 2 defs, got %d", len(defs))
	}

	defNames := make(map[string]bool)
	for _, d := range defs {
		defNames[d.Name] = true
		if d.Description == "" {
			t.Errorf("expected non-empty description for %q", d.Name)
		}
		if d.InputSchema == nil {
			t.Errorf("expected non-nil InputSchema for %q", d.Name)
		}
	}
	if !defNames["tool_a"] || !defNames["tool_b"] {
		t.Errorf("expected tool_a and tool_b in defs, got %v", defNames)
	}
}

func TestDefsEmpty(t *testing.T) {
	r := NewRegistry()
	defs := r.Defs()
	if len(defs) != 0 {
		t.Fatalf("expected 0 defs for empty registry, got %d", len(defs))
	}
}

func TestExecutor(t *testing.T) {
	r := NewRegistry()
	r.Register(&Tool{
		Def: provider.ToolDef{
			Name:        "echo",
			Description: "Echo input",
		},
		Executor: &mockExecutor{result: &Result{Content: "echoed"}},
		Source:   "test",
	})

	tool, ok := r.Get("echo")
	if !ok {
		t.Fatal("expected echo tool")
	}

	result, err := tool.Executor.Execute(context.Background(), `{"text":"hello"}`)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if result.Content != "echoed" {
		t.Errorf("expected content=echoed, got %q", result.Content)
	}
	if result.IsError {
		t.Error("expected IsError=false")
	}
}

func TestExecutorTimeout(t *testing.T) {
	r := NewRegistry()

	// Register a tool that takes too long
	slowTool := Func("slow_tool", "Takes forever", nil, func(ctx context.Context, input string) (*Result, error) {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(10 * time.Second):
			return &Result{Content: "done"}, nil
		}
	})
	r.Register(slowTool)

	tool, ok := r.Get("slow_tool")
	if !ok {
		t.Fatal("expected slow_tool to be registered")
	}

	// Execute with a short timeout
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	_, err := tool.Executor.Execute(ctx, "{}")
	if err == nil {
		t.Fatal("expected timeout error")
	}
	if ctx.Err() != context.DeadlineExceeded {
		t.Fatalf("expected DeadlineExceeded, got %v", ctx.Err())
	}
}

func TestExecutorRespectsContextCancellation(t *testing.T) {
	r := NewRegistry()

	blockingTool := Func("blocking", "blocks", nil, func(ctx context.Context, input string) (*Result, error) {
		<-ctx.Done()
		return nil, ctx.Err()
	})
	r.Register(blockingTool)

	tool, _ := r.Get("blocking")

	ctx, cancel := context.WithCancel(context.Background())
	// Cancel immediately
	cancel()

	_, err := tool.Executor.Execute(ctx, "{}")
	if err == nil {
		t.Fatal("expected cancellation error")
	}
}

func toolNames(tools []*Tool) map[string]bool {
	m := make(map[string]bool)
	for _, t := range tools {
		m[t.Def.Name] = true
	}
	return m
}
