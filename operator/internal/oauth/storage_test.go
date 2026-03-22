package oauth

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestNewStorageInDirUsesProvidersPath(t *testing.T) {
	dir := t.TempDir()
	storage := NewStorageInDir(dir)

	if got, want := storage.path, filepath.Join(dir, "providers", "auth.json"); got != want {
		t.Fatalf("expected storage path %q, got %q", want, got)
	}
}

func TestStorageLoadFallsBackToLegacyAuthJSON(t *testing.T) {
	dir := t.TempDir()
	legacyPath := filepath.Join(dir, "auth.json")
	want := StorageData{
		"anthropic": {
			Type: "api_key",
			Key:  "legacy-key",
		},
	}

	raw, err := json.MarshalIndent(want, "", "  ")
	if err != nil {
		t.Fatalf("marshal legacy storage: %v", err)
	}
	if err := os.WriteFile(legacyPath, raw, 0600); err != nil {
		t.Fatalf("write legacy auth file: %v", err)
	}

	got, err := NewStorageInDir(dir).Load()
	if err != nil {
		t.Fatalf("load storage: %v", err)
	}

	if got["anthropic"] == nil || got["anthropic"].Key != "legacy-key" {
		t.Fatalf("expected legacy credential to load, got %#v", got["anthropic"])
	}
}

func TestStorageSetWritesToProvidersPathAndMigratesLegacyData(t *testing.T) {
	dir := t.TempDir()
	legacyPath := filepath.Join(dir, "auth.json")
	newPath := filepath.Join(dir, "providers", "auth.json")
	legacy := StorageData{
		"anthropic": {
			Type: "api_key",
			Key:  "legacy-key",
		},
	}

	raw, err := json.MarshalIndent(legacy, "", "  ")
	if err != nil {
		t.Fatalf("marshal legacy storage: %v", err)
	}
	if err := os.WriteFile(legacyPath, raw, 0600); err != nil {
		t.Fatalf("write legacy auth file: %v", err)
	}

	storage := NewStorageInDir(dir)
	if err := storage.SetAPIKey("openai-codex", "new-key"); err != nil {
		t.Fatalf("set api key: %v", err)
	}

	if _, err := os.Stat(newPath); err != nil {
		t.Fatalf("expected migrated auth file at %q: %v", newPath, err)
	}

	merged, err := storage.Load()
	if err != nil {
		t.Fatalf("load merged storage: %v", err)
	}

	if merged["anthropic"] == nil || merged["anthropic"].Key != "legacy-key" {
		t.Fatalf("expected legacy credential after migration, got %#v", merged["anthropic"])
	}
	if merged["openai-codex"] == nil || merged["openai-codex"].Key != "new-key" {
		t.Fatalf("expected new credential after migration, got %#v", merged["openai-codex"])
	}
}
