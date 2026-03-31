package runner

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"construct-operator/internal/agent"
	"construct-operator/internal/provider"
	"construct-operator/internal/stream"
	"construct-operator/internal/tool"
)

type fakeProvider struct {
	id     string
	models []string
}

func (p fakeProvider) ID() string { return p.id }

func (p fakeProvider) Models() []string { return p.models }

func (p fakeProvider) Complete(context.Context, *provider.Request) (*provider.Response, error) {
	return nil, nil
}

func (p fakeProvider) Stream(context.Context, *provider.Request) (<-chan provider.StreamEvent, error) {
	return nil, nil
}

type captureProvider struct {
	id      string
	models  []string
	lastReq *provider.Request
}

func (p *captureProvider) ID() string { return p.id }

func (p *captureProvider) Models() []string { return p.models }

func (p *captureProvider) Complete(_ context.Context, req *provider.Request) (*provider.Response, error) {
	p.lastReq = req
	return nil, errors.New("stop after capture")
}

func (p *captureProvider) Stream(_ context.Context, req *provider.Request) (<-chan provider.StreamEvent, error) {
	p.lastReq = req
	ch := make(chan provider.StreamEvent, 1)
	ch <- provider.StreamEvent{
		Type: "done",
		Response: &provider.Response{
			Content:    "",
			StopReason: "tool_use",
			ToolCalls: []provider.ToolCall{
				{ID: "call_1", Name: "bash", Input: `{"cmd":"pwd"}`},
			},
		},
	}
	close(ch)
	return ch, nil
}

type doneOnlyStreamProvider struct {
	id     string
	models []string
}

func (p doneOnlyStreamProvider) ID() string { return p.id }

func (p doneOnlyStreamProvider) Models() []string { return p.models }

func (p doneOnlyStreamProvider) Complete(context.Context, *provider.Request) (*provider.Response, error) {
	return nil, nil
}

func (p doneOnlyStreamProvider) Stream(context.Context, *provider.Request) (<-chan provider.StreamEvent, error) {
	ch := make(chan provider.StreamEvent, 2)
	ch <- provider.StreamEvent{
		Type: "tool_call_done",
		ToolCall: &provider.ToolCall{
			ID:    "call_1",
			Name:  "bash",
			Input: `{"cmd":"pwd"}`,
		},
	}
	ch <- provider.StreamEvent{
		Type: "done",
		Response: &provider.Response{
			Content:    "",
			StopReason: "end_turn",
		},
	}
	close(ch)
	return ch, nil
}

type sequenceProvider struct {
	id        string
	models    []string
	responses []*provider.Response
	requests  []*provider.Request
}

func (p *sequenceProvider) ID() string { return p.id }

func (p *sequenceProvider) Models() []string { return p.models }

func (p *sequenceProvider) Complete(_ context.Context, req *provider.Request) (*provider.Response, error) {
	p.requests = append(p.requests, cloneProviderRequest(req))
	index := len(p.requests) - 1
	if index >= len(p.responses) {
		return nil, fmt.Errorf("unexpected provider call %d", index+1)
	}
	return p.responses[index], nil
}

func (p *sequenceProvider) Stream(context.Context, *provider.Request) (<-chan provider.StreamEvent, error) {
	return nil, errors.New("stream not implemented")
}

type repeatingToolProvider struct {
	id       string
	models   []string
	requests int
}

func (p *repeatingToolProvider) ID() string { return p.id }

func (p *repeatingToolProvider) Models() []string { return p.models }

func (p *repeatingToolProvider) Complete(context.Context, *provider.Request) (*provider.Response, error) {
	p.requests++
	return &provider.Response{
		Content:    "",
		StopReason: "tool_use",
		ToolCalls: []provider.ToolCall{
			{
				ID:    fmt.Sprintf("call_%d", p.requests),
				Name:  "bash",
				Input: `{"cmd":"pwd"}`,
			},
		},
	}, nil
}

