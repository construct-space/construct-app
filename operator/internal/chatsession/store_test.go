package chatsession

import (
	"os"
	"path/filepath"
	"testing"
)

func TestStoreRoundTrip(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	sess := &Session{
		ID:      "test-123",
		AgentID: "code-assistant",
		Turns: []Turn{
			{
				ID:      "turn-1",
				Request: []Block{{Type: "text", Content: "hello"}},
				Response: []Block{
					{Type: "text", Content: "Hi there!"},
					{Type: "tool", Tool: "bash", Title: "Running ls", State: "done"},
				},
				AgentID:   "code-assistant",
				Status:    "done",
				Timestamp: 1711000000,
			},
		},
	}

	if err := store.Save(sess); err != nil {
		t.Fatalf("Save: %v", err)
	}

	// Verify file exists
	path := filepath.Join(dir, "chat-sessions", "test-123.json")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("file not found: %v", err)
	}

	// Load
	loaded, err := store.Load("test-123")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if loaded.ID != "test-123" {
		t.Errorf("ID = %q, want %q", loaded.ID, "test-123")
	}
	if len(loaded.Turns) != 1 {
		t.Errorf("Turns = %d, want 1", len(loaded.Turns))
	}
	if loaded.Turns[0].Response[1].Tool != "bash" {
		t.Errorf("Tool = %q, want %q", loaded.Turns[0].Response[1].Tool, "bash")
	}
	if loaded.CreatedAt == "" {
		t.Error("CreatedAt should be set after Save")
	}
	if loaded.UpdatedAt == "" {
		t.Error("UpdatedAt should be set after Save")
	}

	// List
	metas, err := store.List()
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(metas) != 1 {
		t.Fatalf("List = %d, want 1", len(metas))
	}
	if metas[0].TurnCount != 1 {
		t.Errorf("TurnCount = %d, want 1", metas[0].TurnCount)
	}

	// FindByAgent
	found, err := store.FindByAgent("code-assistant", "")
	if err != nil {
		t.Fatalf("FindByAgent: %v", err)
	}
	if found == nil || found.ID != "test-123" {
		t.Error("FindByAgent should find session")
	}

	// FindByAgent miss
	notFound, err := store.FindByAgent("nonexistent", "")
	if err != nil {
		t.Fatalf("FindByAgent miss: %v", err)
	}
	if notFound != nil {
		t.Error("FindByAgent should return nil for unknown agent")
	}

	// Delete
	if err := store.Delete("test-123"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	metas, _ = store.List()
	if len(metas) != 0 {
		t.Errorf("List after delete = %d, want 0", len(metas))
	}
}

func TestListSortOrder(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	// Save two sessions — the one saved second should appear first in List
	sess1 := &Session{
		ID:      "older",
		AgentID: "agent-a",
		Turns:   []Turn{{ID: "t1", Status: "done"}},
	}
	if err := store.Save(sess1); err != nil {
		t.Fatalf("Save sess1: %v", err)
	}

	sess2 := &Session{
		ID:      "newer",
		AgentID: "agent-b",
		Turns:   []Turn{{ID: "t2", Status: "done"}, {ID: "t3", Status: "done"}},
	}
	if err := store.Save(sess2); err != nil {
		t.Fatalf("Save sess2: %v", err)
	}

	metas, err := store.List()
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(metas) != 2 {
		t.Fatalf("List = %d, want 2", len(metas))
	}
	// "newer" was saved second so its UpdatedAt is later
	if metas[0].ID != "newer" {
		t.Errorf("first session should be 'newer', got %q", metas[0].ID)
	}
	if metas[1].ID != "older" {
		t.Errorf("second session should be 'older', got %q", metas[1].ID)
	}
}

func TestLoadNotFound(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	_, err := store.Load("nonexistent")
	if err == nil {
		t.Fatal("Load should error for nonexistent session")
	}
}

func TestListEmptyDir(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	metas, err := store.List()
	if err != nil {
		t.Fatalf("List on empty dir: %v", err)
	}
	if len(metas) != 0 {
		t.Errorf("List on empty dir = %d, want 0", len(metas))
	}
}

func TestFindByAgentWithProject(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	sess1 := &Session{
		ID:        "proj-a-sess",
		AgentID:   "coder",
		ProjectID: "project-alpha",
		Turns:     []Turn{{ID: "t1", Status: "done"}},
	}
	store.Save(sess1)

	sess2 := &Session{
		ID:        "proj-b-sess",
		AgentID:   "coder",
		ProjectID: "project-beta",
		Turns:     []Turn{{ID: "t2", Status: "done"}},
	}
	store.Save(sess2)

	// Find by agent+project
	found, err := store.FindByAgent("coder", "project-alpha")
	if err != nil {
		t.Fatalf("FindByAgent: %v", err)
	}
	if found == nil || found.ID != "proj-a-sess" {
		t.Errorf("FindByAgent should find proj-a-sess, got %v", found)
	}

	// Different project
	found2, err := store.FindByAgent("coder", "project-beta")
	if err != nil {
		t.Fatalf("FindByAgent: %v", err)
	}
	if found2 == nil || found2.ID != "proj-b-sess" {
		t.Errorf("FindByAgent should find proj-b-sess, got %v", found2)
	}
}

func TestSaveReturnsErrorOnReadOnlyDir(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	// Make the chat-sessions directory read-only
	sessDir := filepath.Join(dir, "chat-sessions")
	os.Chmod(sessDir, 0444)
	defer os.Chmod(sessDir, 0755)

	sess := &Session{
		ID:      "fail-save",
		AgentID: "agent",
		Turns:   []Turn{{ID: "t1", Status: "done"}},
	}

	err := store.Save(sess)
	if err == nil {
		t.Fatal("Save should return error when directory is read-only")
	}
}

func TestListLogsParseErrors(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	// Create a valid session
	store.Save(&Session{
		ID:      "valid",
		AgentID: "agent",
		Turns:   []Turn{{ID: "t1", Status: "done"}},
	})

	// Write invalid JSON file
	invalidPath := filepath.Join(dir, "chat-sessions", "invalid.json")
	os.WriteFile(invalidPath, []byte("{broken json"), 0644)

	// List should still return the valid session (not crash)
	metas, err := store.List()
	if err != nil {
		t.Fatalf("List should not error: %v", err)
	}
	if len(metas) != 1 {
		t.Fatalf("expected 1 valid session, got %d", len(metas))
	}
	if metas[0].ID != "valid" {
		t.Errorf("expected valid session, got %q", metas[0].ID)
	}
}

func TestSaveUpdatesTimestamps(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	sess := &Session{
		ID:      "ts-test",
		AgentID: "agent",
		Turns:   []Turn{{ID: "t1", Status: "done"}},
	}

	// First save: both CreatedAt and UpdatedAt should be set
	store.Save(sess)
	loaded, _ := store.Load("ts-test")
	if loaded.CreatedAt == "" {
		t.Fatal("CreatedAt should be set on first save")
	}
	firstCreated := loaded.CreatedAt

	// Second save: CreatedAt preserved, UpdatedAt updated
	sess.CreatedAt = firstCreated
	sess.Turns = append(sess.Turns, Turn{ID: "t2", Status: "done"})
	store.Save(sess)
	loaded2, _ := store.Load("ts-test")
	if loaded2.CreatedAt != firstCreated {
		t.Errorf("CreatedAt should be preserved, got %q want %q", loaded2.CreatedAt, firstCreated)
	}
}
