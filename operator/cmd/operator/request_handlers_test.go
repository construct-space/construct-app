package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"construct-operator/internal/agent"
	"construct-operator/internal/oauth"
	"construct-operator/internal/provider"
	"construct-operator/internal/runner"
	"construct-operator/internal/session"
	"construct-operator/internal/state"
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

func TestDispatchFrontRequestsContextProjectRoundTrip(t *testing.T) {
	rt := newRequestHandlerTestRuntime(t, &requestHandlerTestProvider{
		id:     "test-provider",
		models: []string{"test-model"},
	})
	ctx := transport.WithClientID(context.Background(), "client-1")

	setResp, handled := rt.dispatchFrontRequests(ctx, transport.Request{
		ID:       "req-set-project",
		Type:     "context.set_project",
		ClientID: "client-1",
		Payload: mustJSON(t, map[string]any{
			"name":      "Alpha",
			"rootPath":  "/tmp/alpha",
			"root_path": "/tmp/alpha",
		}),
	}, requestDispatchDeps{})
	if !handled || !setResp.Success {
		t.Fatalf("set project response = %#v", setResp)
	}

	getResp, handled := rt.dispatchFrontRequests(ctx, transport.Request{
		ID:       "req-get-context",
		Type:     "context.get",
		ClientID: "client-1",
	}, requestDispatchDeps{})
	if !handled || !getResp.Success {
		t.Fatalf("context.get response = %#v", getResp)
	}
	data := mustResponseDataMap(t, getResp)
	if data["workDir"] != "/tmp/alpha" {
		t.Fatalf("workDir = %#v, want %q", data["workDir"], "/tmp/alpha")
	}
	project, ok := data["project"].(*runner.ProjectContext)
	if !ok {
		t.Fatalf("project type = %T, want *runner.ProjectContext", data["project"])
	}
	if project.Name != "Alpha" || project.RootPath != "/tmp/alpha" {
		t.Fatalf("project = %#v, want Alpha /tmp/alpha", project)
	}
}

func TestDispatchFrontRequestsContextStateRoundTrip(t *testing.T) {
	rt := newRequestHandlerTestRuntime(t, &requestHandlerTestProvider{
		id:     "test-provider",
		models: []string{"test-model"},
	})
	ctx := transport.WithClientID(context.Background(), "client-1")

	cases := []transport.Request{
		{
			ID:       "req-set-mode",
			Type:     "context.set_mode",
			ClientID: "client-1",
			Payload:  mustJSON(t, map[string]any{"mode": "design"}),
		},
		{
			ID:       "req-set-component",
			Type:     "context.set_component",
			ClientID: "client-1",
			Payload:  mustJSON(t, map[string]any{"panel": "assistant"}),
		},
		{
			ID:       "req-set-selection",
			Type:     "context.set_selection",
			ClientID: "client-1",
			Payload:  mustJSON(t, map[string]any{"selected": "file.go"}),
		},
	}
	for _, req := range cases {
		resp, handled := rt.dispatchFrontRequests(ctx, req, requestDispatchDeps{})
		if !handled || !resp.Success {
			t.Fatalf("%s response = %#v", req.Type, resp)
		}
	}

	resp, handled := rt.dispatchFrontRequests(ctx, transport.Request{
		ID:       "req-context-get",
		Type:     "context.get",
		ClientID: "client-1",
	}, requestDispatchDeps{})
	if !handled || !resp.Success {
		t.Fatalf("context.get response = %#v", resp)
	}
	data := mustResponseDataMap(t, resp)
	if data["mode"] != "design" {
		t.Fatalf("mode = %#v, want %q", data["mode"], "design")
	}
	component, ok := data["component"].(map[string]any)
	if !ok {
		t.Fatalf("component type = %T, want map[string]any", data["component"])
	}
	assertExactKeys(t, component, "panel")
	if component["panel"] != "assistant" {
		t.Fatalf("component = %#v, want panel assistant", component)
	}
	selection, ok := data["selection"].(map[string]any)
	if !ok {
		t.Fatalf("selection type = %T, want map[string]any", data["selection"])
	}
	assertExactKeys(t, selection, "selected")
	if selection["selected"] != "file.go" {
		t.Fatalf("selection = %#v, want selected file.go", selection)
	}
}