func (p *repeatingToolProvider) Stream(context.Context, *provider.Request) (<-chan provider.StreamEvent, error) {
	return nil, errors.New("stream not implemented")
}

func cloneProviderRequest(req *provider.Request) *provider.Request {
	if req == nil {
		return nil
	}
	cloned := *req
	cloned.Messages = make([]provider.Message, len(req.Messages))
	for i, msg := range req.Messages {
		clonedMsg := msg
		if len(msg.ToolCalls) > 0 {
			clonedMsg.ToolCalls = append([]provider.ToolCall(nil), msg.ToolCalls...)
		}
		if msg.ToolResult != nil {
			toolResult := *msg.ToolResult
			clonedMsg.ToolResult = &toolResult
		}
		cloned.Messages[i] = clonedMsg
	}
	if len(req.Tools) > 0 {
		cloned.Tools = append([]provider.ToolDef(nil), req.Tools...)
	}
	return &cloned
}

func TestBuildSystemWithContext_NoProject(t *testing.T) {
	base := "You are a helpful assistant."
	result := buildSystemWithContext(base, nil, nil)
	if result != base {
		t.Fatalf("expected unchanged base, got %q", result)
	}
}

func TestBuildSystemWithContext_WithProject(t *testing.T) {
	base := "You are a helpful assistant."
	project := &ProjectContext{
		Name:      "my-app",
		Type:      "nuxt",
		Framework: "Vue 3",
		RootPath:  "/tmp/my-app",
	}
	result := buildSystemWithContext(base, project, nil)

	if !strings.Contains(result, "Project: my-app") {
		t.Fatal("should contain project name")
	}
	if !strings.Contains(result, "Type: nuxt") {
		t.Fatal("should contain project type")
	}
	if !strings.Contains(result, "Framework: Vue 3") {
		t.Fatal("should contain framework")
	}
	if !strings.Contains(result, "Root: /tmp/my-app") {
		t.Fatal("should contain root path")
	}
	if !strings.HasPrefix(result, base) {
		t.Fatal("should start with base system prompt")
	}
}

func TestBuildSystemWithContext_ReadsAgentsMd(t *testing.T) {
	dir := t.TempDir()

	// Create agents.md
	agentsContent := "Always use TypeScript.\nPrefer composition over inheritance."
	os.WriteFile(filepath.Join(dir, "agents.md"), []byte(agentsContent), 0644)

	base := "You are a coding assistant."
	project := &ProjectContext{
		Name:     "test-project",
		RootPath: dir,
	}
	result := buildSystemWithContext(base, project, nil)

	if !strings.Contains(result, "Instructions from agents.md") {
		t.Fatal("should contain agents.md header")
	}
	if !strings.Contains(result, "Always use TypeScript") {
		t.Fatal("should contain agents.md content")
	}
}

func TestBuildSystemWithContext_ReadsMultipleFiles(t *testing.T) {
	dir := t.TempDir()

	os.WriteFile(filepath.Join(dir, "AGENTS.md"), []byte("Rule 1: Be concise."), 0644)
	os.WriteFile(filepath.Join(dir, "CLAUDE.md"), []byte("Rule 2: Use tools."), 0644)

	base := "Base prompt."
	project := &ProjectContext{RootPath: dir}
	result := buildSystemWithContext(base, project, nil)

	if !strings.Contains(result, "Instructions from AGENTS.md") {
		t.Fatal("should contain AGENTS.md")
	}
	if !strings.Contains(result, "Rule 1: Be concise") {
		t.Fatal("should contain AGENTS.md content")
	}
	if !strings.Contains(result, "Instructions from CLAUDE.md") {
		t.Fatal("should contain CLAUDE.md")
	}
	if !strings.Contains(result, "Rule 2: Use tools") {
		t.Fatal("should contain CLAUDE.md content")
	}
}

