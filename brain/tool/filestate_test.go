package tool

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestCheckReadBeforeWrite_NewFileAllowed(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "fresh.txt")
	ctx := WithSession(context.Background(), "sess-new")
	if reason := CheckReadBeforeWrite(ctx, path); reason != "" {
		t.Fatalf("expected new-file write to be allowed, got: %s", reason)
	}
}

func TestCheckReadBeforeWrite_UnreadFileBlocked(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "existing.txt")
	if err := os.WriteFile(path, []byte("hello"), 0o644); err != nil {
		t.Fatalf("setup: %v", err)
	}
	ctx := WithSession(context.Background(), "sess-blocked")
	reason := CheckReadBeforeWrite(ctx, path)
	if reason == "" {
		t.Fatalf("expected refusal on unread existing file")
	}
}

func TestCheckReadBeforeWrite_ReadThenEdit(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "ok.txt")
	if err := os.WriteFile(path, []byte("hello"), 0o644); err != nil {
		t.Fatalf("setup: %v", err)
	}
	ctx := WithSession(context.Background(), "sess-ok")
	MarkRead(ctx, path)
	if reason := CheckReadBeforeWrite(ctx, path); reason != "" {
		t.Fatalf("expected read-then-edit to pass, got: %s", reason)
	}
}

func TestCheckReadBeforeWrite_ExternalChangeBlocks(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "drift.txt")
	if err := os.WriteFile(path, []byte("v1"), 0o644); err != nil {
		t.Fatalf("setup: %v", err)
	}
	ctx := WithSession(context.Background(), "sess-drift")
	MarkRead(ctx, path)

	// Simulate someone (or another process) modifying the file with a
	// different size; CheckReadBeforeWrite must catch the drift.
	if err := os.WriteFile(path, []byte("v2 longer"), 0o644); err != nil {
		t.Fatalf("drift: %v", err)
	}
	if reason := CheckReadBeforeWrite(ctx, path); reason == "" {
		t.Fatalf("expected drift detection on size change")
	}
}

func TestCheckReadBeforeWrite_NoSessionAllowsAll(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "anon.txt")
	if err := os.WriteFile(path, []byte("hi"), 0o644); err != nil {
		t.Fatalf("setup: %v", err)
	}
	// No session id on ctx — CLI / scripted runs should still work without
	// pinning every read.
	if reason := CheckReadBeforeWrite(context.Background(), path); reason != "" {
		t.Fatalf("expected sessionless write to be allowed, got: %s", reason)
	}
}