func TestDispatchFrontRequestsContextClearProject(t *testing.T) {
	rt := newRequestHandlerTestRuntime(t, &requestHandlerTestProvider{
		id:     "test-provider",
		models: []string{"test-model"},
	})
	ctx := transport.WithClientID(context.Background(), "client-1")

	setResp, handled := rt.dispatchFrontRequests(ctx, transport.Request{
		ID:       "req-set-project",
		Type:     "context.set_project",
		ClientID: "client-1",
		Payload:  mustJSON(t, runner.ProjectContext{Name: "Beta", RootPath: "/tmp/beta"}),
	}, requestDispatchDeps{})
	if !handled || !setResp.Success {
		t.Fatalf("set project response = %#v", setResp)
	}

	clearResp, handled := rt.dispatchFrontRequests(ctx, transport.Request{
		ID:       "req-clear-project",
		Type:     "context.clear_project",
		ClientID: "client-1",
	}, requestDispatchDeps{})
	if !handled || !clearResp.Success {
		t.Fatalf("clear project response = %#v", clearResp)
	}

	getResp, handled := rt.dispatchFrontRequests(ctx, transport.Request{
		ID:       "req-context-get",
		Type:     "context.get",
		ClientID: "client-1",
	}, requestDispatchDeps{})
	if !handled || !getResp.Success {
		t.Fatalf("context.get response = %#v", getResp)
	}
	data := mustResponseDataMap(t, getResp)
	if _, ok := data["project"]; ok {
		t.Fatalf("project should be cleared, got %#v", data["project"])
	}
	if data["workDir"] != rt.workDir {
		t.Fatalf("workDir = %#v, want %q", data["workDir"], rt.workDir)
	}
}

func TestDispatchFrontRequestsStorageRoundTrip(t *testing.T) {
	rt := newRequestHandlerTestRuntime(t, &requestHandlerTestProvider{
		id:     "test-provider",
		models: []string{"test-model"},
	})
	projectID := 7
	value := json.RawMessage(`{"dark":true}`)

	setResp, handled := rt.dispatchFrontRequests(context.Background(), transport.Request{
		ID:   "req-storage-set",
		Type: "storage.set",
		Payload: mustJSON(t, map[string]any{
			"key":       "theme",
			"value":     value,
			"category":  "prefs",
			"projectId": projectID,
			"userId":    "u1",
		}),
	}, requestDispatchDeps{})
	if !handled || !setResp.Success {
		t.Fatalf("storage.set response = %#v", setResp)
	}

	getResp, handled := rt.dispatchFrontRequests(context.Background(), transport.Request{
		ID:   "req-storage-get",
		Type: "storage.get",
		Payload: mustJSON(t, map[string]any{
			"key":       "theme",
			"category":  "prefs",
			"projectId": projectID,
			"userId":    "u1",
		}),
	}, requestDispatchDeps{})
	if !handled || !getResp.Success {
		t.Fatalf("storage.get response = %#v", getResp)
	}
	getData := mustResponseDataMap(t, getResp)
	if got := mustRawMessage(t, getData["value"]); string(got) != string(value) {
		t.Fatalf("storage.get value = %s, want %s", got, value)
	}

	batchResp, handled := rt.dispatchFrontRequests(context.Background(), transport.Request{
		ID:   "req-storage-batch-get",
		Type: "storage.batch_get",
		Payload: mustJSON(t, map[string]any{
			"keys":      []string{"theme", "missing"},
			"category":  "prefs",
			"projectId": projectID,
			"userId":    "u1",
		}),
	}, requestDispatchDeps{})
	if !handled || !batchResp.Success {
		t.Fatalf("storage.batch_get response = %#v", batchResp)
	}
	batchData := mustResponseDataMap(t, batchResp)
	items, ok := batchData["items"].(map[string]json.RawMessage)
	if !ok {
		t.Fatalf("storage.batch_get items type = %T, want map[string]json.RawMessage", batchData["items"])
	}
	if got := items["theme"]; string(got) != string(value) {
		t.Fatalf("storage.batch_get theme = %s, want %s", got, value)
	}

	listResp, handled := rt.dispatchFrontRequests(context.Background(), transport.Request{
		ID:   "req-storage-list",
		Type: "storage.list",
		Payload: mustJSON(t, map[string]any{
			"category":  "prefs",
			"projectId": projectID,
			"userId":    "u1",
		}),
	}, requestDispatchDeps{})
	if !handled || !listResp.Success {
		t.Fatalf("storage.list response = %#v", listResp)
	}
	listData := mustResponseDataMap(t, listResp)
	listItems, ok := listData["items"].([]map[string]any)
	if !ok || len(listItems) != 1 {
		t.Fatalf("storage.list items = %#v, want one entry", listData["items"])
	}
	if listItems[0]["key"] != "theme" {
		t.Fatalf("storage.list key = %#v, want %q", listItems[0]["key"], "theme")
	}
	if got := mustRawMessage(t, listItems[0]["value"]); string(got) != string(value) {
		t.Fatalf("storage.list value = %s, want %s", got, value)
	}

	deleteResp, handled := rt.dispatchFrontRequests(context.Background(), transport.Request{
		ID:   "req-storage-delete",
		Type: "storage.delete",
		Payload: mustJSON(t, map[string]any{
			"key":       "theme",
			"category":  "prefs",
			"projectId": projectID,
			"userId":    "u1",
		}),
	}, requestDispatchDeps{})
	if !handled || !deleteResp.Success {
		t.Fatalf("storage.delete response = %#v", deleteResp)
	}

	getAfterDeleteResp, handled := rt.dispatchFrontRequests(context.Background(), transport.Request{
		ID:   "req-storage-get-after-delete",
		Type: "storage.get",
		Payload: mustJSON(t, map[string]any{
			"key":       "theme",
			"category":  "prefs",
			"projectId": projectID,
			"userId":    "u1",
		}),
	}, requestDispatchDeps{})
	if !handled || !getAfterDeleteResp.Success {
		t.Fatalf("storage.get after delete response = %#v", getAfterDeleteResp)
	}
	if got := mustResponseDataMap(t, getAfterDeleteResp)["value"]; got != nil {
		t.Fatalf("storage.get after delete value = %#v, want nil", got)
	}
}

