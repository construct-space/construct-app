package state

import (
	"fmt"
	"sort"
)

// ProjectSettings stores machine-local project configuration.
type ProjectSettings struct {
	ProjectID  int    `json:"projectId"`
	LocalPath  string `json:"localPath,omitempty"`
	EditorPath string `json:"editorPath,omitempty"`
	SyncedAt   string `json:"syncedAt,omitempty"`
	UpdatedAt  string `json:"updatedAt"`
}

type projectSettingsFile struct {
	Items []ProjectSettings `json:"items"`
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

func (s *Store) saveProjectSettingsLocked() error {
	items := make([]ProjectSettings, 0, len(s.projectSettings))
	for _, item := range s.projectSettings {
		items = append(items, *item)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].ProjectID < items[j].ProjectID })
	return s.saveJSON(projectSettingsFileName, projectSettingsFile{Items: items})
}
