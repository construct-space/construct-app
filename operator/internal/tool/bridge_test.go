package tool

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"

	"testing"

	"construct-operator/internal/desktop"
)

func TestRegisterBridgeTools(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req desktop.Request
		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &req)

		var result any
		switch req.Method {
		case "space.snapshot":
			result = map[string]any{"space_id": "project", "title": "Test"}
		case "browser.tabs":
			result = map[string]any{"tabs": []any{}}
		default:
			json.NewEncoder(w).Encode(desktop.Response{
				ID:    req.ID,
				Error: &desktop.BridgeError{Code: "not_found", Message: "unknown"},
			})
			return
		}

		data, _ := json.Marshal(result)
		json.NewEncoder(w).Encode(desktop.Response{
			ID:     req.ID,
			Result: data,
		})
	}))
	defer srv.Close()

	bridge := &desktop.Client{}
	bridge.SetAddrForTest(srv.URL)
	bridge.SetTokenForTest("test")

	reg := NewRegistry()
	RegisterBridgeTools(reg, bridge)

	// Verify all expected tools are registered
	expectedTools := []string{
		"space_snapshot", "space_list_actions", "space_run_action",
		"browser_tabs", "browser_open", "browser_close", "browser_navigate",
		"browser_snapshot", "browser_click", "browser_type", "browser_press_key",
		"browser_wait_for", "browser_screenshot",
	}
	for _, name := range expectedTools {
		if _, ok := reg.Get(name); !ok {
			t.Errorf("expected tool %s to be registered", name)
		}
	}

	// Test execution
	tool, _ := reg.Get("space_snapshot")
	result, err := tool.Executor.Execute(context.Background(), `{"space_id":"project"}`)
	if err != nil {
		t.Fatal(err)
	}
	if result.IsError {
		t.Fatalf("unexpected error: %s", result.Content)
	}

	var snap struct {
		SpaceID string `json:"space_id"`
	}
	json.Unmarshal([]byte(result.Content), &snap)
	if snap.SpaceID != "project" {
		t.Errorf("expected space_id project, got %s", snap.SpaceID)
	}
}

func TestBridgeToolNilClient(t *testing.T) {
	reg := NewRegistry()
	RegisterBridgeTools(reg, nil)
	if len(reg.All()) != 0 {
		t.Error("expected no tools registered with nil bridge")
	}
}

func TestBridgeToolError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req desktop.Request
		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &req)

		json.NewEncoder(w).Encode(desktop.Response{
			ID:    req.ID,
			Error: &desktop.BridgeError{Code: "no_target", Message: "No active space"},
		})
	}))
	defer srv.Close()

	bridge := &desktop.Client{}
	bridge.SetAddrForTest(srv.URL)
	bridge.SetTokenForTest("test")

	reg := NewRegistry()
	RegisterBridgeTools(reg, bridge)

	tool, _ := reg.Get("space_snapshot")
	result, err := tool.Executor.Execute(context.Background(), `{}`)
	if err != nil {
		t.Fatal(err)
	}
	if !result.IsError {
		t.Error("expected error result")
	}
}

func TestRegisterSpaceActionToolsInstant(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req desktop.Request
		body, _ := io.ReadAll(r.Body)
		json.Unmarshal(body, &req)

		if req.Method != "space.list_actions" {
			json.NewEncoder(w).Encode(desktop.Response{
				ID:    req.ID,
				Error: &desktop.BridgeError{Code: "not_found", Message: "unknown"},
			})
			return
		}

		data, _ := json.Marshal(map[string]any{
			"space_id": "canvas",
			"actions": []map[string]any{
				{
					"id":          "list_cards",
					"description": "List cards",
					"params": map[string]any{
						"type":       "object",
						"properties": map[string]any{},
					},
				},
			},
		})
		json.NewEncoder(w).Encode(desktop.Response{
			ID:     req.ID,
			Result: data,
		})
	}))
	defer srv.Close()

	bridge := &desktop.Client{}
	bridge.SetAddrForTest(srv.URL)
	bridge.SetTokenForTest("test")

	reg := NewRegistry()
	RegisterSpaceActionTools(reg, bridge, []string{"canvas"})

	if _, ok := reg.Get("canvas.list_cards"); !ok {
		t.Fatal("expected canvas.list_cards to be registered")
	}
}