func TestDispatchFrontRequestsKVRoundTrip(t *testing.T) {
	rt := newRequestHandlerTestRuntime(t, &requestHandlerTestProvider{
		id:     "test-provider",
		models: []string{"test-model"},
	})

	setResp, handled := rt.dispatchFrontRequests(context.Background(), transport.Request{
		ID:   "req-kv-set",
		Type: "kv.set",
		Payload: mustJSON(t, map[string]any{
			"key":      "token",
			"value":    "abc123",
			"category": "auth",
		}),
	}, requestDispatchDeps{})
	if !handled || !setResp.Success {
		t.Fatalf("kv.set response = %#v", setResp)
	}

	getResp, handled := rt.dispatchFrontRequests(context.Background(), transport.Request{
		ID:   "req-kv-get",
		Type: "kv.get",
		Payload: mustJSON(t, map[string]any{
			"key":      "token",
			"category": "auth",
		}),
	}, requestDispatchDeps{})
	if !handled || !getResp.Success {
		t.Fatalf("kv.get response = %#v", getResp)
	}
	if got := mustResponseDataMap(t, getResp)["value"]; got != "abc123" {
		t.Fatalf("kv.get value = %#v, want %q", got, "abc123")
	}

	listResp, handled := rt.dispatchFrontRequests(context.Background(), transport.Request{
		ID:   "req-kv-list",
		Type: "kv.list",
		Payload: mustJSON(t, map[string]any{
			"category": "auth",
		}),
	}, requestDispatchDeps{})
	if !handled || !listResp.Success {
		t.Fatalf("kv.list response = %#v", listResp)
	}
	entries, ok := mustResponseDataMap(t, listResp)["entries"].([]state.KVEntry)
	if !ok || len(entries) != 1 {
		t.Fatalf("kv.list entries = %#v, want one entry", mustResponseDataMap(t, listResp)["entries"])
	}
	if entries[0].Key != "token" || entries[0].Value != "abc123" {
		t.Fatalf("kv.list entry = %#v, want token=abc123", entries[0])
	}

	deleteResp, handled := rt.dispatchFrontRequests(context.Background(), transport.Request{
		ID:   "req-kv-delete",
		Type: "kv.delete",
		Payload: mustJSON(t, map[string]any{
			"key":      "token",
			"category": "auth",
		}),
	}, requestDispatchDeps{})
	if !handled || !deleteResp.Success {
		t.Fatalf("kv.delete response = %#v", deleteResp)
	}

	getAfterDeleteResp, handled := rt.dispatchFrontRequests(context.Background(), transport.Request{
		ID:   "req-kv-get-after-delete",
		Type: "kv.get",
		Payload: mustJSON(t, map[string]any{
			"key":      "token",
			"category": "auth",
		}),
	}, requestDispatchDeps{})
	if !handled || !getAfterDeleteResp.Success {
		t.Fatalf("kv.get after delete response = %#v", getAfterDeleteResp)
	}
	if got := mustResponseDataMap(t, getAfterDeleteResp)["value"]; got != nil {
		t.Fatalf("kv.get after delete value = %#v, want nil", got)
	}
}