func TestBuildSystemWithContext_IgnoresMissingFiles(t *testing.T) {
	dir := t.TempDir()
	// No files created — should not error
	base := "Base prompt."
	project := &ProjectContext{RootPath: dir, Name: "empty"}
	result := buildSystemWithContext(base, project, nil)

	if !strings.HasPrefix(result, base) {
		t.Fatal("should start with base")
	}
	if strings.Contains(result, "Instructions from") {
		t.Fatal("should not contain instructions section when files are missing")
	}
}

func TestBuildSystemWithContext_PartialFields(t *testing.T) {
	base := "Base."
	project := &ProjectContext{Name: "only-name"}
	result := buildSystemWithContext(base, project, nil)

	if !strings.Contains(result, "Project: only-name") {
		t.Fatal("should contain project name")
	}
	if strings.Contains(result, "Type:") {
		t.Fatal("should not contain empty type")
	}
	if strings.Contains(result, "Framework:") {
		t.Fatal("should not contain empty framework")
	}
}

func TestBuildSystemWithContext_IncludesUIContext(t *testing.T) {
	base := "Base."
	result := buildSystemWithContext(base, nil, map[string]any{
		"mode": "ui",
		"component": map[string]any{
			"name":     "Sidebar",
			"type":     "component",
			"filePath": "src/components/Sidebar.vue",
		},
		"selection": map[string]any{
			"type":    "code",
			"content": "const ready = true",
		},
	})

	if !strings.Contains(result, "Mode: ui") {
		t.Fatal("should contain active mode")
	}
	if !strings.Contains(result, "Component: Sidebar (component)") {
		t.Fatal("should contain component context")
	}
	if !strings.Contains(result, "Selection Content: const ready = true") {
		t.Fatal("should contain selection content")
	}
}

func TestResolveProvider_AllowsBareModelIDsWithColonSuffix(t *testing.T) {
	r := New(
		WithProvider(fakeProvider{
			id:     "openrouter",
			models: []string{"qwen/qwen3-next-80b-a3b-instruct:free"},
		}),
	)

	p, model, err := r.resolveProvider("qwen/qwen3-next-80b-a3b-instruct:free")
	if err != nil {
		t.Fatalf("expected bare OpenRouter model id to resolve, got %v", err)
	}
	if p.ID() != "openrouter" {
		t.Fatalf("expected openrouter provider, got %q", p.ID())
	}
	if model != "qwen/qwen3-next-80b-a3b-instruct:free" {
		t.Fatalf("expected exact model id, got %q", model)
	}
}

func TestRun_RequiresToolChoiceForInitialVibeTurn(t *testing.T) {
	prov := &captureProvider{
		id:     "openrouter",
		models: []string{"openrouter/free"},
	}
	reg := tool.NewRegistry()
	reg.Register(&tool.Tool{
		Def: provider.ToolDef{
			Name:        "bash",
			Description: "Run shell commands",
			InputSchema: map[string]any{"type": "object"},
		},
		Executor: &noopExecutor{},
		Source:   "test",
	})

	r := New(
		WithProvider(prov),
		WithTools(reg),
	)

	_, _ = r.Run(context.Background(), &RunRequest{
		Agent: &agent.Config{
			ID:   "vibe",
			Name: "Vibe",
		},
		Task:  "Inspect the repo",
		Model: "openrouter:openrouter/free",
	})

	if prov.lastReq == nil {
		t.Fatal("expected provider request to be captured")
	}
	if prov.lastReq.ToolChoice != "required" {
		t.Fatalf("expected required tool choice, got %q", prov.lastReq.ToolChoice)
	}
}

