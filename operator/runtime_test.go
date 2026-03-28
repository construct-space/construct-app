package main

import (
	"context"
	"reflect"
	"testing"
	"time"

	"construct-operator/internal/agent"
	"construct-operator/internal/oauth"
	"construct-operator/internal/runner"
	"construct-operator/internal/transport"
)

func TestClientKey(t *testing.T) {
	tests := []struct {
		name     string
		clientID string
		want     string
	}{
		{name: "empty client id uses default", clientID: "", want: "default"},
		{name: "non-empty client id preserved", clientID: "client-123", want: "client-123"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := clientKey(tt.clientID); got != tt.want {
				t.Fatalf("clientKey(%q) = %q, want %q", tt.clientID, got, tt.want)
			}
		})
	}
}

func TestRunnerContextFromClientState(t *testing.T) {
	tests := []struct {
		name  string
		state *clientContextState
		want  map[string]any
	}{
		{name: "nil state returns nil"},
		{name: "empty state returns nil", state: &clientContextState{}},
		{
			name:  "mode only",
			state: &clientContextState{Mode: "design"},
			want:  map[string]any{"mode": "design"},
		},
		{
			name: "component and selection are cloned",
			state: &clientContextState{
				Mode:      "code",
				Component: map[string]any{"name": "Header", "type": "component"},
				Selection: map[string]any{"type": "file", "path": "main.go"},
			},
			want: map[string]any{
				"mode":      "code",
				"component": map[string]any{"name": "Header", "type": "component"},
				"selection": map[string]any{"type": "file", "path": "main.go"},
			},
		},
		{
			name: "empty maps are omitted",
			state: &clientContextState{
				Mode:      "code",
				Component: map[string]any{},
				Selection: map[string]any{},
			},
			want: map[string]any{"mode": "code"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := runnerContextFromClientState(tt.state)
			if !reflect.DeepEqual(got, tt.want) {
				t.Fatalf("runnerContextFromClientState() = %#v, want %#v", got, tt.want)
			}
			if tt.state != nil && got != nil {
				if component, ok := got["component"].(map[string]any); ok && len(component) > 0 {
					component["name"] = "Mutated"
					if tt.state.Component["name"] == "Mutated" {
						t.Fatal("component map was not cloned")
					}
				}
				if selection, ok := got["selection"].(map[string]any); ok && len(selection) > 0 {
					selection["type"] = "mutated"
					if tt.state.Selection["type"] == "mutated" {
						t.Fatal("selection map was not cloned")
					}
				}
			}
		})
	}
}

func TestResolveAgent(t *testing.T) {
	fallback := &agent.Config{ID: "general"}
	vibe := &agent.Config{ID: "vibe"}
	spaceVibe := &agent.Config{ID: "space:vibe"}
	spaceDesigner := &agent.Config{ID: "space:designer"}
	architect := &agent.Config{ID: "architect"}
	agents := []*agent.Config{vibe, architect, spaceVibe, spaceDesigner}

	tests := []struct {
		name string
		id   string
		want *agent.Config
	}{
		{name: "default prefers latest vibe variant", id: "", want: spaceVibe},
		{name: "plain id resolves namespaced agent", id: "designer", want: spaceDesigner},
		{name: "space id resolves directly", id: "space:designer", want: spaceDesigner},
		{name: "general falls back", id: "general", want: fallback},
		{name: "unknown agent returns nil", id: "missing", want: nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := resolveAgent(agents, fallback, tt.id); got != tt.want {
				gotID := "<nil>"
				if got != nil {
					gotID = got.ID
				}
				wantID := "<nil>"
				if tt.want != nil {
					wantID = tt.want.ID
				}
				t.Fatalf("resolveAgent(%q) = %s, want %s", tt.id, gotID, wantID)
			}
		})
	}
}

func TestOperatorRuntimeProjectLookup(t *testing.T) {
	project := &runner.ProjectContext{Name: "Alpha", RootPath: "/tmp/alpha"}
	override := &runner.ProjectContext{Name: "Override", RootPath: "/tmp/override"}
	rt := newOperatorRuntime("/tmp/workdir")
	rt.setProject("client-1", project)

	ctx := transport.WithClientID(context.Background(), "client-1")
	if got := rt.projectContext(ctx); got != project {
		t.Fatalf("projectContext() = %#v, want %#v", got, project)
	}
	if got := rt.projectDir(ctx); got != project.RootPath {
		t.Fatalf("projectDir() = %q, want %q", got, project.RootPath)
	}

	overrideCtx := withProjectOverride(ctx, override)
	if got := rt.projectContext(overrideCtx); got != override {
		t.Fatalf("projectContext() with override = %#v, want %#v", got, override)
	}
	if got := rt.projectDir(overrideCtx); got != override.RootPath {
		t.Fatalf("projectDir() with override = %q, want %q", got, override.RootPath)
	}

	defaultCtx := transport.WithClientID(context.Background(), "missing")
	if got := rt.projectDir(defaultCtx); got != rt.workDir {
		t.Fatalf("projectDir() fallback = %q, want %q", got, rt.workDir)
	}
}

