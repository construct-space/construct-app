package main

import (
	"context"
	"encoding/json"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"construct-operator/internal/agent"
	"construct-operator/internal/oauth"
	"construct-operator/internal/provider"
	"construct-operator/internal/runner"
	"construct-operator/internal/session"
	"construct-operator/internal/tool"
	"construct-operator/internal/transport"
)

func TestDispatchFrontRequestsSystemRoutes(t *testing.T) {
	rt := newRequestHandlerTestRuntime(t, &requestHandlerTestProvider{
		id:     "test-provider",
		models: []string{"test-model"},
		completeResponse: &provider.Response{
			Content:    "ok",
			StopReason: "end_turn",
		},
	})

	t.Run("system.ping", func(t *testing.T) {
		resp, handled := rt.dispatchFrontRequests(context.Background(), transport.Request{ID: "req-ping", Type: "system.ping"}, requestDispatchDeps{})
		if !handled {
			t.Fatal("expected request to be handled")
		}
		if !resp.Success || resp.ID != "req-ping" {
			t.Fatalf("response = %#v", resp)
		}
		data := mustResponseDataMap(t, resp)
		assertExactKeys(t, data, "status", "version")
		if data["status"] != "ok" || data["version"] != Version {
			t.Fatalf("ping data = %#v, want version %q", data, Version)
		}
	})

	t.Run("system.info", func(t *testing.T) {
		bridge := &requestHandlerTestBridge{}
		resp, handled := rt.dispatchFrontRequests(context.Background(), transport.Request{ID: "req-info", Type: "system.info"}, requestDispatchDeps{
			rootCtx: context.Background(),
			bridge:  bridge,
		})
		if !handled {
			t.Fatal("expected request to be handled")
		}
		data := mustResponseDataMap(t, resp)
		assertExactKeys(t, data, "bridgeStatus", "version", "workDir")
		if data["bridgeStatus"] != "connected" {
			t.Fatalf("bridgeStatus = %#v, want %q", data["bridgeStatus"], "connected")
		}
		if data["version"] != Version {
			t.Fatalf("version = %#v, want %q", data["version"], Version)
		}
		if data["workDir"] != rt.workDir {
			t.Fatalf("workDir = %#v, want %q", data["workDir"], rt.workDir)
		}
		if bridge.calls != 1 {
			t.Fatalf("bridge ping count = %d, want 1", bridge.calls)
		}
	})

	t.Run("stream.cancel", func(t *testing.T) {
		server := &requestHandlerTestServer{}
		resp, handled := rt.dispatchFrontRequests(context.Background(), transport.Request{
			ID:   "req-cancel",
			Type: "stream.cancel",
			Payload: mustJSON(t, map[string]any{
				"request_id": "stream-123",
			}),
		}, requestDispatchDeps{server: server})
		if !handled {
			t.Fatal("expected request to be handled")
		}
		if !resp.Success {
			t.Fatalf("response = %#v", resp)
		}
		data := mustResponseDataMap(t, resp)
		assertExactKeys(t, data, "cancelled")
		if data["cancelled"] != true {
			t.Fatalf("cancelled = %#v, want true", data["cancelled"])
		}
		if got := server.cancelled; !reflect.DeepEqual(got, []string{"stream-123"}) {
			t.Fatalf("cancelled requests = %#v, want %#v", got, []string{"stream-123"})
		}
	})

	t.Run("stream.cancel missing request_id", func(t *testing.T) {
		resp, handled := rt.dispatchFrontRequests(context.Background(), transport.Request{ID: "req-cancel-missing", Type: "stream.cancel"}, requestDispatchDeps{})
		if !handled {
			t.Fatal("expected request to be handled")
		}
		if resp.Success {
			t.Fatalf("response = %#v, want failure", resp)
		}
		if resp.Error != "request_id required" {
			t.Fatalf("error = %q, want %q", resp.Error, "request_id required")
		}
	})
}

