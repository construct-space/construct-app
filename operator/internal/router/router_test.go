package router

import (
	"context"
	"strings"
	"testing"

	"construct-operator/internal/agent"
	"construct-operator/internal/provider"
)

func makeAgents() map[string]*agent.Config {
	return map[string]*agent.Config{
		"general":    {ID: "general", Name: "General", Description: "General-purpose"},
		"architect":  {ID: "architect", Name: "Architect", Description: "Plans projects"},
		"coder":      {ID: "coder", Name: "Coder", Description: "Writes code"},
		"brainstorm": {ID: "brainstorm", Name: "Chat", Description: "Brainstorm ideas"},
		"reviewer":   {ID: "reviewer", Name: "Reviewer", Description: "Reviews code"},
		"designer":   {ID: "designer", Name: "Designer", Description: "Designs UI"},
		"space":      {ID: "space", Name: "Space", Description: "Manages Construct spaces"},
	}
}

func newRouterWithAgents() *Router {
	r := New()
	for _, a := range makeAgents() {
		r.Register(a)
	}
	return r
}

// ── Phase 0: Deterministic prefix routing ──

func TestRoutePrefixMatch(t *testing.T) {
	r := newRouterWithAgents()
	ctx := context.Background()

	tests := []struct {
		name string
		task string
		want string
	}{
		{"architect prefix", "[architect] plan the API", "architect"},
		{"generate_plan prefix", "[generate_plan] database schema", "architect"},
		{"code prefix", "[code] implement the login page", "coder"},
		{"implement prefix", "[implement] the auth flow", "coder"},
		{"brainstorm prefix", "[brainstorm] explore ideas for dashboard", "brainstorm"},
		{"review prefix", "[review] check this PR", "reviewer"},
		{"design prefix", "[design] create a dashboard", "designer"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := r.Route(ctx, tt.task)
			if got == nil || got.ID != tt.want {
				gotID := "nil"
				if got != nil {
					gotID = got.ID
				}
				t.Errorf("Route(%q) = %s, want %s", tt.task, gotID, tt.want)
			}
		})
	}
}

// ── Phase 1: Active context priority routing ──

func TestRouteActiveContextPriority(t *testing.T) {
	r := newRouterWithAgents()
	ctx := context.Background()

	tests := []struct {
		name          string
		task          string
		activeContext string
		want          string
	}{
		{
			name:          "ambiguous query routes to active context agent",
			task:          "help me with this",
			activeContext: "coder",
			want:          "coder",
		},
		{
			name:          "ambiguous query routes to architect when active",
			task:          "what should I do next",
			activeContext: "architect",
			want:          "architect",
		},
		{
			name:          "strong specialist keyword overrides active context",
			task:          "fix the login bug",
			activeContext: "architect",
			want:          "coder",
		},
		{
			name:          "space pattern overrides active context",
			task:          "create a space for HR management",
			activeContext: "coder",
			want:          "space",
		},
		{
			name:          "empty active context falls through to keywords",
			task:          "fix the bug",
			activeContext: "",
			want:          "coder",
		},
		{
			name:          "unknown active context is ignored",
			task:          "help me",
			activeContext: "nonexistent",
			want:          "general",
		},
		{
			name:          "prefix tag always wins over active context",
			task:          "[code] implement the plan",
			activeContext: "architect",
			want:          "coder",
		},
		{
			name:          "active context coder with non-competing task",
			task:          "explain this function",
			activeContext: "coder",
			want:          "coder",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := r.RouteWithContext(ctx, tt.task, tt.activeContext)
			if got == nil || got.ID != tt.want {
				gotID := "nil"
				if got != nil {
					gotID = got.ID
				}
				t.Errorf("RouteWithContext(%q, %q) = %s, want %s", tt.task, tt.activeContext, gotID, tt.want)
			}
		})
	}
}

// ── Phase 2: Specialist keyword routing ──

func TestRouteSpecialistKeywords(t *testing.T) {
	r := newRouterWithAgents()
	ctx := context.Background()

	tests := []struct {
		name string
		task string
		want string
	}{
		// Coder keywords
		{"fix keyword", "fix the login bug", "coder"},
		{"debug keyword", "debug the API endpoint", "coder"},
		{"build keyword", "build the dashboard component", "coder"},
		{"implement keyword", "implement user authentication", "coder"},
		{"refactor keyword", "refactor the payment module", "coder"},
		{"code keyword", "code the signup flow", "coder"},

		// Architect keywords
		{"plan keyword", "plan the project structure", "architect"},
		{"architecture keyword", "architecture for the new service", "architect"},

		// Brainstorm keywords
		{"brainstorm keyword", "brainstorm ideas for the landing page", "brainstorm"},
		{"explore keyword", "explore different approaches", "brainstorm"},
		{"what if keyword", "what if we use GraphQL instead", "brainstorm"},
		{"ideas keyword", "ideas for improving the dashboard", "brainstorm"},

		// Space patterns
		{"create space", "create a space for project management", "space"},
		{"scaffold space", "scaffold space for analytics", "space"},
		{"build space", "build space bundle", "space"},
		{"validate space", "validate space manifest", "space"},

		// Fallback
		{"no keywords match", "what is the meaning of life", "general"},
		{"greeting", "hello there", "general"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := r.Route(ctx, tt.task)
			if got == nil || got.ID != tt.want {
				gotID := "nil"
				if got != nil {
					gotID = got.ID
				}
				t.Errorf("Route(%q) = %s, want %s", tt.task, gotID, tt.want)
			}
		})
	}
}