func TestDispatchFrontRequestsSettingsRoundTrip(t *testing.T) {
	t.Setenv("CONSTRUCT_PROJECTS_ROOT", "")
	t.Setenv("MIMO_API_KEY", "")

	rt := newRequestHandlerTestRuntime(t, &requestHandlerTestProvider{
		id:     "test-provider",
		models: []string{"test-model"},
	})

	rootResp, handled := rt.dispatchFrontRequests(context.Background(), transport.Request{
		ID:   "req-settings-root",
		Type: "settings.set",
		Payload: mustJSON(t, map[string]any{
			"key":   "construct_projects_root",
			"value": "/tmp/projects-root",
		}),
	}, requestDispatchDeps{})
	if !handled || !rootResp.Success {
		t.Fatalf("settings.set root response = %#v", rootResp)
	}
	if got := os.Getenv("CONSTRUCT_PROJECTS_ROOT"); got != "/tmp/projects-root" {
		t.Fatalf("CONSTRUCT_PROJECTS_ROOT = %q, want %q", got, "/tmp/projects-root")
	}

	providerResp, handled := rt.dispatchFrontRequests(context.Background(), transport.Request{
		ID:   "req-settings-provider",
		Type: "settings.set",
		Payload: mustJSON(t, map[string]any{
			"key":   "provider_key:mimo",
			"value": "sk-test",
		}),
	}, requestDispatchDeps{})
	if !handled || !providerResp.Success {
		t.Fatalf("settings.set provider response = %#v", providerResp)
	}

	getResp, handled := rt.dispatchFrontRequests(context.Background(), transport.Request{
		ID:   "req-settings-get",
		Type: "settings.get",
		Payload: mustJSON(t, map[string]any{
			"key": "provider_key:mimo",
		}),
	}, requestDispatchDeps{})
	if !handled || !getResp.Success {
		t.Fatalf("settings.get response = %#v", getResp)
	}
	if got := mustResponseDataMap(t, getResp)["value"]; got != "sk-test" {
		t.Fatalf("settings.get value = %#v, want %q", got, "sk-test")
	}

	statusResp, handled := rt.dispatchFrontRequests(context.Background(), transport.Request{
		ID:   "req-settings-status",
		Type: "settings.provider_status",
	}, requestDispatchDeps{})
	if !handled || !statusResp.Success {
		t.Fatalf("settings.provider_status response = %#v", statusResp)
	}
	providers, ok := mustResponseDataMap(t, statusResp)["providers"].(map[string]bool)
	if !ok {
		t.Fatalf("settings.provider_status providers type = %T, want map[string]bool", mustResponseDataMap(t, statusResp)["providers"])
	}
	if !providers["mimo"] {
		t.Fatalf("settings.provider_status = %#v, want mimo enabled", providers)
	}
	if !runnerHasProvider(rt.runner.ListProviders(), "mimo") {
		t.Fatalf("runner providers = %#v, want mimo to be registered", rt.runner.ListProviders())
	}
}

func TestDispatchFrontRequestsProjectSettingsRoundTrip(t *testing.T) {
	rt := newRequestHandlerTestRuntime(t, &requestHandlerTestProvider{
		id:     "test-provider",
		models: []string{"test-model"},
	})

	setResp, handled := rt.dispatchFrontRequests(context.Background(), transport.Request{
		ID:   "req-project-settings-set",
		Type: "project_settings.set",
		Payload: mustJSON(t, map[string]any{
			"projectId":  42,
			"localPath":  "/tmp/project",
			"editorPath": "/Applications/Zed.app",
			"syncedAt":   "2026-03-28T00:00:00Z",
		}),
	}, requestDispatchDeps{})
	if !handled || !setResp.Success {
		t.Fatalf("project_settings.set response = %#v", setResp)
	}

	getResp, handled := rt.dispatchFrontRequests(context.Background(), transport.Request{
		ID:   "req-project-settings-get",
		Type: "project_settings.get",
		Payload: mustJSON(t, map[string]any{
			"projectId": 42,
		}),
	}, requestDispatchDeps{})
	if !handled || !getResp.Success {
		t.Fatalf("project_settings.get response = %#v", getResp)
	}
	settings, ok := getResp.Data.(state.ProjectSettings)
	if !ok {
		t.Fatalf("project_settings.get data type = %T, want state.ProjectSettings", getResp.Data)
	}
	if settings.ProjectID != 42 || settings.LocalPath != "/tmp/project" || settings.EditorPath != "/Applications/Zed.app" {
		t.Fatalf("project settings = %#v, want saved values", settings)
	}
}