func TestDispatchFrontRequestsCatalogRoutes(t *testing.T) {
	rt := newRequestHandlerTestRuntime(t, &requestHandlerTestProvider{
		id:     "test-provider",
		models: []string{"test-model", "test-model-2"},
		completeResponse: &provider.Response{
			Content:    "ok",
			StopReason: "end_turn",
		},
	})

	t.Run("providers.list alias", func(t *testing.T) {
		baseResp, handled := rt.dispatchFrontRequests(context.Background(), transport.Request{ID: "req-providers", Type: "providers.list"}, requestDispatchDeps{})
		if !handled {
			t.Fatal("expected request to be handled")
		}
		aliasResp, handled := rt.dispatchFrontRequests(context.Background(), transport.Request{ID: "req-ai-providers", Type: "ai.providers"}, requestDispatchDeps{})
		if !handled {
			t.Fatal("expected alias request to be handled")
		}
		if baseResp.Success != aliasResp.Success || baseResp.Error != aliasResp.Error || !reflect.DeepEqual(baseResp.Data, aliasResp.Data) {
			t.Fatalf("ai.providers response = %#v, want same data/error as %#v", aliasResp, baseResp)
		}
		data := mustResponseDataMap(t, baseResp)
		assertExactKeys(t, data, "providers")
		providers, ok := data["providers"].([]map[string]any)
		if !ok {
			t.Fatalf("providers type = %T, want []map[string]any", data["providers"])
		}
		if len(providers) != 1 {
			t.Fatalf("providers = %#v, want one provider", providers)
		}
		assertExactKeys(t, providers[0], "id", "label", "models")
		if providers[0]["id"] != "test-provider" || providers[0]["label"] != "test-provider" {
			t.Fatalf("provider entry = %#v, want provider id/label test-provider", providers[0])
		}
		models, ok := providers[0]["models"].([]map[string]any)
		if !ok {
			t.Fatalf("models type = %T, want []map[string]any", providers[0]["models"])
		}
		if len(models) != 2 {
			t.Fatalf("models = %#v, want 2 entries", models)
		}
		assertExactKeys(t, models[0], "id", "label")
		assertExactKeys(t, models[1], "id", "label")
	})

	t.Run("ai.models preserves legacy empty slice", func(t *testing.T) {
		resp, handled := rt.dispatchFrontRequests(context.Background(), transport.Request{ID: "req-models", Type: "ai.models"}, requestDispatchDeps{})
		if !handled {
			t.Fatal("expected request to be handled")
		}
		data := mustResponseDataMap(t, resp)
		assertExactKeys(t, data, "models")
		models, ok := data["models"].([]map[string]string)
		if !ok {
			t.Fatalf("models type = %T, want []map[string]string", data["models"])
		}
		if len(models) != 0 {
			t.Fatalf("models = %#v, want empty slice to preserve current behavior", models)
		}
	})

	t.Run("tools.list", func(t *testing.T) {
		resp, handled := rt.dispatchFrontRequests(context.Background(), transport.Request{ID: "req-tools", Type: "tools.list"}, requestDispatchDeps{})
		if !handled {
			t.Fatal("expected request to be handled")
		}
		data := mustResponseDataMap(t, resp)
		assertExactKeys(t, data, "count", "tools")
		if data["count"] != 1 {
			t.Fatalf("count = %#v, want 1", data["count"])
		}
		tools, ok := data["tools"].([]string)
		if !ok {
			t.Fatalf("tools type = %T, want []string", data["tools"])
		}
		if !reflect.DeepEqual(tools, []string{"test.tool"}) {
			t.Fatalf("tools = %#v, want %#v", tools, []string{"test.tool"})
		}
	})

	t.Run("agents.list", func(t *testing.T) {
		resp, handled := rt.dispatchFrontRequests(context.Background(), transport.Request{ID: "req-agents", Type: "agents.list"}, requestDispatchDeps{})
		if !handled {
			t.Fatal("expected request to be handled")
		}
		data := mustResponseDataMap(t, resp)
		assertExactKeys(t, data, "agents", "count")
		if data["count"] != 2 {
			t.Fatalf("count = %#v, want 2", data["count"])
		}
		agents, ok := data["agents"].([]map[string]any)
		if !ok {
			t.Fatalf("agents type = %T, want []map[string]any", data["agents"])
		}
		if len(agents) != 2 {
			t.Fatalf("agents = %#v, want 2 entries", agents)
		}
		assertExactKeys(t, agents[0], "category", "description", "id", "name")
		if agents[0]["id"] != rt.fallbackAgent.ID {
			t.Fatalf("first agent id = %#v, want %#v", agents[0]["id"], rt.fallbackAgent.ID)
		}
	})
}

