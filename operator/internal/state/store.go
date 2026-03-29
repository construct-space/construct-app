// Package state provides file-backed local state for Construct-facing features.
package state

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
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

func cloneIntPtr(v *int) *int {
	if v == nil {
		return nil
	}
	cp := *v
	return &cp
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