func TestOperatorRuntimeRunnerContext(t *testing.T) {
	component := map[string]any{"name": "Header", "type": "component"}
	selection := map[string]any{"type": "file", "path": "main.go"}
	rt := newOperatorRuntime("/tmp/workdir")
	rt.clientContexts["client-1"] = &clientContextState{
		Mode:      "code",
		Component: component,
		Selection: selection,
	}

	ctx := transport.WithClientID(context.Background(), "client-1")
	got := rt.runnerContext(ctx)
	want := map[string]any{
		"mode":      "code",
		"component": map[string]any{"name": "Header", "type": "component"},
		"selection": map[string]any{"type": "file", "path": "main.go"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("runnerContext() = %#v, want %#v", got, want)
	}

	gotComponent := got["component"].(map[string]any)
	gotComponent["name"] = "Mutated"
	if component["name"] == "Mutated" {
		t.Fatal("runnerContext() did not clone component map")
	}

	gotSelection := got["selection"].(map[string]any)
	gotSelection["type"] = "mutated"
	if selection["type"] == "mutated" {
		t.Fatal("runnerContext() did not clone selection map")
	}
}

func TestOperatorRuntimeResolveAgent(t *testing.T) {
	fallback := &agent.Config{ID: "general"}
	vibe := &agent.Config{ID: "vibe"}
	spaceVibe := &agent.Config{ID: "space:vibe"}
	spaceDesigner := &agent.Config{ID: "space:designer"}
	architect := &agent.Config{ID: "architect"}
	rt := newOperatorRuntime("/tmp/workdir")
	rt.agents = []*agent.Config{vibe, architect, spaceVibe, spaceDesigner}
	rt.fallbackAgent = fallback

	tests := []struct {
		name string
		id   string
		want *agent.Config
	}{
		{name: "default prefers latest vibe variant", id: "", want: spaceVibe},
		{name: "plain id resolves namespaced agent", id: "designer", want: spaceDesigner},
		{name: "space id resolves directly", id: "space:designer", want: spaceDesigner},
		{name: "general falls back", id: "general", want: fallback},
		{name: "unknown agent returns nil", id: "missing", want: nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := rt.resolveAgent(tt.id); got != tt.want {
				gotID := "<nil>"
				if got != nil {
					gotID = got.ID
				}
				wantID := "<nil>"
				if tt.want != nil {
					wantID = tt.want.ID
				}
				t.Fatalf("resolveAgent(%q) = %s, want %s", tt.id, gotID, wantID)
			}
		})
	}
}

func TestOperatorRuntimeContextMutations(t *testing.T) {
	rt := newOperatorRuntime("/tmp/workdir")

	project := &runner.ProjectContext{Name: "Alpha", RootPath: "/tmp/alpha"}
	rt.setProject("client-1", project)
	if got := rt.activeProjects["client-1"]; got != project {
		t.Fatalf("setProject() stored %#v, want %#v", got, project)
	}

	component := map[string]any{"name": "Header"}
	selection := map[string]any{"type": "file"}
	rt.setClientMode("client-1", "design")
	rt.setClientComponent("client-1", component)
	rt.setClientSelection("client-1", selection)

	state := rt.clientContexts["client-1"]
	if state == nil {
		t.Fatal("client state was not initialized")
	}
	if state.Mode != "design" {
		t.Fatalf("mode = %q, want %q", state.Mode, "design")
	}
	if state.Timestamp == "" {
		t.Fatal("timestamp was not updated")
	}
	if !reflect.DeepEqual(state.Component, component) {
		t.Fatalf("component = %#v, want %#v", state.Component, component)
	}
	if !reflect.DeepEqual(state.Selection, selection) {
		t.Fatalf("selection = %#v, want %#v", state.Selection, selection)
	}

	component["name"] = "Mutated"
	if state.Component["name"] == "Mutated" {
		t.Fatal("setClientComponent() did not clone payload")
	}
	selection["type"] = "mutated"
	if state.Selection["type"] == "mutated" {
		t.Fatal("setClientSelection() did not clone payload")
	}

	rt.clearProject("client-1")
	if got := rt.activeProjects["client-1"]; got != nil {
		t.Fatalf("clearProject() left %#v", got)
	}
}

