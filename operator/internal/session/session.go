// Package session tracks agent execution state.
// Sessions are standalone, stored in a proper session store.
package session

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"construct-operator/internal/provider"

	"github.com/google/uuid"
)

// State is the lifecycle state of a session.
type State string

const (
	StateRunning   State = "running"
	StateCompleted State = "completed"
	StateFailed    State = "failed"
)

// Session tracks one agent run.
type Session struct {
	ID        string             `json:"id"`
	AgentID   string             `json:"agent_id"`
	ParentID  string             `json:"parent_id,omitempty"` // For sub-agent sessions
	State     State              `json:"state"`
	StartTime time.Time          `json:"start_time"`
	EndTime   time.Time          `json:"end_time,omitempty"`
	Turns     int                `json:"turns"`
	Error     string             `json:"error,omitempty"`
	Messages  []provider.Message `json:"messages,omitempty"`
}

func (s *Session) Complete() {
	s.State = StateCompleted
	s.EndTime = time.Now()
}

func (s *Session) SetError(err string) {
	s.State = StateFailed
	s.Error = err
	s.EndTime = time.Now()
}

func (s *Session) AddTurn() {
	s.Turns++
}

// Store is a thread-safe session store with optional disk persistence.
type Store struct {
	mu       sync.RWMutex
	sessions map[string]*Session
	dir      string // empty = in-memory only
}

// NewStore creates a session store. If dir is non-empty, sessions are
// persisted to disk as JSON files and loaded on startup.
func NewStore(dir string) *Store {
	s := &Store{
		sessions: make(map[string]*Session),
		dir:      dir,
	}
	if dir != "" {
		s.loadAll()
	}
	return s
}

func (s *Store) Create(agentID string) *Session {
	sess := &Session{
		ID:        uuid.New().String(),
		AgentID:   agentID,
		State:     StateRunning,
		StartTime: time.Now(),
	}
	s.mu.Lock()
	s.sessions[sess.ID] = sess
	s.mu.Unlock()
	return sess
}

func (s *Store) Get(id string) (*Session, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	sess, ok := s.sessions[id]
	return sess, ok
}

func (s *Store) List() []*Session {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]*Session, 0, len(s.sessions))
	for _, sess := range s.sessions {
		result = append(result, sess)
	}
	return result
}

// Save persists a session to disk as JSON. No-op if dir is empty.
func (s *Store) Save(sess *Session) error {
	if s.dir == "" {
		return nil
	}
	data, err := json.MarshalIndent(sess, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal session %s: %w", sess.ID, err)
	}
	path := filepath.Join(s.dir, sess.ID+".json")
	return os.WriteFile(path, data, 0644)
}

// loadAll scans the sessions directory and populates the in-memory map.
func (s *Store) loadAll() {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".json" {
			continue
		}
		data, err := os.ReadFile(filepath.Join(s.dir, e.Name()))
		if err != nil {
			continue
		}
		var sess Session
		if err := json.Unmarshal(data, &sess); err != nil {
			continue
		}
		s.sessions[sess.ID] = &sess
	}
	if len(s.sessions) > 0 {
		fmt.Fprintf(os.Stderr, "[session] loaded %d sessions from disk\n", len(s.sessions))
	}
}
