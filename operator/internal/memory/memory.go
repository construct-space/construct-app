// Package memory implements persistent memory for agents.
// Inspired by Claude Code's file-based memory and mem0's semantic retrieval.
// Agents can remember project context, user preferences, and past decisions.
package memory

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// Entry is a single memory item.
type Entry struct {
	ID          string    `json:"id"`
	Type        string    `json:"type"` // user, feedback, project, reference
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Content     string    `json:"content"`
	Tags        []string  `json:"tags,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// Store persists and retrieves memories.
type Store struct {
	dir   string
	mu    sync.RWMutex
	cache map[string]*Entry // in-memory cache for fast search
}

func NewStore(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, err
	}
	s := &Store{dir: dir, cache: make(map[string]*Entry)}
	s.loadAll()
	return s, nil
}

// Save writes a memory entry to disk and updates the cache.
func (s *Store) Save(entry *Entry) error {
	entry.UpdatedAt = time.Now()
	if entry.CreatedAt.IsZero() {
		entry.CreatedAt = entry.UpdatedAt
	}

	data, err := json.MarshalIndent(entry, "", "  ")
	if err != nil {
		return err
	}

	path := filepath.Join(s.dir, entry.ID+".json")
	if err := os.WriteFile(path, data, 0644); err != nil {
		return err
	}

	s.mu.Lock()
	s.cache[entry.ID] = entry
	s.mu.Unlock()
	return nil
}

// Get retrieves a memory entry by ID.
func (s *Store) Get(id string) (*Entry, error) {
	s.mu.RLock()
	if entry, ok := s.cache[id]; ok {
		s.mu.RUnlock()
		return entry, nil
	}
	s.mu.RUnlock()

	// Cache miss — load from disk
	path := filepath.Join(s.dir, id+".json")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var entry Entry
	if err := json.Unmarshal(data, &entry); err != nil {
		return nil, err
	}

	s.mu.Lock()
	s.cache[entry.ID] = &entry
	s.mu.Unlock()
	return &entry, nil
}

// Delete removes a memory entry.
func (s *Store) Delete(id string) error {
	s.mu.Lock()
	delete(s.cache, id)
	s.mu.Unlock()

	path := filepath.Join(s.dir, id+".json")
	return os.Remove(path)
}

// List returns all memory entries, sorted by update time (newest first).
func (s *Store) List() ([]*Entry, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make([]*Entry, 0, len(s.cache))
	for _, entry := range s.cache {
		result = append(result, entry)
	}

	sort.Slice(result, func(i, j int) bool {
		return result[i].UpdatedAt.After(result[j].UpdatedAt)
	})
	return result, nil
}

// ListByType returns entries filtered by type.
func (s *Store) ListByType(typ string) ([]*Entry, error) {
	all, err := s.List()
	if err != nil {
		return nil, err
	}
	var filtered []*Entry
	for _, entry := range all {
		if entry.Type == typ {
			filtered = append(filtered, entry)
		}
	}
	return filtered, nil
}

// Search finds memories matching a query using keyword matching.
// Searches across name, description, content, and tags.
func (s *Store) Search(query string) ([]*Entry, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	query = strings.ToLower(query)
	words := strings.Fields(query)

	type scored struct {
		entry *Entry
		score int
	}
	var results []scored

	for _, entry := range s.cache {
		score := 0
		searchable := strings.ToLower(entry.Name + " " + entry.Description + " " + entry.Content + " " + strings.Join(entry.Tags, " "))

		for _, word := range words {
			count := strings.Count(searchable, word)
			if count > 0 {
				score += count
				// Bonus for name/tag matches
				if strings.Contains(strings.ToLower(entry.Name), word) {
					score += 3
				}
				for _, tag := range entry.Tags {
					if strings.Contains(strings.ToLower(tag), word) {
						score += 2
					}
				}
			}
		}

		if score > 0 {
			results = append(results, scored{entry, score})
		}
	}

	// Sort by score descending
	sort.Slice(results, func(i, j int) bool {
		return results[i].score > results[j].score
	})

	entries := make([]*Entry, len(results))
	for i, r := range results {
		entries[i] = r.entry
	}
	return entries, nil
}

// SearchByTags finds entries that have any of the given tags.
func (s *Store) SearchByTags(tags []string) ([]*Entry, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	tagSet := make(map[string]bool)
	for _, t := range tags {
		tagSet[strings.ToLower(t)] = true
	}

	var matches []*Entry
	for _, entry := range s.cache {
		for _, t := range entry.Tags {
			if tagSet[strings.ToLower(t)] {
				matches = append(matches, entry)
				break
			}
		}
	}
	return matches, nil
}

// loadAll populates the in-memory cache from disk.
func (s *Store) loadAll() {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if filepath.Ext(e.Name()) != ".json" {
			continue
		}
		data, err := os.ReadFile(filepath.Join(s.dir, e.Name()))
		if err != nil {
			continue
		}
		var entry Entry
		if err := json.Unmarshal(data, &entry); err != nil {
			continue
		}
		s.cache[entry.ID] = &entry
	}
}

// ForContext builds a context string from relevant memories for an agent prompt.
func (s *Store) ForContext(query string, maxEntries int) string {
	entries, err := s.Search(query)
	if err != nil || len(entries) == 0 {
		return ""
	}

	if maxEntries > 0 && len(entries) > maxEntries {
		entries = entries[:maxEntries]
	}

	var sb strings.Builder
	sb.WriteString("## Relevant Memories\n\n")
	for _, entry := range entries {
		sb.WriteString("### ")
		sb.WriteString(entry.Name)
		sb.WriteString(" (")
		sb.WriteString(entry.Type)
		sb.WriteString(")\n")
		sb.WriteString(entry.Content)
		sb.WriteString("\n\n")
	}
	return sb.String()
}
