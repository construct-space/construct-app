// Package state provides file-backed local state for Construct-facing features.
package state

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	storageFileName         = "storage.json"
	kvFileName              = "kv.json"
	settingsFileName        = "settings.json"
	pinnedFileName          = "pinned.json"
	designsFileName         = "designs.json"
	projectSettingsFileName = "project-settings.json"
	skillStatesFileName     = "skill-states.json"
	hookStatesFileName      = "hook-states.json"
	mcpStatesFileName       = "mcp-states.json"
)

// Scope identifies the optional namespace for storage and kv entries.
type Scope struct {
	Category  string
	ProjectID *int
	UserID    string
}

func (s Scope) hasFilters() bool {
	return s.Category != "" || s.ProjectID != nil || s.UserID != ""
}

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

// SettingEntry stores user-configurable settings.
type SettingEntry struct {
	Key       string `json:"key"`
	Value     string `json:"value"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

// ProjectSettings stores machine-local project configuration.
type ProjectSettings struct {
	ProjectID  int    `json:"projectId"`
	LocalPath  string `json:"localPath,omitempty"`
	EditorPath string `json:"editorPath,omitempty"`
	SyncedAt   string `json:"syncedAt,omitempty"`
	UpdatedAt  string `json:"updatedAt"`
}

// PinnedItem is the persisted shape Construct expects.
type PinnedItem struct {
	ID        string         `json:"id"`
	Type      string         `json:"type"`
	Name      string         `json:"name"`
	Icon      string         `json:"icon"`
	Path      string         `json:"path"`
	Color     string         `json:"color,omitempty"`
	Metadata  map[string]any `json:"metadata,omitempty"`
	PinnedAt  string         `json:"pinnedAt"`
	SortOrder *int           `json:"sortOrder,omitempty"`
}

// PinnedOrder updates sort order for a pinned item.
type PinnedOrder struct {
	ID        string `json:"id"`
	SortOrder int    `json:"sortOrder"`
}

// DesignRecord is the canonical persisted shape for saved designs.
type DesignRecord struct {
	ID           int    `json:"id"`
	LocalID      string `json:"local_id"`
	ProjectID    *int   `json:"project_id,omitempty"`
	Name         string `json:"name"`
	NodesJSON    string `json:"nodes_json,omitempty"`
	PagesJSON    string `json:"pages_json,omitempty"`
	ViewportJSON string `json:"viewport_json,omitempty"`
	HistoryJSON  string `json:"history_json,omitempty"`
	HistoryIndex int    `json:"history_index"`
	SyncedAt     string `json:"synced_at,omitempty"`
	CreatedAt    string `json:"created_at"`
	UpdatedAt    string `json:"updated_at"`
}

// DesignInput is the normalized write input for saved designs.
type DesignInput struct {
	LocalID      string
	ProjectID    *int
	Name         string
	NodesJSON    string
	PagesJSON    string
	ViewportJSON string
	HistoryJSON  string
	HistoryIndex int
	SyncedAt     string
	CreatedAt    string
}

type storageFile struct {
	Items []StorageEntry `json:"items"`
}

type kvFile struct {
	Items []KVEntry `json:"items"`
}

type settingsFile struct {
	Items []SettingEntry `json:"items"`
}

type pinnedFile struct {
	Items []PinnedItem `json:"items"`
}

type designsFile struct {
	Items []DesignRecord `json:"items"`
}

type projectSettingsFile struct {
	Items []ProjectSettings `json:"items"`
}

// Store keeps local Construct-facing state in memory and on disk.
type Store struct {
	mu              sync.RWMutex
	dir             string
	storage         map[string]*StorageEntry
	kv              map[string]*KVEntry
	settings        map[string]*SettingEntry
	pinned          map[string]*PinnedItem
	designs         map[string]*DesignRecord
	projectSettings map[int]*ProjectSettings
	skillStates     map[string]*SkillRuntimeState
	hookStates      map[string]*HookRuntimeState
	mcpStates       map[string]*MCPRuntimeState
	nextDesignID    int
}

// NewStore creates a new file-backed store rooted at dir.
func NewStore(dir string) *Store {
	s := &Store{
		dir:             dir,
		storage:         make(map[string]*StorageEntry),
		kv:              make(map[string]*KVEntry),
		settings:        make(map[string]*SettingEntry),
		pinned:          make(map[string]*PinnedItem),
		designs:         make(map[string]*DesignRecord),
		projectSettings: make(map[int]*ProjectSettings),
		skillStates:     make(map[string]*SkillRuntimeState),
		hookStates:      make(map[string]*HookRuntimeState),
		mcpStates:       make(map[string]*MCPRuntimeState),
		nextDesignID:    1,
	}
	if dir != "" {
		_ = os.MkdirAll(dir, 0o755)
		s.loadAll()
	}
	return s
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

// ProjectSettingsGet returns project-local settings for a project id.
func (s *Store) ProjectSettingsGet(projectID int) (ProjectSettings, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	entry, ok := s.projectSettings[projectID]
	if !ok {
		return ProjectSettings{}, false
	}
	return *entry, true
}

// ProjectSettingsSet upserts project-local settings.
func (s *Store) ProjectSettingsSet(settings ProjectSettings) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if settings.ProjectID == 0 {
		return fmt.Errorf("projectId is required")
	}
	if settings.UpdatedAt == "" {
		settings.UpdatedAt = nowUTC()
	}
	copy := settings
	s.projectSettings[settings.ProjectID] = &copy
	return s.saveProjectSettingsLocked()
}

// PinnedList returns pinned items sorted for the frontend.
func (s *Store) PinnedList() []PinnedItem {
	s.mu.RLock()
	defer s.mu.RUnlock()

	items := make([]PinnedItem, 0, len(s.pinned))
	for _, item := range s.pinned {
		items = append(items, clonePinnedItem(item))
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].SortOrder != nil && items[j].SortOrder != nil {
			return *items[i].SortOrder < *items[j].SortOrder
		}
		return parseTime(items[i].PinnedAt).After(parseTime(items[j].PinnedAt))
	})
	return items
}

// PinnedAdd upserts a pinned item.
func (s *Store) PinnedAdd(item PinnedItem) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if item.ID == "" {
		return fmt.Errorf("id is required")
	}
	if item.PinnedAt == "" {
		item.PinnedAt = nowUTC()
	}
	copy := item
	s.pinned[item.ID] = &copy
	return s.savePinnedLocked()
}

// PinnedRemove deletes a pinned item.
func (s *Store) PinnedRemove(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.pinned[id]; !ok {
		return nil
	}
	delete(s.pinned, id)
	return s.savePinnedLocked()
}

// PinnedReorder updates sort order for pinned items.
func (s *Store) PinnedReorder(items []PinnedOrder) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for _, item := range items {
		existing, ok := s.pinned[item.ID]
		if !ok {
			continue
		}
		sortOrder := item.SortOrder
		existing.SortOrder = &sortOrder
	}
	return s.savePinnedLocked()
}

// DesignGet returns a saved design by local id.
func (s *Store) DesignGet(localID string) (DesignRecord, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	entry, ok := s.designs[localID]
	if !ok {
		return DesignRecord{}, false
	}
	return *entry, true
}

// DesignList returns saved designs filtered by project id when provided.
func (s *Store) DesignList(projectID *int) []DesignRecord {
	s.mu.RLock()
	defer s.mu.RUnlock()

	items := make([]DesignRecord, 0, len(s.designs))
	for _, entry := range s.designs {
		if projectID != nil {
			if entry.ProjectID == nil || *entry.ProjectID != *projectID {
				continue
			}
		}
		items = append(items, *entry)
	}
	sort.Slice(items, func(i, j int) bool {
		return parseTime(items[i].UpdatedAt).After(parseTime(items[j].UpdatedAt))
	})
	return items
}

// DesignSave upserts a saved design and returns the canonical record.
func (s *Store) DesignSave(input DesignInput) (DesignRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if input.LocalID == "" {
		return DesignRecord{}, fmt.Errorf("localId is required")
	}
	if input.Name == "" {
		return DesignRecord{}, fmt.Errorf("name is required")
	}

	now := nowUTC()
	record, ok := s.designs[input.LocalID]
	if !ok {
		record = &DesignRecord{
			ID:        s.nextDesignID,
			LocalID:   input.LocalID,
			CreatedAt: firstNonEmpty(input.CreatedAt, now),
		}
		s.nextDesignID++
		s.designs[input.LocalID] = record
	}

	record.LocalID = input.LocalID
	record.ProjectID = cloneIntPtr(input.ProjectID)
	record.Name = input.Name
	record.NodesJSON = input.NodesJSON
	record.PagesJSON = input.PagesJSON
	record.ViewportJSON = input.ViewportJSON
	record.HistoryJSON = input.HistoryJSON
	record.HistoryIndex = input.HistoryIndex
	record.SyncedAt = input.SyncedAt
	record.UpdatedAt = now
	if record.CreatedAt == "" {
		record.CreatedAt = firstNonEmpty(input.CreatedAt, now)
	}

	if err := s.saveDesignsLocked(); err != nil {
		return DesignRecord{}, err
	}
	return *record, nil
}

// DesignDelete removes a saved design.
func (s *Store) DesignDelete(localID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.designs[localID]; !ok {
		return nil
	}
	delete(s.designs, localID)
	return s.saveDesignsLocked()
}

// ResponseMap returns a hybrid camelCase+snake_case response for legacy callers.
func (d DesignRecord) ResponseMap() map[string]any {
	result := map[string]any{
		"id":            d.ID,
		"localId":       d.LocalID,
		"local_id":      d.LocalID,
		"name":          d.Name,
		"history_index": d.HistoryIndex,
		"createdAt":     d.CreatedAt,
		"created_at":    d.CreatedAt,
		"updatedAt":     d.UpdatedAt,
		"updated_at":    d.UpdatedAt,
	}
	if d.ProjectID != nil {
		result["projectId"] = *d.ProjectID
		result["project_id"] = *d.ProjectID
	}
	if d.NodesJSON != "" {
		result["nodes_json"] = d.NodesJSON
		if decoded, ok := decodeJSONArray(d.NodesJSON); ok {
			result["nodes"] = decoded
		}
	}
	if d.PagesJSON != "" {
		result["pages_json"] = d.PagesJSON
		if decoded, ok := decodeJSONArray(d.PagesJSON); ok {
			result["pages"] = decoded
		}
	}
	if d.ViewportJSON != "" {
		result["viewport_json"] = d.ViewportJSON
	}
	if d.HistoryJSON != "" {
		result["history_json"] = d.HistoryJSON
	}
	if d.SyncedAt != "" {
		result["syncedAt"] = d.SyncedAt
		result["synced_at"] = d.SyncedAt
	}
	return result
}

func (s *Store) loadAll() {
	s.loadStorage()
	s.loadKV()
	s.loadSettings()
	s.loadPinned()
	s.loadDesigns()
	s.loadProjectSettings()
	s.loadSkillStates()
	s.loadHookStates()
	s.loadMCPStates()
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

func (s *Store) loadPinned() {
	var file pinnedFile
	if err := s.loadJSON(pinnedFileName, &file); err != nil {
		return
	}
	for _, item := range file.Items {
		entry := item
		s.pinned[item.ID] = &entry
	}
}

func (s *Store) loadDesigns() {
	var file designsFile
	if err := s.loadJSON(designsFileName, &file); err != nil {
		return
	}
	maxID := 0
	for _, item := range file.Items {
		entry := item
		s.designs[item.LocalID] = &entry
		if item.ID > maxID {
			maxID = item.ID
		}
	}
	s.nextDesignID = maxID + 1
	if s.nextDesignID < 1 {
		s.nextDesignID = 1
	}
}

func (s *Store) loadProjectSettings() {
	var file projectSettingsFile
	if err := s.loadJSON(projectSettingsFileName, &file); err != nil {
		return
	}
	for _, item := range file.Items {
		entry := item
		s.projectSettings[item.ProjectID] = &entry
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

func (s *Store) saveSettingsLocked() error {
	items := make([]SettingEntry, 0, len(s.settings))
	for _, entry := range s.settings {
		items = append(items, *entry)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Key < items[j].Key })
	return s.saveJSON(settingsFileName, settingsFile{Items: items})
}

func (s *Store) savePinnedLocked() error {
	items := make([]PinnedItem, 0, len(s.pinned))
	for _, item := range s.pinned {
		items = append(items, clonePinnedItem(item))
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].SortOrder != nil && items[j].SortOrder != nil {
			return *items[i].SortOrder < *items[j].SortOrder
		}
		return parseTime(items[i].PinnedAt).After(parseTime(items[j].PinnedAt))
	})
	return s.saveJSON(pinnedFileName, pinnedFile{Items: items})
}

func (s *Store) saveDesignsLocked() error {
	items := make([]DesignRecord, 0, len(s.designs))
	for _, item := range s.designs {
		items = append(items, *item)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].ID < items[j].ID })
	return s.saveJSON(designsFileName, designsFile{Items: items})
}

func (s *Store) saveProjectSettingsLocked() error {
	items := make([]ProjectSettings, 0, len(s.projectSettings))
	for _, item := range s.projectSettings {
		items = append(items, *item)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].ProjectID < items[j].ProjectID })
	return s.saveJSON(projectSettingsFileName, projectSettingsFile{Items: items})
}

func (s *Store) loadJSON(name string, dest any) error {
	if s.dir == "" {
		return nil
	}
	path := filepath.Join(s.dir, name)
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		fmt.Fprintf(os.Stderr, "[state] warning: read %s: %v\n", name, err)
		return err
	}
	if len(data) == 0 {
		return nil
	}
	if err := json.Unmarshal(data, dest); err != nil {
		fmt.Fprintf(os.Stderr, "[state] warning: parse %s: %v\n", name, err)
		return err
	}
	return nil
}

func (s *Store) saveJSON(name string, value any) error {
	if s.dir == "" {
		return nil
	}
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	path := filepath.Join(s.dir, name)
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
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

func kvKey(key, category string) string {
	return category + "\x1f" + key
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

func cloneIntPtr(v *int) *int {
	if v == nil {
		return nil
	}
	cp := *v
	return &cp
}

func clonePinnedItem(item *PinnedItem) PinnedItem {
	clone := PinnedItem{
		ID:        item.ID,
		Type:      item.Type,
		Name:      item.Name,
		Icon:      item.Icon,
		Path:      item.Path,
		Color:     item.Color,
		PinnedAt:  item.PinnedAt,
		SortOrder: cloneIntPtr(item.SortOrder),
	}
	if len(item.Metadata) > 0 {
		clone.Metadata = make(map[string]any, len(item.Metadata))
		for key, value := range item.Metadata {
			clone.Metadata[key] = value
		}
	}
	return clone
}

func nowUTC() string {
	return time.Now().UTC().Format(time.RFC3339)
}

func parseTime(value string) time.Time {
	if value == "" {
		return time.Time{}
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return time.Time{}
	}
	return parsed
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func decodeJSONArray(raw string) ([]any, bool) {
	var decoded []any
	if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
		return nil, false
	}
	return decoded, true
}
