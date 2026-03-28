package main

import (
	"reflect"
	"testing"

	"construct-operator/internal/agent"
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
			name: "mode only",
			state: &clientContextState{Mode: "design"},
			want: map[string]any{"mode": "design"},
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
