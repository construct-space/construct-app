package tool

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func smExec(t *testing.T, sm SkillManage, args map[string]any) string {
	t.Helper()
	raw, _ := json.Marshal(args)
	out, err := sm.Execute(context.Background(), raw)
	if err != nil {
		t.Fatalf("execute %v: %v", args, err)
	}
	return out
}

func TestSkillManageCreatePatchEditDelete(t *testing.T) {
	dir := t.TempDir()
	sm := SkillManage{Store: NewSkillStore(dir)}

	// create
	smExec(t, sm, map[string]any{
		"action": "create", "name": "Deploy Astro", "description": "Deploy an Astro site",
		"triggers": "deploy,astro", "body": "## Procedure\n1. build\n2. ship",
	})
	path := filepath.Join(dir, "deploy-astro", "SKILL.md")
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("skill not written: %v", err)
	}
	content := string(b)
	for _, want := range []string{"id: deploy-astro", "name: Deploy Astro", "source: agent", "triggers: deploy,astro", "1. build"} {
		if !strings.Contains(content, want) {
			t.Fatalf("created skill missing %q:\n%s", want, content)
		}
	}

	// create again → error (exists)
	raw, _ := json.Marshal(map[string]any{"action": "create", "id": "deploy-astro", "body": "x"})
	if _, err := sm.Execute(context.Background(), raw); err == nil {
		t.Fatal("expected error creating duplicate skill")
	}

	// patch
	smExec(t, sm, map[string]any{"action": "patch", "id": "deploy-astro", "find": "2. ship", "replace": "2. ship to construct.ninja"})
	b, _ = os.ReadFile(path)
	if !strings.Contains(string(b), "ship to construct.ninja") {
		t.Fatalf("patch failed:\n%s", string(b))
	}

	// edit (body replaced, frontmatter preserved)
	smExec(t, sm, map[string]any{"action": "edit", "id": "deploy-astro", "body": "## New\nrewritten"})
	b, _ = os.ReadFile(path)
	if !strings.Contains(string(b), "rewritten") || !strings.Contains(string(b), "id: deploy-astro") || strings.Contains(string(b), "1. build") {
		t.Fatalf("edit failed (should keep frontmatter, swap body):\n%s", string(b))
	}

	// delete → archived, original gone
	smExec(t, sm, map[string]any{"action": "delete", "id": "deploy-astro"})
	if _, err := os.Stat(filepath.Join(dir, "deploy-astro")); !os.IsNotExist(err) {
		t.Fatal("skill dir should be moved on delete")
	}
	archives, _ := filepath.Glob(filepath.Join(dir, ".archive", "deploy-astro-*"))
	if len(archives) == 0 {
		t.Fatal("delete should archive, not hard-delete")
	}
}

func TestSkillManageErrors(t *testing.T) {
	sm := SkillManage{Store: NewSkillStore(t.TempDir())}
	for _, args := range []map[string]any{
		{"action": "create", "name": "x"},                 // missing body
		{"action": "patch", "id": "nope", "find": "a"},    // missing skill
		{"action": "bogus", "id": "x"},                    // bad action
	} {
		raw, _ := json.Marshal(args)
		if _, err := sm.Execute(context.Background(), raw); err == nil {
			t.Fatalf("expected error for %v", args)
		}
	}
}
