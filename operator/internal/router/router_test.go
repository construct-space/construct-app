package router

import (
	"context"
	"testing"

	"construct-operator/internal/agent"
	"construct-operator/internal/provider"
)

func makeAgents() map[string]*agent.Config {
	return map[string]*agent.Config{
		"general":   {ID: "general", Name: "General", Description: "General-purpose"},
		"architect": {ID: "architect", Name: "Architect", Description: "Plans projects"},
		"coder":     {ID: "coder", Name: "Coder", Description: "Writes code"},
		"reviewer":  {ID: "reviewer", Name: "Reviewer", Description: "Reviews code"},
		"designer":  {ID: "designer", Name: "Designer", Description: "Designs UI"},
	}
}

func TestRoutePrefixMatch(t *testing.T) {
	r := New()
	for _, a := range makeAgents() {
		r.Register(a)
	}

	tests := []struct {
		task string
		want string
	}{
		{"[architect] plan the API", "architect"},
		{"[generate_plan] database schema", "architect"},
		{"[code] implement the login page", "coder"},
		{"[review] check this PR", "reviewer"},
		{"[design] create a dashboard", "designer"},
	}

	ctx := context.Background()
	for _, tt := range tests {
		got := r.Route(ctx, tt.task)
		if got == nil || got.ID != tt.want {
			gotID := "nil"
			if got != nil {
				gotID = got.ID
			}
			t.Errorf("Route(%q) = %s, want %s", tt.task, gotID, tt.want)
		}
	}
}

func TestRouteKeywordMatch(t *testing.T) {
	r := New()
	for _, a := range makeAgents() {
		r.Register(a)
	}

	ctx := context.Background()
	got := r.Route(ctx, "fix the login bug")
	if got == nil || got.ID != "coder" {
		t.Errorf("expected coder for 'fix the login bug', got %v", got)
	}
}

func TestRouteFallbackToGeneral(t *testing.T) {
	r := New()
	for _, a := range makeAgents() {
		r.Register(a)
	}

	ctx := context.Background()
	got := r.Route(ctx, "what is the meaning of life")
	if got == nil || got.ID != "general" {
		t.Errorf("expected general for unknown task, got %v", got)
	}
}

func TestGetAndList(t *testing.T) {
	r := New()
	agents := makeAgents()
	for _, a := range agents {
		r.Register(a)
	}

	a, ok := r.Get("architect")
	if !ok || a.ID != "architect" {
		t.Fatal("should find architect")
	}

	_, ok = r.Get("nonexistent")
	if ok {
		t.Fatal("should not find nonexistent")
	}

	list := r.List()
	if len(list) != len(agents) {
		t.Fatalf("expected %d agents, got %d", len(agents), len(list))
	}
}

func TestBuildHandoff(t *testing.T) {
	messages := []provider.Message{
		{Role: "user", Content: "build a login page"},
		{Role: "assistant", Content: "I'll create the login component"},
	}

	h := BuildHandoff("general", messages, "implement auth")
	if h.ParentAgentID != "general" {
		t.Fatalf("expected parent %q, got %q", "general", h.ParentAgentID)
	}
	if h.Task != "implement auth" {
		t.Fatalf("expected task %q, got %q", "implement auth", h.Task)
	}
	if len(h.ParentMessages) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(h.ParentMessages))
	}
}

func TestHandoffToSystemPrompt(t *testing.T) {
	h := BuildHandoff("architect", []provider.Message{
		{Role: "user", Content: "plan the API"},
	}, "implement the plan")

	prompt := HandoffToSystemPrompt(h)
	if prompt == "" {
		t.Fatal("prompt should not be empty")
	}
	if !contains(prompt, "Handoff from architect") {
		t.Fatal("should mention parent agent")
	}
	if !contains(prompt, "implement the plan") {
		t.Fatal("should mention original task")
	}
}

func TestHandoffToSystemPromptNil(t *testing.T) {
	prompt := HandoffToSystemPrompt(nil)
	if prompt != "" {
		t.Fatal("nil handoff should produce empty prompt")
	}
}

func TestHandoffTruncatesMessages(t *testing.T) {
	var messages []provider.Message
	for i := 0; i < 20; i++ {
		messages = append(messages, provider.Message{Role: "user", Content: "message"})
	}

	h := BuildHandoff("general", messages, "task")
	if len(h.ParentMessages) != 10 {
		t.Fatalf("expected 10 messages (truncated), got %d", len(h.ParentMessages))
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && searchString(s, sub)
}

func searchString(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
