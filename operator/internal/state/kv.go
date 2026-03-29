package state

import "sort"

// KVEntry stores string values keyed by name/category.
type KVEntry struct {
	Key       string `json:"key"`
	Value     string `json:"value"`
	Category  string `json:"category,omitempty"`
	UserID    string `json:"user_id,omitempty"`
	ProjectID *int   `json:"project_id,omitempty"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

type kvFile struct {
	Items []KVEntry `json:"items"`
}

// KVGet returns a single kv value.
func (s *Store) KVGet(key, category string) (string, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	entry, ok := s.kv[kvKey(key, category)]
	if !ok {
		return "", false
	}
	return entry.Value, true
}

// KVSet upserts a kv value.
func (s *Store) KVSet(key, value, category string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := nowUTC()
	composite := kvKey(key, category)
	entry, ok := s.kv[composite]
	if !ok {
		entry = &KVEntry{
			Key:       key,
			Category:  category,
			CreatedAt: now,
		}
		s.kv[composite] = entry
	}
	entry.Value = value
	entry.UpdatedAt = now
	if entry.CreatedAt == "" {
		entry.CreatedAt = now
	}
	return s.saveKVLocked()
}

// KVDelete removes kv entries by key, optionally scoped by category.
func (s *Store) KVDelete(key, category string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	changed := false
	if category != "" {
		if _, ok := s.kv[kvKey(key, category)]; ok {
			delete(s.kv, kvKey(key, category))
			changed = true
		}
	} else {
		for composite, entry := range s.kv {
			if entry.Key == key {
				delete(s.kv, composite)
				changed = true
			}
		}
	}
	if !changed {
		return nil
	}
	return s.saveKVLocked()
}

// KVList returns kv entries, optionally filtered by category.
func (s *Store) KVList(category string) []KVEntry {
	s.mu.RLock()
	defer s.mu.RUnlock()

	items := make([]KVEntry, 0, len(s.kv))
	for _, entry := range s.kv {
		if category != "" && entry.Category != category {
			continue
		}
		items = append(items, *entry)
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Category == items[j].Category {
			return items[i].Key < items[j].Key
		}
		return items[i].Category < items[j].Category
	})
	return items
}

func (s *Store) loadKV() {
	var file kvFile
	if err := s.loadJSON(kvFileName, &file); err != nil {
		return
	}
	for _, item := range file.Items {
		entry := item
		s.kv[kvKey(item.Key, item.Category)] = &entry
	}
}

func (s *Store) saveKVLocked() error {
	items := make([]KVEntry, 0, len(s.kv))
	for _, entry := range s.kv {
		items = append(items, *entry)
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Category == items[j].Category {
			return items[i].Key < items[j].Key
		}
		return items[i].Category < items[j].Category
	})
	return s.saveJSON(kvFileName, kvFile{Items: items})
}

func kvKey(key, category string) string {
	return category + "\x1f" + key
}
