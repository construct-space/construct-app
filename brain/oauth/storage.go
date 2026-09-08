package oauth

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

// Storage owns reads + writes to <profile>/providers/auth.json. The
// desktop app and operator both touch this file; brain co-operates by
// reading what's already there, merging the new credential under the
// provider key, and writing the whole map back atomically.
type Storage struct {
	path string
	mu   sync.Mutex
}

func NewStorage(authFile string) *Storage { return &Storage{path: authFile} }

// Rebind retargets the storage at a different providers/auth.json file.
// Called from profile.switch so OAuth credentials follow the active
// profile instead of staying pinned to the boot-time path.
func (s *Storage) Rebind(authFile string) {
	s.mu.Lock()
	s.path = authFile
	s.mu.Unlock()
}

// Save persists OAuth credentials for one provider. Existing entries for
// other providers are preserved.
func (s *Storage) Save(providerID string, creds *Credentials) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := s.loadLocked()
	if err != nil {
		return err
	}
	data[providerID] = map[string]any{
		"type":        "oauth",
		"credentials": creds,
	}
	return s.writeLocked(data)
}

// Connected returns the set of provider IDs that have an entry in
// providers/auth.json. Used by the OAuth listing handler.
func (s *Storage) Connected() map[string]bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := s.loadLocked()
	if err != nil {
		return map[string]bool{}
	}
	out := map[string]bool{}
	for k := range data {
		out[k] = true
	}
	return out
}

// ReloadRefresh re-reads the on-disk refresh token for one provider.
// Used by token sources to recover from `invalid_grant` after a peer
// (the desktop app, another brain process) rotated the token while
// this process was holding a stale in-memory copy. Returns ("", nil)
// if the provider isn't present on disk — caller should treat as
// "no token available, prompt re-login".
func (s *Storage) ReloadRefresh(providerID string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := s.loadLocked()
	if err != nil {
		return "", err
	}
	entry, ok := data[providerID].(map[string]any)
	if !ok {
		return "", nil
	}
	creds, ok := entry["credentials"].(map[string]any)
	if !ok {
		return "", nil
	}
	refresh, _ := creds["refresh"].(string)
	return refresh, nil
}

// Delete removes the provider entry. No-op if absent.
func (s *Storage) Delete(providerID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := s.loadLocked()
	if err != nil {
		return err
	}
	if _, ok := data[providerID]; !ok {
		return nil
	}
	delete(data, providerID)
	return s.writeLocked(data)
}

func (s *Storage) loadLocked() (map[string]any, error) {
	body, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]any{}, nil
		}
		return nil, err
	}
	var out map[string]any
	if len(body) == 0 {
		return map[string]any{}, nil
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, err
	}
	if out == nil {
		out = map[string]any{}
	}
	return out, nil
}

func (s *Storage) writeLocked(data map[string]any) error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	body, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, body, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}