func TestOperatorRuntimeContextDataDefault(t *testing.T) {
	rt := newOperatorRuntime("/tmp/workdir")

	data := rt.contextData(context.Background())
	if got := data["workDir"]; got != "/tmp/workdir" {
		t.Fatalf("workDir = %#v, want %q", got, "/tmp/workdir")
	}
	if got := data["mode"]; got != "code" {
		t.Fatalf("mode = %#v, want %q", got, "code")
	}
	timestamp, ok := data["timestamp"].(string)
	if !ok || timestamp == "" {
		t.Fatalf("timestamp = %#v, want non-empty string", data["timestamp"])
	}
	if _, err := time.Parse(time.RFC3339, timestamp); err != nil {
		t.Fatalf("timestamp parse error: %v", err)
	}
	if _, ok := data["project"]; ok {
		t.Fatalf("project = %#v, want omitted", data["project"])
	}
	if _, ok := data["component"]; ok {
		t.Fatalf("component = %#v, want omitted", data["component"])
	}
	if _, ok := data["selection"]; ok {
		t.Fatalf("selection = %#v, want omitted", data["selection"])
	}
}

func TestOperatorRuntimeContextDataUsesClientState(t *testing.T) {
	rt := newOperatorRuntime("/tmp/workdir")
	rt.clientContexts["client-1"] = &clientContextState{
		Mode:      "design",
		Component: map[string]any{"name": "Header", "type": "component"},
		Selection: map[string]any{"type": "file", "path": "main.go"},
		Timestamp: "2025-01-02T03:04:05Z",
	}

	ctx := transport.WithClientID(context.Background(), "client-1")
	data := rt.contextData(ctx)
	want := map[string]any{
		"workDir":   "/tmp/workdir",
		"mode":      "design",
		"component": map[string]any{"name": "Header", "type": "component"},
		"selection": map[string]any{"type": "file", "path": "main.go"},
		"timestamp": "2025-01-02T03:04:05Z",
	}
	if !reflect.DeepEqual(data, want) {
		t.Fatalf("contextData() = %#v, want %#v", data, want)
	}
}

func TestOperatorRuntimeContextDataProjectOverridePrecedence(t *testing.T) {
	rt := newOperatorRuntime("/tmp/workdir")
	rt.setProject("client-1", &runner.ProjectContext{Name: "Stored", RootPath: "/tmp/stored"})

	override := &runner.ProjectContext{Name: "Override", RootPath: "/tmp/override"}
	ctx := withProjectOverride(transport.WithClientID(context.Background(), "client-1"), override)

	data := rt.contextData(ctx)
	if got := data["workDir"]; got != override.RootPath {
		t.Fatalf("workDir = %#v, want %q", got, override.RootPath)
	}
	if got := data["project"]; got != override {
		t.Fatalf("project = %#v, want %#v", got, override)
	}
}

func TestOperatorRuntimePendingDeviceFlowLifecycle(t *testing.T) {
	rt := newOperatorRuntime("/tmp/workdir")
	state := &oauth.DeviceFlowState{
		Domain:          "github.com",
		DeviceCode:      "device",
		UserCode:        "code",
		VerificationURI: "https://github.com/login/device",
	}

	rt.setPendingDeviceFlow("github-copilot", state)
	got, ok := rt.pendingDeviceFlow("github-copilot")
	if !ok || got != state {
		t.Fatalf("pendingDeviceFlow() = (%#v, %v), want (%#v, true)", got, ok, state)
	}

	rt.clearPendingDeviceFlow("github-copilot")
	got, ok = rt.pendingDeviceFlow("github-copilot")
	if ok || got != nil {
		t.Fatalf("pendingDeviceFlow() after clear = (%#v, %v), want (nil, false)", got, ok)
	}
}

func TestOperatorRuntimePendingOAuthFlowLifecycle(t *testing.T) {
	rt := newOperatorRuntime("/tmp/workdir")
	resultCh := make(chan pendingOAuthResult, 1)

	rt.setPendingOAuthFlow("anthropic", resultCh)
	got, ok := rt.pendingOAuthFlow("anthropic")
	if !ok || got != resultCh {
		t.Fatalf("pendingOAuthFlow() = (%#v, %v), want (%#v, true)", got, ok, resultCh)
	}

	rt.clearPendingOAuthFlow("anthropic")
	got, ok = rt.pendingOAuthFlow("anthropic")
	if ok || got != nil {
		t.Fatalf("pendingOAuthFlow() after clear = (%#v, %v), want (nil, false)", got, ok)
	}
}
