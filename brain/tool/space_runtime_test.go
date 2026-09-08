package tool

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// When there's no frontend bridge, SpaceRunAction routes to the space-runtime.
func TestSpaceRunActionRoutesToRuntime(t *testing.T) {
	var gotBody map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/run" {
			http.Error(w, "nope", 404)
			return
		}
		b, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(b, &gotBody)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true,"result":{"events":[{"title":"X"}]}}`))
	}))
	defer srv.Close()

	// Bridge nil → router must use the runtime.
	tool := SpaceRunAction{Runtime: &SpaceRuntimeClient{URL: srv.URL, Token: "cat_test"}}
	in, _ := json.Marshal(map[string]any{"space": "calendar", "action": "listEvents", "args": map[string]any{"limit": 2}})
	out, err := tool.Execute(context.Background(), in)
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	if !strings.Contains(out, `"title":"X"`) {
		t.Fatalf("unexpected result: %s", out)
	}
	// Verify the router forwarded spaceId/action/token/params correctly.
	if gotBody["spaceId"] != "calendar" || gotBody["action"] != "listEvents" || gotBody["token"] != "cat_test" {
		t.Fatalf("bad forwarded body: %v", gotBody)
	}
	if p, ok := gotBody["params"].(map[string]any); !ok || p["limit"].(float64) != 2 {
		t.Fatalf("params not forwarded: %v", gotBody["params"])
	}
}

// With neither bridge nor runtime, it errors clearly (no silent no-op).
func TestSpaceRunActionNoExecutor(t *testing.T) {
	tool := SpaceRunAction{}
	in, _ := json.Marshal(map[string]any{"space": "calendar", "action": "listEvents"})
	if _, err := tool.Execute(context.Background(), in); err == nil {
		t.Fatal("expected error when no executor is available")
	}
}