func TestDispatchFrontRequestsDispatchStreamFallback(t *testing.T) {
	prov := &requestHandlerTestProvider{
		id:     "test-provider",
		models: []string{"test-model"},
		completeResponse: &provider.Response{
			Content:    "done content",
			StopReason: "end_turn",
			Usage: provider.Usage{
				InputTokens:  11,
				OutputTokens: 4,
			},
		},
	}
	rt := newRequestHandlerTestRuntime(t, prov)
	rt.setProject("client-1", &runner.ProjectContext{
		Name:     "Alpha",
		RootPath: "/tmp/alpha",
	})
	rt.setClientMode("client-1", "design")

	prev := rt.sessionStore.Create("builder")
	prev.Messages = []provider.Message{
		{Role: "assistant", Content: "Earlier"},
	}

	req := transport.Request{
		ID:       "req-dispatch-stream",
		Type:     "agents.dispatch_stream",
		ClientID: "client-1",
		Payload: mustJSON(t, map[string]any{
			"agent_id":   "builder",
			"session_id": prev.ID,
			"task":       "Write a summary",
			"model":      "test-model",
		}),
	}

	resp, handled := rt.dispatchFrontRequests(transport.WithClientID(context.Background(), "client-1"), req, requestDispatchDeps{})
	if !handled {
		t.Fatal("expected request to be handled")
	}
	if !resp.Success || resp.ID != req.ID {
		t.Fatalf("response = %#v", resp)
	}
	data := mustResponseDataMap(t, resp)
	assertExactKeys(t, data, "agent_id", "content", "session_id", "stop_reason", "turns", "usage")
	if data["agent_id"] != "builder" {
		t.Fatalf("agent_id = %#v, want %q", data["agent_id"], "builder")
	}
	if data["content"] != "done content" {
		t.Fatalf("content = %#v, want %q", data["content"], "done content")
	}
	if data["turns"] != 1 {
		t.Fatalf("turns = %#v, want 1", data["turns"])
	}
	if data["stop_reason"] != "end_turn" {
		t.Fatalf("stop_reason = %#v, want %q", data["stop_reason"], "end_turn")
	}
	sessionID, ok := data["session_id"].(string)
	if !ok || sessionID == "" {
		t.Fatalf("session_id = %#v, want non-empty string", data["session_id"])
	}
	usage, ok := data["usage"].(map[string]any)
	if !ok {
		t.Fatalf("usage type = %T, want map[string]any", data["usage"])
	}
	assertExactKeys(t, usage, "input_tokens", "output_tokens")
	if usage["input_tokens"] != 11 || usage["output_tokens"] != 4 {
		t.Fatalf("usage = %#v, want input=11 output=4", usage)
	}

	if prov.completeReq == nil {
		t.Fatal("expected provider request to be captured")
	}
	if got := prov.completeReq.Model; got != "test-model" {
		t.Fatalf("model = %q, want %q", got, "test-model")
	}
	if got := len(prov.completeReq.Messages); got != 2 {
		t.Fatalf("messages len = %d, want 2", got)
	}
	if got := prov.completeReq.Messages[1].Content; got != "Write a summary" {
		t.Fatalf("last message = %q, want %q", got, "Write a summary")
	}
	if !strings.Contains(prov.completeReq.System, "Project: Alpha") || !strings.Contains(prov.completeReq.System, "Root: /tmp/alpha") {
		t.Fatalf("system prompt missing project context: %q", prov.completeReq.System)
	}
	if !strings.Contains(prov.completeReq.System, "Mode: design") {
		t.Fatalf("system prompt missing UI context: %q", prov.completeReq.System)
	}
}