func TestStreamCallMergesToolCallDoneIntoFinalResponse(t *testing.T) {
	r := New()
	resp, err := r.streamCall(
		context.Background(),
		doneOnlyStreamProvider{
			id:     "openai-oauth",
			models: []string{"gpt-5.3-codex-spark"},
		},
		&provider.Request{Model: "gpt-5.3-codex-spark"},
		stream.NewEmitter(),
	)
	if err != nil {
		t.Fatalf("expected stream call to succeed, got %v", err)
	}
	if len(resp.ToolCalls) != 1 {
		t.Fatalf("expected 1 merged tool call, got %d", len(resp.ToolCalls))
	}
	if resp.StopReason != "tool_use" {
		t.Fatalf("expected tool_use stop reason, got %q", resp.StopReason)
	}
}

func TestRun_CompactsLargeToolResultsBeforeSendingBackToModel(t *testing.T) {
	largeOutput := strings.Repeat("0123456789", 800)
	prov := &sequenceProvider{
		id:     "anthropic",
		models: []string{"claude-sonnet-4-6"},
		responses: []*provider.Response{
			{
				StopReason: "tool_use",
				ToolCalls: []provider.ToolCall{
					{ID: "call_1", Name: "bash", Input: `{"cmd":"cat docs/plan.md"}`},
				},
			},
			{
				Content:    "done",
				StopReason: "end_turn",
			},
		},
	}
	reg := tool.NewRegistry()
	reg.Register(&tool.Tool{
		Def: provider.ToolDef{
			Name:        "bash",
			Description: "Run shell commands",
			InputSchema: map[string]any{"type": "object"},
		},
		Executor: &staticExecutor{content: largeOutput},
		Source:   "test",
	})

	r := New(
		WithProvider(prov),
		WithTools(reg),
	)

	result, err := r.Run(context.Background(), &RunRequest{
		Agent: &agent.Config{ID: "test", Name: "Test"},
		Task:  "Read docs and act on them",
		Model: "anthropic:claude-sonnet-4-6",
	})
	if err != nil {
		t.Fatalf("expected run to succeed, got %v", err)
	}
	if result.StopReason != "end_turn" {
		t.Fatalf("expected end_turn, got %q", result.StopReason)
	}
	if len(prov.requests) != 2 {
		t.Fatalf("expected 2 provider requests, got %d", len(prov.requests))
	}

	secondReq := prov.requests[1]
	last := secondReq.Messages[len(secondReq.Messages)-1]
	if last.Role != "tool" || last.ToolResult == nil {
		t.Fatalf("expected final message to be tool result, got %#v", last)
	}
	if last.ToolResult.Content == largeOutput {
		t.Fatal("expected tool result to be compacted for model context")
	}
	if len(last.ToolResult.Content) >= len(largeOutput) {
		t.Fatalf("expected compacted tool result to be shorter than original: got %d vs %d", len(last.ToolResult.Content), len(largeOutput))
	}
	if !strings.Contains(last.ToolResult.Content, "truncated") {
		t.Fatalf("expected compacted tool result to explain truncation, got %q", last.ToolResult.Content)
	}
}

func TestRun_StopsRepetitiveToolLoopsEarly(t *testing.T) {
	prov := &repeatingToolProvider{
		id:     "anthropic",
		models: []string{"claude-sonnet-4-6"},
	}
	reg := tool.NewRegistry()
	reg.Register(&tool.Tool{
		Def: provider.ToolDef{
			Name:        "bash",
			Description: "Run shell commands",
			InputSchema: map[string]any{"type": "object"},
		},
		Executor: &staticExecutor{content: "working directory"},
		Source:   "test",
	})

	r := New(
		WithProvider(prov),
		WithTools(reg),
	)

	result, err := r.Run(context.Background(), &RunRequest{
		Agent:    &agent.Config{ID: "test", Name: "Test", MaxTurns: 20},
		Task:     "Read docs and implement the plan",
		Model:    "anthropic:claude-sonnet-4-6",
		MaxTurns: 20,
	})
	if err != nil {
		t.Fatalf("expected run to stop cleanly, got %v", err)
	}
	if result.StopReason != "stuck_loop" {
		t.Fatalf("expected stuck_loop stop reason, got %q", result.StopReason)
	}
	if len(result.Turns) >= 20 {
		t.Fatalf("expected runner to stop before max turns, got %d turns", len(result.Turns))
	}
	if prov.requests >= 20 {
		t.Fatalf("expected fewer than 20 provider calls, got %d", prov.requests)
	}
}

