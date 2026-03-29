package state

import (
	"encoding/json"
	"sort"
	"strconv"
	"strings"
)

// StorageEntry stores arbitrary JSON values with optional namespace metadata.
type StorageEntry struct {
	Key       string          `json:"key"`
	Category  string          `json:"category,omitempty"`
	ProjectID *int            `json:"project_id,omitempty"`
	UserID    string          `json:"user_id,omitempty"`
	Value     json.RawMessage `json:"value"`
	CreatedAt string          `json:"created_at"`
	UpdatedAt string          `json:"updated_at"`
}

type storageFile struct {
	Items []StorageEntry `json:"items"`
}

// StorageGet returns a single exact-match storage value.
func (s *Store) StorageGet(key string, scope Scope) (json.RawMessage, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	entry, ok := s.storage[storageKey(key, scope)]
	if !ok {
		return nil, false
	}
	return cloneRaw(entry.Value), true
}

// StorageSet upserts a single storage value.
func (s *Store) StorageSet(key string, value json.RawMessage, scope Scope) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if len(value) == 0 {
		value = json.RawMessage("null")
	}

	now := nowUTC()
	composite := storageKey(key, scope)
	entry, ok := s.storage[composite]
	if !ok {
		entry = &StorageEntry{
			Key:       key,
			Category:  scope.Category,
			ProjectID: cloneIntPtr(scope.ProjectID),
			UserID:    scope.UserID,
			CreatedAt: now,
		}
		s.storage[composite] = entry
	}
	entry.Value = cloneRaw(value)
	entry.UpdatedAt = now
	if entry.CreatedAt == "" {
		entry.CreatedAt = now
	}
	return s.saveStorageLocked()
}

// StorageDelete removes either an exact entry or every entry with the same raw key.
func (s *Store) StorageDelete(key string, scope *Scope) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	changed := false
	if scope != nil {
		if _, ok := s.storage[storageKey(key, *scope)]; ok {
			delete(s.storage, storageKey(key, *scope))
			changed = true
		}
	} else {
		for composite, entry := range s.storage {
			if entry.Key == key {
				delete(s.storage, composite)
				changed = true
			}
		}
	}
	if !changed {
		return nil
	}
	return s.saveStorageLocked()
}

// StorageBatchGet returns exact-match values for the provided keys.
func (s *Store) StorageBatchGet(keys []string, scope Scope) map[string]json.RawMessage {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make(map[string]json.RawMessage)
	for _, key := range keys {
		if entry, ok := s.storage[storageKey(key, scope)]; ok {
			result[key] = cloneRaw(entry.Value)
		}
	}
	return result
}

// StorageBatchSet upserts many storage values in a single write.
func (s *Store) StorageBatchSet(items map[string]json.RawMessage, scope Scope) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := nowUTC()
	for key, value := range items {
		if len(value) == 0 {
			value = json.RawMessage("null")
		}
		composite := storageKey(key, scope)
		entry, ok := s.storage[composite]
		if !ok {
			entry = &StorageEntry{
				Key:       key,
				Category:  scope.Category,
				ProjectID: cloneIntPtr(scope.ProjectID),
				UserID:    scope.UserID,
				CreatedAt: now,
			}
			s.storage[composite] = entry
		}
		entry.Value = cloneRaw(value)
		entry.UpdatedAt = now
		if entry.CreatedAt == "" {
			entry.CreatedAt = now
		}
	}
	return s.saveStorageLocked()
}

// StorageList returns entries matching the provided filter scope.
func (s *Store) StorageList(scope Scope) []StorageEntry {
	s.mu.RLock()
	defer s.mu.RUnlock()

	items := make([]StorageEntry, 0, len(s.storage))
	for _, entry := range s.storage {
		if !matchesScope(entry.Category, entry.ProjectID, entry.UserID, scope) {
			continue
		}
		items = append(items, cloneStorageEntry(entry))
	}

	sort.Slice(items, func(i, j int) bool {
		return storageKey(items[i].Key, Scope{
			Category:  items[i].Category,
			ProjectID: items[i].ProjectID,
			UserID:    items[i].UserID,
		}) < storageKey(items[j].Key, Scope{
			Category:  items[j].Category,
			ProjectID: items[j].ProjectID,
			UserID:    items[j].UserID,
		})
	})
	return items
}

func (s *Store) loadStorage() {
	var file storageFile
	if err := s.loadJSON(storageFileName, &file); err != nil {
		return
	}
	for _, item := range file.Items {
		entry := item
		s.storage[storageKey(item.Key, Scope{
			Category:  item.Category,
			ProjectID: item.ProjectID,
			UserID:    item.UserID,
		})] = &entry
	}
}

func (s *Store) saveStorageLocked() error {
	items := make([]StorageEntry, 0, len(s.storage))
	for _, entry := range s.storage {
		items = append(items, cloneStorageEntry(entry))
	}
	sort.Slice(items, func(i, j int) bool {
		return storageKey(items[i].Key, Scope{
			Category:  items[i].Category,
			ProjectID: items[i].ProjectID,
			UserID:    items[i].UserID,
		}) < storageKey(items[j].Key, Scope{
			Category:  items[j].Category,
			ProjectID: items[j].ProjectID,
			UserID:    items[j].UserID,
		})
	})
	return s.saveJSON(storageFileName, storageFile{Items: items})
}

func storageKey(key string, scope Scope) string {
	parts := []string{scope.Category}
	if scope.ProjectID != nil {
		parts = append(parts, strconv.Itoa(*scope.ProjectID))
	} else {
		parts = append(parts, "")
	}
	parts = append(parts, scope.UserID, key)
	return strings.Join(parts, "\x1f")
}

func matchesScope(category string, projectID *int, userID string, scope Scope) bool {
	if scope.Category != "" && category != scope.Category {
		return false
	}
	if scope.ProjectID != nil {
		if projectID == nil || *projectID != *scope.ProjectID {
			return false
		}
	}
	if scope.UserID != "" && userID != scope.UserID {
		return false
	}
	return true
}

func cloneRaw(raw json.RawMessage) json.RawMessage {
	if raw == nil {
		return nil
	}
	cp := make(json.RawMessage, len(raw))
	copy(cp, raw)
	return cp
}

func cloneStorageEntry(entry *StorageEntry) StorageEntry {
	return StorageEntry{
		Key:       entry.Key,
		Category:  entry.Category,
		ProjectID: cloneIntPtr(entry.ProjectID),
		UserID:    entry.UserID,
		Value:     cloneRaw(entry.Value),
		CreatedAt: entry.CreatedAt,
		UpdatedAt: entry.UpdatedAt,
	}
}
