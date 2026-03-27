package oauth

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// Storage handles reading/writing provider credentials to auth.json.
// Thread-safe with file locking for concurrent access.
type Storage struct {
	mu          sync.Mutex
	path        string
	legacyPaths []string
}

// NewStorage creates a storage backed by the given file path.
func NewStorage(path string) *Storage {
	return &Storage{path: path}
}

// NewStorageInDir creates a storage at dir/providers/auth.json and falls back
// to dir/auth.json for legacy installs.
func NewStorageInDir(dir string) *Storage {
	return &Storage{
		path:        filepath.Join(dir, "providers", "auth.json"),
		legacyPaths: []string{filepath.Join(dir, "auth.json")},
	}
}

// Load reads all credentials from disk.
func (s *Storage) Load() (StorageData, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.readFile()
}

// Get returns credentials for a provider.
func (s *Storage) Get(providerID string) (*AuthCredential, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := s.readFile()
	if err != nil {
		return nil, err
	}
	cred, ok := data[providerID]
	if !ok {
		return nil, nil
	}
	return cred, nil
}

// Set stores credentials for a provider.
func (s *Storage) Set(providerID string, cred *AuthCredential) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := s.readFile()
	if err != nil {
		data = make(StorageData)
	}

	data[providerID] = cred
	return s.writeFile(data)
}

// SetAPIKey stores an API key credential.
func (s *Storage) SetAPIKey(providerID, key string) error {
	return s.Set(providerID, &AuthCredential{
		Type: "api_key",
		Key:  key,
	})
}

// SetOAuth stores OAuth credentials.
func (s *Storage) SetOAuth(providerID string, creds *Credentials) error {
	return s.Set(providerID, &AuthCredential{
		Type:        "oauth",
		Credentials: creds,
	})
}

// Delete removes credentials for a provider and stores a "disconnected"
// marker so auto-discovery (e.g. CLI token loading) does not re-add it.
func (s *Storage) Delete(providerID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := s.readFile()
	if err != nil {
		data = make(StorageData)
	}

	data[providerID] = &AuthCredential{Type: "disconnected"}
	return s.writeFile(data)
}

// IsDisconnected returns true if the user explicitly disconnected a provider.
func (s *Storage) IsDisconnected(providerID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := s.readFile()
	if err != nil {
		return false
	}
	cred := data[providerID]
	return cred != nil && cred.Type == "disconnected"
}

// GetAPIKey returns the API key for a provider, handling both api_key and oauth types.
// For OAuth, auto-refreshes if expired (requires registry).
func (s *Storage) GetAPIKey(providerID string, registry *Registry) (string, error) {
	cred, err := s.Get(providerID)
	if err != nil || cred == nil {
		return "", err
	}

	if cred.Type == "api_key" {
		return cred.Key, nil
	}

	if cred.Type == "oauth" && cred.Credentials != nil {
		// Auto-refresh if expired
		if cred.Credentials.IsExpired() && registry != nil {
			provider, ok := registry.Get(providerID)
			if !ok {
				return "", fmt.Errorf("unknown OAuth provider: %s", providerID)
			}
			newCreds, err := provider.RefreshToken(cred.Credentials)
			if err != nil {
				return "", fmt.Errorf("refresh %s token: %w", providerID, err)
			}
			// Save refreshed credentials
			if err := s.SetOAuth(providerID, newCreds); err != nil {
				fmt.Fprintf(os.Stderr, "[oauth] warning: failed to save refreshed credentials: %v\n", err)
			}
			return provider.GetAPIKey(newCreds), nil
		}

		if registry != nil {
			provider, ok := registry.Get(providerID)
			if ok {
				return provider.GetAPIKey(cred.Credentials), nil
			}
		}
		return cred.Credentials.Access, nil
	}

	return "", fmt.Errorf("unknown credential type: %s", cred.Type)
}

func (s *Storage) readFile() (StorageData, error) {
	paths := append([]string{s.path}, s.legacyPaths...)
	for _, path := range paths {
		data, err := readStorageFile(path)
		if os.IsNotExist(err) {
			continue
		}
		return data, err
	}
	return make(StorageData), nil
}

func (s *Storage) writeFile(data StorageData) error {
	dir := filepath.Dir(s.path)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}

	raw, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(s.path, raw, 0600)
}

func readStorageFile(path string) (StorageData, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, err
		}
		return nil, err
	}

	var data StorageData
	if err := json.Unmarshal(raw, &data); err != nil {
		return make(StorageData), nil
	}
	return data, nil
}