func TestRunRequest_AssistantTypeMetadata(t *testing.T) {
	// Verify that AssistantType and OutputSchema are carried through
	// the RunRequest without affecting routing or execution.
	prov := &sequenceProvider{
		id:     "anthropic",
		models: []string{"claude-sonnet-4-6"},
		responses: []*provider.Response{
			{Content: "done", StopReason: "end_turn"},
		},
	}
	r := New(WithProvider(prov))

	result, err := r.Run(context.Background(), &RunRequest{
		Agent:         &agent.Config{ID: "test", Name: "Test"},
		Task:          "hello",
		Model:         "anthropic:claude-sonnet-4-6",
		AssistantType: "architect",
		OutputSchema:  "architect.v1",
	})
	if err != nil {
		t.Fatalf("expected run to succeed, got %v", err)
	}
	if result.StopReason != "end_turn" {
		t.Fatalf("expected end_turn, got %q", result.StopReason)
	}
	// The metadata should not change agent routing — the agent ID should
	// remain what was passed in, not affected by assistant_type.
	if result.AgentID != "test" {
		t.Fatalf("expected agent_id=test, got %q", result.AgentID)
	}
}

func TestRunRequest_AssistantTypeMetadataJSON(t *testing.T) {
	// Verify the fields serialize correctly via JSON.
	req := RunRequest{
		AssistantType: "brainstorm",
		OutputSchema:  "assistant.v1",
	}
	data, err := json.Marshal(req)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	s := string(data)
	if !strings.Contains(s, `"assistant_type":"brainstorm"`) {
		t.Fatalf("expected assistant_type in JSON, got %s", s)
	}
	if !strings.Contains(s, `"output_schema":"assistant.v1"`) {
		t.Fatalf("expected output_schema in JSON, got %s", s)
	}

	// Verify omitempty — empty values should not appear.
	req2 := RunRequest{}
	data2, _ := json.Marshal(req2)
	s2 := string(data2)
	if strings.Contains(s2, "assistant_type") {
		t.Fatalf("expected assistant_type to be omitted when empty, got %s", s2)
	}
	if strings.Contains(s2, "output_schema") {
		t.Fatalf("expected output_schema to be omitted when empty, got %s", s2)
	}
}

type staticExecutor struct {
	content string
	isError bool
}

func (e *staticExecutor) Execute(context.Context, string) (*tool.Result, error) {
	return &tool.Result{
		Content: e.content,
		IsError: e.isError,
	}, nil
}

// capabilityProvider is a fake that implements CapabilitiesProvider.
type capabilityProvider struct {
	sequenceProvider
	caps provider.Capabilities
}

func (p *capabilityProvider) Capabilities() provider.Capabilities { return p.caps }

func TestRun_SkipsStructuredOutputWhenUnsupported(t *testing.T) {
	prov := &capabilityProvider{
		sequenceProvider: sequenceProvider{
			id:     "codex",
			models: []string{"gpt-5.4"},
			responses: []*provider.Response{
				{Content: `{"version":"architect.v1","state":"questions"}`, StopReason: "end_turn"},
			},
		},
		caps: provider.Capabilities{
			SupportsStructuredOutput: false,
			SupportsTools:            true,
			SupportsStreaming:         true,
		},
	}

	r := New(WithProvider(prov))
	_, err := r.Run(context.Background(), &RunRequest{
		Agent:        &agent.Config{ID: "test", Name: "Test"},
		Task:         "plan the architecture",
		Model:        "codex:gpt-5.4",
		OutputSchema: "architect.v1",
	})
	if err != nil {
		t.Fatalf("expected run to succeed, got %v", err)
	}

	// Provider should NOT have received an output schema
	if len(prov.requests) == 0 {
		t.Fatal("expected at least one request")
	}
	if prov.requests[0].OutputSchema != nil {
		t.Fatal("expected OutputSchema to be nil when provider does not support structured output")
	}
}

