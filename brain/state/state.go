// Package state holds brain's per-user persistent UI state — KV pairs,
// settings, pinned items, active project, project-scoped settings. Each
// kind lives in its own JSON file under <data-dir>/brain/state/ so a
// corrupt file can't take down the others.
//
// This replaces operator's internal/state package. Operator carried a
// richer scoping model (category + project_id + user_id tuples on every
// key); brain uses the simpler "one global namespace + optional
// project-scoped namespace" because that's what the frontend currently
// exercises. Add scopes back when a real consumer asks for them.
package state

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// Store owns the on-disk JSON files. All public methods are concurrent-
// safe. Construct one per brain process via Open().
//
// What lives here vs. the webview: anything brain needs to read at boot
// or write from a wire op stays in state. Pure UI state (pinned items,
// scroll positions, expanded folders) belongs in IndexedDB inside the
// webview — see frontend/utils/db.ts.
type Store struct {
	dir string

	mu              sync.Mutex
	kv              map[string]json.RawMessage
	settings        map[string]json.RawMessage
	runtime         RuntimeState
	projectSettings map[string]map[string]json.RawMessage // project_id -> key -> value
}

type RuntimeState struct {
	ActiveProjectID   string `json:"active_project_id,omitempty"`
	ActiveProjectPath string `json:"active_project_path,omitempty"`
	ActiveOrgID       string `json:"active_org_id,omitempty"`
	ActiveSpaceID     string `json:"active_space_id,omitempty"`
	UpdatedAt         string `json:"updated_at,omitempty"`
}

// Open returns a Store rooted at dir. Files load lazily; missing files
// are treated as empty state so first-run users don't see errors.
func Open(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create state dir: %w", err)
	}
	s := &Store{
		dir:             dir,
		kv:              map[string]json.RawMessage{},
		settings:        map[string]json.RawMessage{},
		projectSettings: map[string]map[string]json.RawMessage{},
	}
	s.loadAll()
	return s, nil
}

func (s *Store) path(name string) string { return filepath.Join(s.dir, name) }

// Rebind retargets the store at a different state directory and reloads
// kv / settings / runtime / projectSettings from disk. Called from
// profile.switch so brain reads state from the active profile after a
// profile change.
func (s *Store) Rebind(dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create state dir: %w", err)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.dir = dir
	s.kv = map[string]json.RawMessage{}
	s.settings = map[string]json.RawMessage{}
	s.runtime = RuntimeState{}
	s.projectSettings = map[string]map[string]json.RawMessage{}
	s.loadAll()
	return nil
}

func (s *Store) loadAll() {
	loadJSON(s.path("kv.json"), &s.kv)
	loadJSON(s.path("settings.json"), &s.settings)
	loadJSON(s.path("runtime.json"), &s.runtime)
	loadJSON(s.path("project_settings.json"), &s.projectSettings)
}

func loadJSON(path string, dst any) {
	b, err := os.ReadFile(path)
	if err != nil {
		return
	}
	_ = json.Unmarshal(b, dst)
}

// writeJSON does an atomic write via tmp + rename so a crash mid-write
// can't corrupt the file.
func writeJSON(path string, v any) error {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// ─── KV ──────────────────────────────────────────────────────────────

func (s *Store) KVGet(key string) (json.RawMessage, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.kv[key]
	if !ok {
		return nil, false
	}
	return append(json.RawMessage(nil), v...), true
}

func (s *Store) KVSet(key string, value json.RawMessage) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(value) == 0 {
		value = json.RawMessage("null")
	}
	s.kv[key] = append(json.RawMessage(nil), value...)
	return writeJSON(s.path("kv.json"), s.kv)
}

func (s *Store) KVDelete(key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.kv[key]; !ok {
		return nil
	}
	delete(s.kv, key)
	return writeJSON(s.path("kv.json"), s.kv)
}

func (s *Store) KVList() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]string, 0, len(s.kv))
	for k := range s.kv {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// ─── Settings ────────────────────────────────────────────────────────

func (s *Store) SettingsGet(key string) (json.RawMessage, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.settings[key]
	if !ok {
		return nil, false
	}
	return append(json.RawMessage(nil), v...), true
}

func (s *Store) SettingsSet(key string, value json.RawMessage) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(value) == 0 {
		value = json.RawMessage("null")
	}
	s.settings[key] = append(json.RawMessage(nil), value...)
	return writeJSON(s.path("settings.json"), s.settings)
}

func (s *Store) SettingsAll() map[string]json.RawMessage {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make(map[string]json.RawMessage, len(s.settings))
	for k, v := range s.settings {
		out[k] = append(json.RawMessage(nil), v...)
	}
	return out
}

// ─── Runtime ─────────────────────────────────────────────────────────

func (s *Store) RuntimeGet() RuntimeState {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.runtime
}

func (s *Store) RuntimeSet(rt RuntimeState) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	rt.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	s.runtime = rt
	return writeJSON(s.path("runtime.json"), s.runtime)
}

// ─── Project settings ────────────────────────────────────────────────

func (s *Store) ProjectSettingsGet(projectID string) map[string]json.RawMessage {
	s.mu.Lock()
	defer s.mu.Unlock()
	src, ok := s.projectSettings[projectID]
	if !ok {
		return map[string]json.RawMessage{}
	}
	out := make(map[string]json.RawMessage, len(src))
	for k, v := range src {
		out[k] = append(json.RawMessage(nil), v...)
	}
	return out
}

func (s *Store) ProjectSettingsSet(projectID, key string, value json.RawMessage) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if projectID == "" {
		return fmt.Errorf("project_id required")
	}
	if s.projectSettings[projectID] == nil {
		s.projectSettings[projectID] = map[string]json.RawMessage{}
	}
	if len(value) == 0 {
		value = json.RawMessage("null")
	}
	s.projectSettings[projectID][key] = append(json.RawMessage(nil), value...)
	return writeJSON(s.path("project_settings.json"), s.projectSettings)
}