func TestDispatchFrontRequestsPinnedRoundTrip(t *testing.T) {
	rt := newRequestHandlerTestRuntime(t, &requestHandlerTestProvider{
		id:     "test-provider",
		models: []string{"test-model"},
	})

	for _, item := range []state.PinnedItem{
		{ID: "a", Name: "Alpha", Type: "file", PinnedAt: "2026-03-28T00:00:00Z"},
		{ID: "b", Name: "Beta", Type: "file", PinnedAt: "2026-03-28T01:00:00Z"},
	} {
		resp, handled := rt.dispatchFrontRequests(context.Background(), transport.Request{
			ID:      "req-pinned-add-" + item.ID,
			Type:    "pinned.add",
			Payload: mustJSON(t, item),
		}, requestDispatchDeps{})
		if !handled || !resp.Success {
			t.Fatalf("pinned.add response = %#v", resp)
		}
	}

	reorderResp, handled := rt.dispatchFrontRequests(context.Background(), transport.Request{
		ID:   "req-pinned-reorder",
		Type: "pinned.reorder",
		Payload: mustJSON(t, map[string]any{
			"items": []state.PinnedOrder{
				{ID: "a", SortOrder: 2},
				{ID: "b", SortOrder: 1},
			},
		}),
	}, requestDispatchDeps{})
	if !handled || !reorderResp.Success {
		t.Fatalf("pinned.reorder response = %#v", reorderResp)
	}

	listResp, handled := rt.dispatchFrontRequests(context.Background(), transport.Request{
		ID:   "req-pinned-list",
		Type: "pinned.list",
	}, requestDispatchDeps{})
	if !handled || !listResp.Success {
		t.Fatalf("pinned.list response = %#v", listResp)
	}
	items, ok := mustResponseDataMap(t, listResp)["items"].([]state.PinnedItem)
	if !ok || len(items) != 2 {
		t.Fatalf("pinned.list items = %#v, want two items", mustResponseDataMap(t, listResp)["items"])
	}
	if items[0].ID != "b" || items[1].ID != "a" {
		t.Fatalf("pinned.list order = %#v, want b then a", items)
	}

	removeResp, handled := rt.dispatchFrontRequests(context.Background(), transport.Request{
		ID:   "req-pinned-remove",
		Type: "pinned.remove",
		Payload: mustJSON(t, map[string]any{
			"id": "b",
		}),
	}, requestDispatchDeps{})
	if !handled || !removeResp.Success {
		t.Fatalf("pinned.remove response = %#v", removeResp)
	}

	listAfterRemoveResp, handled := rt.dispatchFrontRequests(context.Background(), transport.Request{
		ID:   "req-pinned-list-after-remove",
		Type: "pinned.list",
	}, requestDispatchDeps{})
	if !handled || !listAfterRemoveResp.Success {
		t.Fatalf("pinned.list after remove response = %#v", listAfterRemoveResp)
	}
	itemsAfterRemove, ok := mustResponseDataMap(t, listAfterRemoveResp)["items"].([]state.PinnedItem)
	if !ok || len(itemsAfterRemove) != 1 || itemsAfterRemove[0].ID != "a" {
		t.Fatalf("pinned.list after remove items = %#v, want only a", mustResponseDataMap(t, listAfterRemoveResp)["items"])
	}
}