// ── Deterministic architect → coder handoff ──

func TestArchitectToCoderHandoff(t *testing.T) {
	r := newRouterWithAgents()

	tests := []struct {
		name string
		fn   func() *agent.Config
		want string
	}{
		{
			name: "ArchitectToCoderHandoff returns coder",
			fn:   r.ArchitectToCoderHandoff,
			want: "coder",
		},
		{
			name: "DeterministicHandoff architect to coder",
			fn:   func() *agent.Config { return r.DeterministicHandoff("architect", "coder") },
			want: "coder",
		},
		{
			name: "DeterministicHandoff project to architect",
			fn:   func() *agent.Config { return r.DeterministicHandoff("project", "architect") },
			want: "architect",
		},
		{
			name: "DeterministicHandoff to nonexistent returns nil",
			fn:   func() *agent.Config { return r.DeterministicHandoff("architect", "nonexistent") },
			want: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.fn()
			if tt.want == "" {
				if got != nil {
					t.Errorf("expected nil, got %s", got.ID)
				}
				return
			}
			if got == nil || got.ID != tt.want {
				gotID := "nil"
				if got != nil {
					gotID = got.ID
				}
				t.Errorf("got %s, want %s", gotID, tt.want)
			}
		})
	}
}

// ── Prefix-based handoff via Route (end-to-end) ──

func TestArchitectCoderHandoffViaPrefix(t *testing.T) {
	r := newRouterWithAgents()
	ctx := context.Background()

	// Simulate architect finishing and handing off to coder with a [code] prefix
	task := "[code] implement the authentication module based on the plan"
	got := r.Route(ctx, task)
	if got == nil || got.ID != "coder" {
		gotID := "nil"
		if got != nil {
			gotID = got.ID
		}
		t.Errorf("architect→coder handoff via prefix: got %s, want coder", gotID)
	}

	// Reverse: coder spawning architect with [architect] prefix
	task = "[architect] plan the database schema"
	got = r.Route(ctx, task)
	if got == nil || got.ID != "architect" {
		gotID := "nil"
		if got != nil {
			gotID = got.ID
		}
		t.Errorf("coder→architect handoff via prefix: got %s, want architect", gotID)
	}
}

// ── General fallback ──

func TestRouteFallbackToGeneral(t *testing.T) {
	r := newRouterWithAgents()
	ctx := context.Background()

	tests := []struct {
		task string
	}{
		{"what is the meaning of life"},
		{"hello"},
		{"tell me a joke"},
		{"how are you today"},
	}

	for _, tt := range tests {
		t.Run(tt.task, func(t *testing.T) {
			got := r.Route(ctx, tt.task)
			if got == nil || got.ID != "general" {
				gotID := "nil"
				if got != nil {
					gotID = got.ID
				}
				t.Errorf("Route(%q) = %s, want general", tt.task, gotID)
			}
		})
	}
}

// ── Registry: Get and List ──

func TestGetAndList(t *testing.T) {
	r := newRouterWithAgents()
	agents := makeAgents()

	t.Run("Get existing agent", func(t *testing.T) {
		a, ok := r.Get("architect")
		if !ok || a.ID != "architect" {
			t.Fatal("should find architect")
		}
	})

	t.Run("Get nonexistent agent", func(t *testing.T) {
		_, ok := r.Get("nonexistent")
		if ok {
			t.Fatal("should not find nonexistent")
		}
	})

	t.Run("List returns all agents", func(t *testing.T) {
		list := r.List()
		if len(list) != len(agents) {
			t.Fatalf("expected %d agents, got %d", len(agents), len(list))
		}
	})
}

// ── Handoff context ──

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
	if !strings.Contains(prompt, "Handoff from architect") {
		t.Fatal("should mention parent agent")
	}
	if !strings.Contains(prompt, "implement the plan") {
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

// ── hasStrongSpecialistMatch ──

func TestHasStrongSpecialistMatch(t *testing.T) {
	r := newRouterWithAgents()

	tests := []struct {
		name          string
		task          string
		activeContext string
		want          bool
	}{
		{"fix is strong for architect context", "fix the bug", "architect", true},
		{"fix is not strong for coder context", "fix the bug", "coder", false},
		{"create space is strong for coder context", "create a space", "coder", true},
		{"create space is not strong for space context", "create a space", "space", false},
		{"no keywords no match", "hello world", "coder", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := r.hasStrongSpecialistMatch(strings.ToLower(tt.task), tt.activeContext)
			if got != tt.want {
				t.Errorf("hasStrongSpecialistMatch(%q, %q) = %v, want %v", tt.task, tt.activeContext, got, tt.want)
			}
		})
	}
}