func TestDispatchFrontRequestsAIChatStreamFallback(t *testing.T) {
	prov := &requestHandlerTestProvider{
		id:     "test-provider",
		models: []string{"test-model"},
		completeResponse: &provider.Response{
			Content:    "chat reply",
			StopReason: "end_turn",
			Usage: provider.Usage{
				InputTokens:  3,
				OutputTokens: 2,
			},
		},
	}
	rt := newRequestHandlerTestRuntime(t, prov)
	rt.setProject("client-1", &runner.ProjectContext{
		Name:     "Beta",
		RootPath: "/tmp/beta",
	})
	rt.setClientMode("client-1", "code")

	req := transport.Request{
		ID:       "req-chat-stream",
		Type:     "ai.chat_stream",
		ClientID: "client-1",
		Payload: mustJSON(t, map[string]any{
			"model": "test-model",
			"messages": []map[string]any{
				{"role": "assistant", "content": "Earlier"},
				{"role": "user", "content": "Say hi"},
			},
		}),
	}

	resp, handled := rt.dispatchFrontRequests(transport.WithClientID(context.Background(), "client-1"), req, requestDispatchDeps{})
	if !handled {
		t.Fatal("expected request to be handled")
	}
	if !resp.Success || resp.ID != req.ID {
		t.Fatalf("response = %#v", resp)
	}
	data := mustResponseDataMap(t, resp)
	assertExactKeys(t, data, "content", "stop_reason", "turns")
	if data["content"] != "chat reply" {
		t.Fatalf("content = %#v, want %q", data["content"], "chat reply")
	}
	if data["turns"] != 1 {
		t.Fatalf("turns = %#v, want 1", data["turns"])
	}
	if data["stop_reason"] != "end_turn" {
		t.Fatalf("stop_reason = %#v, want %q", data["stop_reason"], "end_turn")
	}

	if prov.completeReq == nil {
		t.Fatal("expected provider request to be captured")
	}
	if got := len(prov.completeReq.Messages); got != 2 {
		t.Fatalf("messages len = %d, want 2", got)
	}
	if got := prov.completeReq.Messages[1].Content; got != "Say hi" {
		t.Fatalf("last message = %q, want %q", got, "Say hi")
	}
	if !strings.Contains(prov.completeReq.System, "Project: Beta") || !strings.Contains(prov.completeReq.System, "Root: /tmp/beta") {
		t.Fatalf("system prompt missing project context: %q", prov.completeReq.System)
	}
	if !strings.Contains(prov.completeReq.System, "Mode: code") {
		t.Fatalf("system prompt missing UI context: %q", prov.completeReq.System)
	}
}

func mustResponseDataMap(t *testing.T, resp transport.Response) map[string]any {
	t.Helper()

	data, ok := resp.Data.(map[string]any)
	if !ok {
		t.Fatalf("response data type = %T, want map[string]any", resp.Data)
	}
	return data
}

func mustJSON(t *testing.T, payload any) json.RawMessage {
	t.Helper()

	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	return raw
}

func newRequestHandlerTestRuntime(t *testing.T, prov provider.Provider) *operatorRuntime {
	t.Helper()

	tempDir := t.TempDir()
	rt := newOperatorRuntime(tempDir)
	rt.fallbackAgent = &agent.Config{
		ID:       "general",
		Name:     "General",
		System:   "You are a test general agent.",
		Model:    "test-model",
		MaxTurns: 2,
	}
	rt.agents = []*agent.Config{
		{
			ID:       "builder",
			Name:     "Builder",
			System:   "You are a builder agent.",
			Model:    "test-model",
			MaxTurns: 2,
		},
	}
	rt.sessionStore = session.NewStore("")
	rt.oauthStorage = oauth.NewStorage(filepath.Join(tempDir, "auth.json"))
	rt.tools = tool.NewRegistry()
	rt.tools.Register(&tool.Tool{
		Def: provider.ToolDef{
			Name:        "test.tool",
			Description: "Test tool",
		},
		Executor: stubToolExecutor{},
	})
	rt.runner = runner.New(
		runner.WithProvider(prov),
		runner.WithSessionStore(rt.sessionStore),
		runner.WithTools(rt.tools),
	)
	return rt
}

type requestHandlerTestProvider struct {
	id               string
	models           []string
	completeResponse *provider.Response
	completeErr      error
	completeReq      *provider.Request
}

func (p *requestHandlerTestProvider) ID() string {
	return p.id
}

func (p *requestHandlerTestProvider) Models() []string {
	return p.models
}

func (p *requestHandlerTestProvider) Complete(_ context.Context, req *provider.Request) (*provider.Response, error) {
	p.completeReq = cloneProviderRequest(req)
	if p.completeErr != nil {
		return nil, p.completeErr
	}
	if p.completeResponse == nil {
		return &provider.Response{StopReason: "end_turn"}, nil
	}
	copyResp := *p.completeResponse
	return &copyResp, nil
}

func (p *requestHandlerTestProvider) Stream(_ context.Context, req *provider.Request) (<-chan provider.StreamEvent, error) {
	panic("Stream should not be called in request handler tests")
}

type requestHandlerTestBridge struct {
	calls int
}

func (b *requestHandlerTestBridge) Ping(context.Context) error {
	b.calls++
	return nil
}

type requestHandlerTestServer struct {
	cancelled []string
}

func (s *requestHandlerTestServer) CancelStream(requestID string) bool {
	s.cancelled = append(s.cancelled, requestID)
	return true
}

type stubToolExecutor struct{}

func (stubToolExecutor) Execute(context.Context, string) (*tool.Result, error) {
	return &tool.Result{Content: "ok"}, nil
}
