package state

import (
	"fmt"
	"sort"
)

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

type pinnedFile struct {
	Items []PinnedItem `json:"items"`
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