func TestDispatchFrontRequestsDesignsRoundTrip(t *testing.T) {
	rt := newRequestHandlerTestRuntime(t, &requestHandlerTestProvider{
		id:     "test-provider",
		models: []string{"test-model"},
	})
	projectID := 9

	saveResp, handled := rt.dispatchFrontRequests(context.Background(), transport.Request{
		ID:   "req-designs-save",
		Type: "designs.save",
		Payload: mustJSON(t, map[string]any{
			"local_id":      "landing-page",
			"project_id":    projectID,
			"name":          "Landing Page",
			"nodes":         json.RawMessage(`[{"id":"node-1"}]`),
			"pages_json":    `[{"id":"page-1"}]`,
			"viewport_json": `{"x":1}`,
			"history_json":  `[{"type":"init"}]`,
			"history_index": 2,
			"created_at":    "2026-03-28T00:00:00Z",
		}),
	}, requestDispatchDeps{})
	if !handled || !saveResp.Success {
		t.Fatalf("designs.save response = %#v", saveResp)
	}
	saveData := mustResponseDataMap(t, saveResp)
	if saveData["localId"] != "landing-page" {
		t.Fatalf("designs.save localId = %#v, want %q", saveData["localId"], "landing-page")
	}

	getResp, handled := rt.dispatchFrontRequests(context.Background(), transport.Request{
		ID:   "req-designs-get",
		Type: "designs.get",
		Payload: mustJSON(t, map[string]any{
			"localId": "landing-page",
		}),
	}, requestDispatchDeps{})
	if !handled || !getResp.Success {
		t.Fatalf("designs.get response = %#v", getResp)
	}
	designData := mustResponseDataMap(t, getResp)
	design, ok := designData["design"].(map[string]any)
	if !ok {
		t.Fatalf("designs.get design type = %T, want map[string]any", designData["design"])
	}
	if design["localId"] != "landing-page" || design["local_id"] != "landing-page" {
		t.Fatalf("designs.get design = %#v, want localId aliases", design)
	}
	if design["projectId"] != float64(projectID) && design["projectId"] != projectID {
		t.Fatalf("designs.get projectId = %#v, want %d", design["projectId"], projectID)
	}
	if design["nodes_json"] != `[{"id":"node-1"}]` {
		t.Fatalf("designs.get nodes_json = %#v, want saved nodes", design["nodes_json"])
	}

	listResp, handled := rt.dispatchFrontRequests(context.Background(), transport.Request{
		ID:   "req-designs-list",
		Type: "designs.list",
		Payload: mustJSON(t, map[string]any{
			"projectId": projectID,
		}),
	}, requestDispatchDeps{})
	if !handled || !listResp.Success {
		t.Fatalf("designs.list response = %#v", listResp)
	}
	designs, ok := mustResponseDataMap(t, listResp)["designs"].([]map[string]any)
	if !ok || len(designs) != 1 {
		t.Fatalf("designs.list items = %#v, want one design", mustResponseDataMap(t, listResp)["designs"])
	}

	deleteResp, handled := rt.dispatchFrontRequests(context.Background(), transport.Request{
		ID:   "req-designs-delete",
		Type: "designs.delete",
		Payload: mustJSON(t, map[string]any{
			"localId": "landing-page",
		}),
	}, requestDispatchDeps{})
	if !handled || !deleteResp.Success {
		t.Fatalf("designs.delete response = %#v", deleteResp)
	}

	getAfterDeleteResp, handled := rt.dispatchFrontRequests(context.Background(), transport.Request{
		ID:   "req-designs-get-after-delete",
		Type: "designs.get",
		Payload: mustJSON(t, map[string]any{
			"localId": "landing-page",
		}),
	}, requestDispatchDeps{})
	if !handled || !getAfterDeleteResp.Success {
		t.Fatalf("designs.get after delete response = %#v", getAfterDeleteResp)
	}
	if got := mustResponseDataMap(t, getAfterDeleteResp)["design"]; got != nil {
		t.Fatalf("designs.get after delete design = %#v, want nil", got)
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

func mustRawMessage(t *testing.T, value any) json.RawMessage {
	t.Helper()

	switch raw := value.(type) {
	case json.RawMessage:
		return raw
	case []byte:
		return json.RawMessage(raw)
	default:
		t.Fatalf("raw message type = %T, want json.RawMessage", value)
		return nil
	}
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
	rt.stateStore = state.NewStore(tempDir)
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

func runnerHasProvider(providers []map[string]any, id string) bool {
	for _, providerInfo := range providers {
		if providerID, _ := providerInfo["id"].(string); providerID == id {
			return true
		}
	}
	return false
}
