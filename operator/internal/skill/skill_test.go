package skill

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRegistryRegisterAndGet(t *testing.T) {
	reg := NewRegistry()
	reg.Register(&Skill{ID: "test", Name: "Test Skill", Prompt: "do something"})

	s, ok := reg.Get("test")
	if !ok || s.Name != "Test Skill" {
		t.Fatal("should find registered skill")
	}

	_, ok = reg.Get("nonexistent")
	if ok {
		t.Fatal("should not find nonexistent skill")
	}
}

func TestRegistryAll(t *testing.T) {
	reg := NewRegistry()
	reg.Register(&Skill{ID: "a"})
	reg.Register(&Skill{ID: "b"})
	reg.Register(&Skill{ID: "c"})

	if len(reg.All()) != 3 {
		t.Fatalf("expected 3 skills, got %d", len(reg.All()))
	}
}

func TestMatchKeyword(t *testing.T) {
	reg := NewRegistry()
	reg.Register(&Skill{ID: "commit", Trigger: "commit,/commit"})
	reg.Register(&Skill{ID: "review", Trigger: "review"})
	reg.Register(&Skill{ID: "test", Trigger: "test,write tests"})

	matches := reg.Match("please commit this code")
	if len(matches) != 1 || matches[0].ID != "commit" {
		t.Fatalf("expected commit, got %v", matches)
	}

	matches = reg.Match("write tests for the auth module")
	if len(matches) != 1 || matches[0].ID != "test" {
		t.Fatalf("expected test, got %v", matches)
	}
}

func TestMatchRegex(t *testing.T) {
	reg := NewRegistry()
	reg.Register(&Skill{ID: "fix", Trigger: `fix\s+(bug|issue)`})

	matches := reg.Match("fix bug in login")
	if len(matches) != 1 || matches[0].ID != "fix" {
		t.Fatal("should match regex trigger")
	}

	matches = reg.Match("fix the typo")
	if len(matches) != 0 {
		t.Fatal("should not match 'fix the typo'")
	}
}

func TestMatchNoTrigger(t *testing.T) {
	reg := NewRegistry()
	reg.Register(&Skill{ID: "manual", Trigger: ""})

	matches := reg.Match("anything")
	if len(matches) != 0 {
		t.Fatal("skills without triggers should not match")
	}
}

func TestExpand(t *testing.T) {
	s := &Skill{
		Prompt: "Project: {{project.name}}, Framework: {{project.framework}}, Task: {{task}}",
	}

	result := s.Expand(context.Background(), map[string]any{
		"task": "build login",
		"project": map[string]any{
			"name":      "my-app",
			"framework": "Vue 3",
		},
	})

	if result != "Project: my-app, Framework: Vue 3, Task: build login" {
		t.Fatalf("unexpected expansion: %q", result)
	}
}

func TestExpandNoVars(t *testing.T) {
	s := &Skill{Prompt: "just plain text"}
	result := s.Expand(context.Background(), nil)
	if result != "just plain text" {
		t.Fatalf("expected unchanged prompt, got %q", result)
	}
}

func TestLoadFromDir(t *testing.T) {
	dir := t.TempDir()

	// Create a skill file
	content := `---
id: my-skill
name: My Skill
description: Does something cool
trigger: cool,awesome
category: custom
tools:
  - bash
  - read_file
---

Do the cool thing with {{task}}.

Steps:
1. Read the file
2. Process it
3. Done`

	os.WriteFile(filepath.Join(dir, "my-skill.md"), []byte(content), 0644)

	skills, err := LoadFromDir(dir, "test")
	if err != nil {
		t.Fatalf("LoadFromDir failed: %v", err)
	}
	if len(skills) != 1 {
		t.Fatalf("expected 1 skill, got %d", len(skills))
	}

	s := skills[0]
	if s.ID != "my-skill" {
		t.Fatalf("expected ID %q, got %q", "my-skill", s.ID)
	}
	if s.Name != "My Skill" {
		t.Fatalf("expected name %q, got %q", "My Skill", s.Name)
	}
	if s.Trigger != "cool,awesome" {
		t.Fatalf("expected trigger %q, got %q", "cool,awesome", s.Trigger)
	}
	if len(s.Tools) != 2 {
		t.Fatalf("expected 2 tools, got %d", len(s.Tools))
	}
	if s.Source != "test" {
		t.Fatalf("expected source %q, got %q", "test", s.Source)
	}
	if !containsStr(s.Prompt, "Do the cool thing") {
		t.Fatal("prompt should contain body text")
	}
}

func TestLoadFromDirNotFound(t *testing.T) {
	skills, err := LoadFromDir("/nonexistent/path", "test")
	if err != nil {
		t.Fatalf("should not error on missing dir: %v", err)
	}
	if skills != nil {
		t.Fatal("should return nil for missing dir")
	}
}

func TestLoadFromDirIDFallback(t *testing.T) {
	dir := t.TempDir()

	// Skill without ID in frontmatter — should use filename
	content := `---
name: Unnamed
description: No ID specified
---

Do stuff.`

	os.WriteFile(filepath.Join(dir, "auto-id.md"), []byte(content), 0644)

	skills, err := LoadFromDir(dir, "test")
	if err != nil {
		t.Fatalf("LoadFromDir failed: %v", err)
	}
	if len(skills) != 1 {
		t.Fatalf("expected 1 skill, got %d", len(skills))
	}
	if skills[0].ID != "auto-id" {
		t.Fatalf("expected ID %q, got %q", "auto-id", skills[0].ID)
	}
}

func TestBuiltinSkills(t *testing.T) {
	reg := NewRegistry()
	RegisterBuiltins(reg)

	builtins := []string{"commit", "review", "explain", "test"}
	for _, id := range builtins {
		if _, ok := reg.Get(id); !ok {
			t.Errorf("missing builtin skill: %s", id)
		}
	}
}

func containsStr(s, sub string) bool {
	return len(s) >= len(sub) && strings.Contains(s, sub)
}