func TestRun_IncludesStructuredOutputWhenSupported(t *testing.T) {
	prov := &capabilityProvider{
		sequenceProvider: sequenceProvider{
			id:     "anthropic",
			models: []string{"claude-sonnet-4-6"},
			responses: []*provider.Response{
				{Content: `{"version":"architect.v1","state":"questions"}`, StopReason: "end_turn"},
			},
		},
		caps: provider.Capabilities{
			SupportsStructuredOutput: true,
			SupportsTools:            true,
			SupportsStreaming:         true,
		},
	}

	r := New(WithProvider(prov))
	_, err := r.Run(context.Background(), &RunRequest{
		Agent:        &agent.Config{ID: "test", Name: "Test"},
		Task:         "plan the architecture",
		Model:        "anthropic:claude-sonnet-4-6",
		OutputSchema: "architect.v1",
	})
	if err != nil {
		t.Fatalf("expected run to succeed, got %v", err)
	}

	if len(prov.requests) == 0 {
		t.Fatal("expected at least one request")
	}
	if prov.requests[0].OutputSchema == nil {
		t.Fatal("expected OutputSchema to be set when provider supports structured output")
	}
}

func TestProviderHealth_ReturnsHealthStatus(t *testing.T) {
	r := New(
		WithProvider(fakeProvider{id: "test-provider", models: []string{"model-1"}}),
	)

	health := r.ProviderHealth(context.Background())
	status, ok := health["test-provider"]
	if !ok {
		t.Fatal("expected test-provider in health results")
	}
	if status["healthy"] != true {
		t.Fatalf("expected healthy=true, got %v", status["healthy"])
	}
	// fakeProvider doesn't implement HealthChecker, so it should have a note
	if status["note"] != "no health check implemented" {
		t.Fatalf("expected note about missing health check, got %v", status["note"])
	}
}

func TestRun_AccumulatesTotalUsage(t *testing.T) {
	prov := &sequenceProvider{
		id:     "anthropic",
		models: []string{"claude-sonnet-4-6"},
		responses: []*provider.Response{
			{
				StopReason: "tool_use",
				Usage:      provider.Usage{InputTokens: 100, OutputTokens: 50, CacheRead: 10},
				ToolCalls: []provider.ToolCall{
					{ID: "call_1", Name: "bash", Input: `{"cmd":"pwd"}`},
				},
			},
			{
				Content:    "done",
				StopReason: "end_turn",
				Usage:      provider.Usage{InputTokens: 200, OutputTokens: 75, CacheRead: 20},
			},
		},
	}
	reg := tool.NewRegistry()
	reg.Register(&tool.Tool{
		Def: provider.ToolDef{
			Name:        "bash",
			Description: "Run shell commands",
			InputSchema: map[string]any{"type": "object"},
		},
		Executor: &staticExecutor{content: "/tmp"},
		Source:   "test",
	})

	r := New(WithProvider(prov), WithTools(reg))
	result, err := r.Run(context.Background(), &RunRequest{
		Agent: &agent.Config{ID: "test", Name: "Test"},
		Task:  "check directory",
		Model: "anthropic:claude-sonnet-4-6",
	})
	if err != nil {
		t.Fatalf("expected run to succeed, got %v", err)
	}
	if result.Usage.InputTokens != 300 {
		t.Fatalf("expected total input=300, got %d", result.Usage.InputTokens)
	}
	if result.Usage.OutputTokens != 125 {
		t.Fatalf("expected total output=125, got %d", result.Usage.OutputTokens)
	}
	if result.Usage.CacheRead != 30 {
		t.Fatalf("expected total cache_read=30, got %d", result.Usage.CacheRead)
	}
}
