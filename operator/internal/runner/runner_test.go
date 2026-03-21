package runner

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

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
