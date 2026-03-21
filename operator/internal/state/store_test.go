package state

import (
	"encoding/json"
	"testing"
)

func TestStoragePersistenceAndListFiltering(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	projectID := 42
	if err := store.StorageSet("alpha", json.RawMessage(`{"ok":true}`), Scope{
		Category:  "prefs",
		ProjectID: &projectID,
		UserID:    "u1",
	}); err != nil {
		t.Fatalf("StorageSet: %v", err)
	}
	if err := store.StorageSet("beta", json.RawMessage(`123`), Scope{Category: "prefs"}); err != nil {
		t.Fatalf("StorageSet beta: %v", err)
	}

	got, ok := store.StorageGet("alpha", Scope{
		Category:  "prefs",
		ProjectID: &projectID,
		UserID:    "u1",
	})
	if !ok || !jsonEqual(got, json.RawMessage(`{"ok":true}`)) {
		t.Fatalf("StorageGet alpha = %s, %v", string(got), ok)
	}

	if _, ok := store.StorageGet("alpha", Scope{Category: "prefs"}); ok {
		t.Fatal("StorageGet should require exact scope match")
	}

	filtered := store.StorageList(Scope{Category: "prefs"})
	if len(filtered) != 2 {
		t.Fatalf("StorageList prefs len = %d, want 2", len(filtered))
	}

	reloaded := NewStore(dir)
	got, ok = reloaded.StorageGet("alpha", Scope{
		Category:  "prefs",
		ProjectID: &projectID,
		UserID:    "u1",
	})
	if !ok || !jsonEqual(got, json.RawMessage(`{"ok":true}`)) {
		t.Fatalf("reloaded StorageGet alpha = %s, %v", string(got), ok)
	}

	if err := reloaded.StorageDelete("alpha", nil); err != nil {
		t.Fatalf("StorageDelete: %v", err)
	}
	if _, ok := reloaded.StorageGet("alpha", Scope{
		Category:  "prefs",
		ProjectID: &projectID,
		UserID:    "u1",
	}); ok {
		t.Fatal("alpha should be deleted")
	}
}

func TestKVSettingsAndProjectSettingsPersistence(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	if err := store.KVSet("provider_key:deepseek", "sk-test", "provider_keys"); err != nil {
		t.Fatalf("KVSet: %v", err)
	}
	if err := store.SettingSet("provider_key:xai", "xai-test"); err != nil {
		t.Fatalf("SettingSet: %v", err)
	}
	if err := store.ProjectSettingsSet(ProjectSettings{
		ProjectID:  7,
		LocalPath:  "/tmp/project",
		EditorPath: "/Applications/Zed.app",
	}); err != nil {
		t.Fatalf("ProjectSettingsSet: %v", err)
	}

	reloaded := NewStore(dir)

	if got, ok := reloaded.KVGet("provider_key:deepseek", "provider_keys"); !ok || got != "sk-test" {
		t.Fatalf("KVGet = %q, %v", got, ok)
	}
	if got, ok := reloaded.SettingGet("provider_key:xai"); !ok || got != "xai-test" {
		t.Fatalf("SettingGet = %q, %v", got, ok)
	}
	settings, ok := reloaded.ProjectSettingsGet(7)
	if !ok {
		t.Fatal("ProjectSettingsGet missing")
	}
	if settings.LocalPath != "/tmp/project" || settings.EditorPath != "/Applications/Zed.app" {
		t.Fatalf("ProjectSettingsGet = %+v", settings)
	}
}

func TestPinnedReorderPersistence(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	secondOrder := 1
	if err := store.PinnedAdd(PinnedItem{
		ID:       "first",
		Type:     "project",
		Name:     "First",
		Icon:     "folder",
		Path:     "/tmp/a",
		PinnedAt: "2026-03-15T10:00:00Z",
	}); err != nil {
		t.Fatalf("PinnedAdd first: %v", err)
	}
	if err := store.PinnedAdd(PinnedItem{
		ID:        "second",
		Type:      "project",
		Name:      "Second",
		Icon:      "folder",
		Path:      "/tmp/b",
		PinnedAt:  "2026-03-15T09:00:00Z",
		SortOrder: &secondOrder,
	}); err != nil {
		t.Fatalf("PinnedAdd second: %v", err)
	}

	if err := store.PinnedReorder([]PinnedOrder{
		{ID: "first", SortOrder: 3},
		{ID: "second", SortOrder: 0},
	}); err != nil {
		t.Fatalf("PinnedReorder: %v", err)
	}

	reloaded := NewStore(dir)
	items := reloaded.PinnedList()
	if len(items) != 2 {
		t.Fatalf("PinnedList len = %d, want 2", len(items))
	}
	if items[0].ID != "second" || items[1].ID != "first" {
		t.Fatalf("PinnedList order = %#v", items)
	}
}

func TestDesignSaveListGetDelete(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(dir)

	projectID := 9
	record, err := store.DesignSave(DesignInput{
		LocalID:      "design-1",
		ProjectID:    &projectID,
		Name:         "Landing Page",
		NodesJSON:    `[{"id":"n1"}]`,
		PagesJSON:    `[{"id":"p1"}]`,
		HistoryIndex: 2,
	})
	if err != nil {
		t.Fatalf("DesignSave: %v", err)
	}
	if record.ID != 1 {
		t.Fatalf("DesignSave ID = %d, want 1", record.ID)
	}

	reloaded := NewStore(dir)
	list := reloaded.DesignList(&projectID)
	if len(list) != 1 || list[0].LocalID != "design-1" {
		t.Fatalf("DesignList = %#v", list)
	}

	got, ok := reloaded.DesignGet("design-1")
	if !ok {
		t.Fatal("DesignGet missing")
	}
	response := got.ResponseMap()
	if response["localId"] != "design-1" || response["local_id"] != "design-1" {
		t.Fatalf("ResponseMap local ids = %#v", response)
	}
	if _, ok := response["nodes"]; !ok {
		t.Fatalf("ResponseMap missing parsed nodes: %#v", response)
	}
	if response["updatedAt"] == "" || response["updated_at"] == "" {
		t.Fatalf("ResponseMap missing updated timestamps: %#v", response)
	}

	if err := reloaded.DesignDelete("design-1"); err != nil {
		t.Fatalf("DesignDelete: %v", err)
	}
	if _, ok := reloaded.DesignGet("design-1"); ok {
		t.Fatal("design should be deleted")
	}
}

func jsonEqual(left, right json.RawMessage) bool {
	var l any
	var r any
	if err := json.Unmarshal(left, &l); err != nil {
		return false
	}
	if err := json.Unmarshal(right, &r); err != nil {
		return false
	}
	return testingJSONValueEqual(l, r)
}

func testingJSONValueEqual(left, right any) bool {
	lb, lErr := json.Marshal(left)
	rb, rErr := json.Marshal(right)
	return lErr == nil && rErr == nil && string(lb) == string(rb)
}
