package tool

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func memExec(t *testing.T, m Memory, ctx context.Context, args map[string]any) string {
	t.Helper()
	raw, _ := json.Marshal(args)
	out, err := m.Execute(ctx, raw)
	if err != nil {
		t.Fatalf("execute %v: %v", args, err)
	}
	return out
}

func TestMemoryUserScopeAddReplaceRemoveAndBlock(t *testing.T) {
	dir := t.TempDir()
	m := Memory{Store: NewMemoryStore(dir)}
	ctx := context.Background()

	memExec(t, m, ctx, map[string]any{"action": "add", "scope": "user", "text": "Prefers Astro + Tailwind"})

	// dedup
	out := memExec(t, m, ctx, map[string]any{"action": "add", "scope": "user", "text": "Prefers Astro + Tailwind"})
	if !strings.Contains(out, "duplicate") {
		t.Fatalf("expected duplicate skip, got %s", out)
	}

	block := NewMemoryStore(dir).Block("")
	if !strings.Contains(block, "Prefers Astro + Tailwind") || !strings.Contains(block, "## About the user") {
		t.Fatalf("block missing user entry:\n%s", block)
	}

	memExec(t, m, ctx, map[string]any{"action": "replace", "scope": "user", "find": "Astro + Tailwind", "text": "Next.js"})
	if b := NewMemoryStore(dir).Block(""); !strings.Contains(b, "Next.js") || strings.Contains(b, "Astro") {
		t.Fatalf("replace failed:\n%s", b)
	}

	memExec(t, m, ctx, map[string]any{"action": "remove", "scope": "user", "find": "Next.js"})
	if b := NewMemoryStore(dir).Block(""); strings.Contains(b, "Next.js") {
		t.Fatalf("remove failed:\n%s", b)
	}
}

func TestMemoryProjectScope(t *testing.T) {
	brainDir := t.TempDir()
	projDir := t.TempDir()
	m := Memory{Store: NewMemoryStore(brainDir)}
	// project scope resolves against the ctx cwd (active project dir)
	ctx := WithCwd(context.Background(), projDir)

	memExec(t, m, ctx, map[string]any{"action": "add", "scope": "project", "text": "Uses bun, deploys to construct.ninja"})

	// project memory appears in the block when projectDir is supplied
	block := NewMemoryStore(brainDir).Block(projDir)
	if !strings.Contains(block, "## This project") || !strings.Contains(block, "construct.ninja") {
		t.Fatalf("project block missing entry:\n%s", block)
	}
	// ...but not when no project is active
	if b := NewMemoryStore(brainDir).Block(""); strings.Contains(b, "construct.ninja") {
		t.Fatalf("project memory leaked into no-project block:\n%s", b)
	}

	// project scope without an active project falls back to user memory
	// (a stated preference is better saved than lost), not an error.
	brainDir2 := t.TempDir()
	m2 := Memory{Store: NewMemoryStore(brainDir2)}
	memExec(t, m2, context.Background(), map[string]any{"action": "add", "scope": "project", "text": "Falls back to user"})
	if u := NewMemoryStore(brainDir2).Block(""); !strings.Contains(u, "Falls back to user") {
		t.Fatalf("project-with-no-project should fall back to user memory:\n%s", u)
	}
}

func TestMemoryFuzzyDedup(t *testing.T) {
	dir := t.TempDir()
	m := Memory{Store: NewMemoryStore(dir)}
	ctx := context.Background()
	memExec(t, m, ctx, map[string]any{"action": "add", "scope": "user", "text": "Prefers Astro + Tailwind for landing pages"})
	// Near-identical: trailing period + different case/spacing → should dedup.
	out := memExec(t, m, ctx, map[string]any{"action": "add", "scope": "user", "text": "prefers  Astro + Tailwind for landing pages."})
	if !strings.Contains(out, "duplicate") {
		t.Fatalf("expected fuzzy duplicate skip, got %s", out)
	}
	// Only one entry persisted.
	if n := strings.Count(NewMemoryStore(dir).Block(""), "Astro + Tailwind"); n != 1 {
		t.Fatalf("expected 1 entry, found %d", n)
	}
}

func TestMemoryLenientParamAliases(t *testing.T) {
	dir := t.TempDir()
	m := Memory{Store: NewMemoryStore(dir)}
	// Model used value/key instead of text — should still save.
	memExec(t, m, context.Background(), map[string]any{"action": "add", "scope": "user", "key": "landing_stack", "value": "Astro + Tailwind"})
	b := NewMemoryStore(dir).Block("")
	if !strings.Contains(b, "landing_stack: Astro + Tailwind") {
		t.Fatalf("value/key aliases not honored:\n%s", b)
	}
}

func TestMemoryOrgScopeRejectedForNow(t *testing.T) {
	m := Memory{Store: NewMemoryStore(t.TempDir())}
	raw, _ := json.Marshal(map[string]any{"action": "add", "scope": "org", "text": "x"})
	if _, err := m.Execute(context.Background(), raw); err == nil {
		t.Fatal("org scope should be rejected until the source-api store lands")
	}
}

func TestMemoryBlockEmpty(t *testing.T) {
	if b := NewMemoryStore(t.TempDir()).Block(""); b != "" {
		t.Fatalf("expected empty block, got %q", b)
	}
	var nilStore *MemoryStore
	if b := nilStore.Block(""); b != "" {
		t.Fatalf("nil store should yield empty block, got %q", b)
	}
}
