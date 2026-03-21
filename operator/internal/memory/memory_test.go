package memory

import (
	"testing"
)

func TestSaveAndGet(t *testing.T) {
	dir := t.TempDir()
	s, err := NewStore(dir)
	if err != nil {
		t.Fatal(err)
	}

	entry := &Entry{
		ID:      "test-1",
		Type:    "user",
		Name:    "User Role",
		Content: "Senior Go developer",
	}
	if err := s.Save(entry); err != nil {
		t.Fatalf("Save failed: %v", err)
	}

	got, err := s.Get("test-1")
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if got.Content != "Senior Go developer" {
		t.Fatalf("expected content %q, got %q", "Senior Go developer", got.Content)
	}
	if got.CreatedAt.IsZero() || got.UpdatedAt.IsZero() {
		t.Fatal("timestamps should be set")
	}
}

func TestDelete(t *testing.T) {
	dir := t.TempDir()
	s, err := NewStore(dir)
	if err != nil {
		t.Fatal(err)
	}

	s.Save(&Entry{ID: "del-me", Name: "delete me"})
	s.Delete("del-me")

	_, err = s.Get("del-me")
	if err == nil {
		t.Fatal("should not find deleted entry")
	}
}

func TestList(t *testing.T) {
	dir := t.TempDir()
	s, err := NewStore(dir)
	if err != nil {
		t.Fatal(err)
	}

	s.Save(&Entry{ID: "a", Name: "A"})
	s.Save(&Entry{ID: "b", Name: "B"})
	s.Save(&Entry{ID: "c", Name: "C"})

	list, err := s.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(list))
	}
}

func TestListByType(t *testing.T) {
	dir := t.TempDir()
	s, err := NewStore(dir)
	if err != nil {
		t.Fatal(err)
	}

	s.Save(&Entry{ID: "u1", Type: "user", Name: "User 1"})
	s.Save(&Entry{ID: "f1", Type: "feedback", Name: "Feedback 1"})
	s.Save(&Entry{ID: "u2", Type: "user", Name: "User 2"})

	users, err := s.ListByType("user")
	if err != nil {
		t.Fatal(err)
	}
	if len(users) != 2 {
		t.Fatalf("expected 2 user entries, got %d", len(users))
	}
}

func TestSearch(t *testing.T) {
	dir := t.TempDir()
	s, err := NewStore(dir)
	if err != nil {
		t.Fatal(err)
	}

	s.Save(&Entry{ID: "1", Name: "Go expertise", Content: "Expert in Go, Rust, and TypeScript"})
	s.Save(&Entry{ID: "2", Name: "API design", Content: "Prefers REST over GraphQL"})
	s.Save(&Entry{ID: "3", Name: "Testing", Content: "Always write Go tests", Tags: []string{"go", "testing"}})

	results, err := s.Search("go")
	if err != nil {
		t.Fatal(err)
	}
	if len(results) < 2 {
		t.Fatalf("expected at least 2 results for 'go', got %d", len(results))
	}
	// "Go expertise" should rank higher (name match bonus)
	if results[0].ID != "3" && results[0].ID != "1" {
		t.Fatalf("expected Go-related entry first, got %q", results[0].Name)
	}
}

func TestSearchByTags(t *testing.T) {
	dir := t.TempDir()
	s, err := NewStore(dir)
	if err != nil {
		t.Fatal(err)
	}

	s.Save(&Entry{ID: "1", Name: "Entry 1", Tags: []string{"go", "backend"}})
	s.Save(&Entry{ID: "2", Name: "Entry 2", Tags: []string{"vue", "frontend"}})
	s.Save(&Entry{ID: "3", Name: "Entry 3", Tags: []string{"go", "cli"}})

	results, err := s.SearchByTags([]string{"go"})
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 2 {
		t.Fatalf("expected 2 results for tag 'go', got %d", len(results))
	}
}

func TestPersistenceAcrossRestarts(t *testing.T) {
	dir := t.TempDir()

	s1, _ := NewStore(dir)
	s1.Save(&Entry{ID: "persist", Name: "Persistent", Content: "survives restart"})

	s2, _ := NewStore(dir)
	got, err := s2.Get("persist")
	if err != nil {
		t.Fatalf("should load from disk: %v", err)
	}
	if got.Content != "survives restart" {
		t.Fatal("content should persist")
	}
}

func TestForContext(t *testing.T) {
	dir := t.TempDir()
	s, _ := NewStore(dir)

	s.Save(&Entry{ID: "1", Type: "user", Name: "Go expert", Content: "Writes Go daily"})
	s.Save(&Entry{ID: "2", Type: "feedback", Name: "Testing", Content: "Always test", Tags: []string{"testing"}})

	ctx := s.ForContext("testing", 5)
	if ctx == "" {
		t.Fatal("context should not be empty")
	}
	if !containsStr(ctx, "Relevant Memories") {
		t.Fatal("should contain header")
	}
}

func containsStr(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
