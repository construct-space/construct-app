package state

import (
	"encoding/json"
	"fmt"
	"sort"
)

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

type designsFile struct {
	Items []DesignRecord `json:"items"`
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

func (s *Store) saveDesignsLocked() error {
	items := make([]DesignRecord, 0, len(s.designs))
	for _, item := range s.designs {
		items = append(items, *item)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].ID < items[j].ID })
	return s.saveJSON(designsFileName, designsFile{Items: items})
}

func decodeJSONArray(raw string) ([]any, bool) {
	var decoded []any
	if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
		return nil, false
	}
	return decoded, true
}
