package session

import (
	"os"
	"path/filepath"
	"testing"

	"construct-operator/internal/provider"
)

func TestStoreCreateAndGet(t *testing.T) {
	s := NewStore("")

	sess := s.Create("test-agent")
	if sess.ID == "" {
		t.Fatal("session ID should not be empty")
	}
	if sess.AgentID != "test-agent" {
		t.Fatalf("expected agent_id %q, got %q", "test-agent", sess.AgentID)
	}
	if sess.State != StateRunning {
		t.Fatalf("expected state %q, got %q", StateRunning, sess.State)
	}

	got, ok := s.Get(sess.ID)
	if !ok {
		t.Fatal("should find session by ID")
	}
	if got.ID != sess.ID {
		t.Fatalf("IDs don't match: %q vs %q", got.ID, sess.ID)
	}
}

func TestStoreList(t *testing.T) {
	s := NewStore("")

	s.Create("agent-1")
	s.Create("agent-2")
	s.Create("agent-3")

	list := s.List()
	if len(list) != 3 {
		t.Fatalf("expected 3 sessions, got %d", len(list))
	}
}

func TestSessionLifecycle(t *testing.T) {
	s := NewStore("")

	sess := s.Create("test-agent")
	sess.AddTurn()
	sess.AddTurn()
	if sess.Turns != 2 {
		t.Fatalf("expected 2 turns, got %d", sess.Turns)
	}

	sess.Complete()
	if sess.State != StateCompleted {
		t.Fatalf("expected state %q, got %q", StateCompleted, sess.State)
	}
	if sess.EndTime.IsZero() {
		t.Fatal("EndTime should be set after Complete()")
	}
}

func TestSessionSetError(t *testing.T) {
	s := NewStore("")

	sess := s.Create("test-agent")
	sess.SetError("something broke")

	if sess.State != StateFailed {
		t.Fatalf("expected state %q, got %q", StateFailed, sess.State)
	}
	if sess.Error != "something broke" {
		t.Fatalf("expected error %q, got %q", "something broke", sess.Error)
	}
}

func TestPersistence(t *testing.T) {
	dir := t.TempDir()

	// Create store, add a session with messages, save it
	s1 := NewStore(dir)
	sess := s1.Create("persist-agent")
	sess.Messages = []provider.Message{
		{Role: "user", Content: "hello"},
		{Role: "assistant", Content: "hi there"},
	}
	sess.Complete()
	if err := s1.Save(sess); err != nil {
		t.Fatalf("Save failed: %v", err)
	}

	// Verify file exists
	jsonPath := filepath.Join(dir, sess.ID+".json")
	if _, err := os.Stat(jsonPath); os.IsNotExist(err) {
		t.Fatal("session JSON file should exist on disk")
	}

	// Create a new store from same dir — should load the session
	s2 := NewStore(dir)
	got, ok := s2.Get(sess.ID)
	if !ok {
		t.Fatal("session should be loaded from disk")
	}
	if got.AgentID != "persist-agent" {
		t.Fatalf("expected agent_id %q, got %q", "persist-agent", got.AgentID)
	}
	if got.State != StateCompleted {
		t.Fatalf("expected state %q, got %q", StateCompleted, got.State)
	}
	if len(got.Messages) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(got.Messages))
	}
	if got.Messages[0].Content != "hello" {
		t.Fatalf("expected first message %q, got %q", "hello", got.Messages[0].Content)
	}
	if got.Messages[1].Content != "hi there" {
		t.Fatalf("expected second message %q, got %q", "hi there", got.Messages[1].Content)
	}
}

func TestPersistenceMultipleSessions(t *testing.T) {
	dir := t.TempDir()

	s1 := NewStore(dir)
	a := s1.Create("agent-a")
	a.Complete()
	s1.Save(a)

	b := s1.Create("agent-b")
	b.SetError("failed")
	s1.Save(b)

	// Reload
	s2 := NewStore(dir)
	list := s2.List()
	if len(list) != 2 {
		t.Fatalf("expected 2 sessions loaded, got %d", len(list))
	}
}

func TestGetNotFound(t *testing.T) {
	s := NewStore("")
	_, ok := s.Get("nonexistent")
	if ok {
		t.Fatal("should not find nonexistent session")
	}
}

func TestInMemoryOnlySaveIsNoop(t *testing.T) {
	s := NewStore("")
	sess := s.Create("test")
	// Save on in-memory store should be a no-op (no error)
	if err := s.Save(sess); err != nil {
		t.Fatalf("Save on in-memory store should not error: %v", err)
	}
}
