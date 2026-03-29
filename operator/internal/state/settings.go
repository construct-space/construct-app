package state

import "sort"

// SettingEntry stores user-configurable settings.
type SettingEntry struct {
	Key       string `json:"key"`
	Value     string `json:"value"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

type settingsFile struct {
	Items []SettingEntry `json:"items"`
}

// SettingGet returns a saved setting value.
func (s *Store) SettingGet(key string) (string, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	entry, ok := s.settings[key]
	if !ok {
		return "", false
	}
	return entry.Value, true
}

// SettingSet upserts a setting value.
func (s *Store) SettingSet(key, value string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	now := nowUTC()
	entry, ok := s.settings[key]
	if !ok {
		entry = &SettingEntry{
			Key:       key,
			CreatedAt: now,
		}
		s.settings[key] = entry
	}
	entry.Value = value
	entry.UpdatedAt = now
	if entry.CreatedAt == "" {
		entry.CreatedAt = now
	}
	return s.saveSettingsLocked()
}

// Settings returns all saved settings keyed by name.
func (s *Store) Settings() map[string]string {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make(map[string]string, len(s.settings))
	for key, entry := range s.settings {
		result[key] = entry.Value
	}
	return result
}

func (s *Store) loadSettings() {
	var file settingsFile
	if err := s.loadJSON(settingsFileName, &file); err != nil {
		return
	}
	for _, item := range file.Items {
		entry := item
		s.settings[item.Key] = &entry
	}
}

func (s *Store) saveSettingsLocked() error {
	items := make([]SettingEntry, 0, len(s.settings))
	for _, entry := range s.settings {
		items = append(items, *entry)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Key < items[j].Key })
	return s.saveJSON(settingsFileName, settingsFile{Items: items})
}
