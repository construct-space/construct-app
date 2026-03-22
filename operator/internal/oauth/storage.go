package oauth

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// Storage handles reading/writing auth credentials to auth.json.
// Thread-safe with file locking for concurrent access.
type Storage struct {
	mu   sync.Mutex
	path string
}

// NewStorage creates a storage backed by the given file path.
func NewStorage(path string) *Storage {
	return &Storage{path: path}
}

// NewStorageInDir creates a storage at dir/auth.json.
func NewStorageInDir(dir string) *Storage {
	return NewStorage(filepath.Join(dir, "auth.json"))
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

// Delete removes credentials for a provider.
func (s *Storage) Delete(providerID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := s.readFile()
	if err != nil {
		return nil
	}

	delete(data, providerID)
	return s.writeFile(data)
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
	raw, err := os.ReadFile(s.path)
	if os.IsNotExist(err) {
		return make(StorageData), nil
	}
	if err != nil {
		return nil, err
	}

	var data StorageData
	if err := json.Unmarshal(raw, &data); err != nil {
		return make(StorageData), nil
	}
	return data, nil
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
