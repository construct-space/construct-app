// Package vibe provides vibe session persistence.
// Sessions are stored as JSON files in the data directory.
package vibe

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

// GoalEntry represents a single goal within a session.
type GoalEntry struct {
	Text      string    `json:"text"`
	Status    string    `json:"status,omitempty"` // running, completed, failed
	CreatedAt time.Time `json:"created_at"`
}

// Session represents a vibe execution session.
// A session is scoped to a project and can have multiple goals over time.
type Session struct {
	ID            string            `json:"id"`
	ProjectID     string            `json:"project_id,omitempty"`
	ProjectName   string            `json:"project_name,omitempty"`
	ProjectPath   string            `json:"project_path,omitempty"`
	Goal          string            `json:"goal"`              // Current/latest goal (for backward compat)
	Goals         []GoalEntry       `json:"goals,omitempty"`   // All goals in this session
	Source        string            `json:"source,omitempty"`
	SessionType   string            `json:"session_type,omitempty"`
	AutonomyLevel string            `json:"autonomy_level,omitempty"`
	Status        string            `json:"status,omitempty"`
	CurrentPhase  string            `json:"current_phase,omitempty"`
	NextStep      string            `json:"next_step,omitempty"`
	Verification  map[string]string `json:"verification,omitempty"`
	Events        []Event           `json:"events,omitempty"`
	Checkpoints   []Checkpoint      `json:"checkpoints,omitempty"`
	CreatedAt     time.Time         `json:"created_at"`
	UpdatedAt     time.Time         `json:"updated_at"`
}

// AddGoal appends a new goal to the session and sets it as current.
func (s *Session) AddGoal(text string) {
	// Mark previous goal as completed/failed based on session status
	if len(s.Goals) > 0 {
		prev := &s.Goals[len(s.Goals)-1]
		if prev.Status == "running" {
			prev.Status = s.Status
		}
	}
	s.Goals = append(s.Goals, GoalEntry{
		Text:      text,
		Status:    "running",
		CreatedAt: time.Now(),
	})
	s.Goal = text
	s.Status = "running"
}

// Event represents an event in the vibe session log.
type Event struct {
	ID        int                    `json:"id"`
	EventType string                 `json:"event_type"`
	Phase     string                 `json:"phase,omitempty"`
	Data      map[string]interface{} `json:"data,omitempty"`
	CreatedAt time.Time              `json:"created_at"`
}

// Checkpoint represents a git checkpoint for a vibe session.
type Checkpoint struct {
	ID          int       `json:"id"`
	Branch      string    `json:"branch"`
	CommitHash  string    `json:"commit_hash,omitempty"`
	Description string    `json:"description,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

// Store is a file-backed vibe session store.
type Store struct {
	mu       sync.RWMutex
	sessions map[string]*Session
	dir      string
}

// NewStore creates a vibe session store. Sessions are persisted as JSON files.
func NewStore(dir string) *Store {
	s := &Store{
		sessions: make(map[string]*Session),
		dir:      dir,
	}
	os.MkdirAll(dir, 0755)
	s.loadAll()
	return s
}

// Create creates a new vibe session.
func (s *Store) Create(goal, projectID string) *Session {
	now := time.Now()
	sess := &Session{
		ID:        uuid.New().String(),
		Goal:      goal,
		Goals:     []GoalEntry{{Text: goal, Status: "running", CreatedAt: now}},
		ProjectID: projectID,
		Status:    "running",
		CreatedAt: now,
		UpdatedAt: now,
	}
	s.mu.Lock()
	s.sessions[sess.ID] = sess
	s.mu.Unlock()
	s.save(sess)
	return sess
}

// Get retrieves a session by ID.
func (s *Store) Get(id string) (*Session, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	sess, ok := s.sessions[id]
	return sess, ok
}

// List returns sessions, optionally filtered by project ID or path, sorted by updated_at desc.
func (s *Store) List(projectID string) []*Session {
	return s.ListByIDOrPath(projectID, "")
}

// ListByIDOrPath returns sessions matching projectID or projectPath.
// Also checks .construct/vibe.json in the project directory for session references.
// If both are empty, returns all sessions.
func (s *Store) ListByIDOrPath(projectID, projectPath string) []*Session {
	hasFilter := projectID != "" || projectPath != ""

	if !hasFilter {
		s.mu.RLock()
		defer s.mu.RUnlock()
		var result []*Session
		for _, sess := range s.sessions {
			result = append(result, sess)
		}
		sort.Slice(result, func(i, j int) bool {
			return result[i].UpdatedAt.After(result[j].UpdatedAt)
		})
		return result
	}

	// Try .construct/vibe.json first — it's the authoritative per-project index
	if projectPath != "" {
		if projectSessions := s.LoadProjectSessions(projectPath); len(projectSessions) > 0 {
			return projectSessions
		}
	}

	// Fall back to scanning all sessions by ID/path match
	s.mu.RLock()
	defer s.mu.RUnlock()
	var result []*Session
	for _, sess := range s.sessions {
		if projectID != "" && sess.ProjectID == projectID {
			result = append(result, sess)
			continue
		}
		if projectPath != "" && sess.ProjectPath == projectPath {
			result = append(result, sess)
			continue
		}
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].UpdatedAt.After(result[j].UpdatedAt)
	})
	return result
}

// Update updates a session and persists it.
func (s *Store) Update(sess *Session) {
	sess.UpdatedAt = time.Now()
	s.mu.Lock()
	s.sessions[sess.ID] = sess
	s.mu.Unlock()
	s.save(sess)
}

// Delete removes a session.
func (s *Store) Delete(id string) error {
	s.mu.Lock()
	sess := s.sessions[id]
	delete(s.sessions, id)
	s.mu.Unlock()

	// Remove from project's .construct/vibe.json if applicable
	if sess != nil && sess.ProjectPath != "" {
		s.removeFromProjectVibeJSON(sess.ProjectPath, id)
	}

	path := filepath.Join(s.dir, id+".json")
	return os.Remove(path)
}

func (s *Store) removeFromProjectVibeJSON(projectPath, sessionID string) {
	vibeJSONPath := filepath.Join(projectPath, ".construct", "vibe.json")
	data, err := os.ReadFile(vibeJSONPath)
	if err != nil {
		return
	}
	var file vibeProjectFile
	if err := json.Unmarshal(data, &file); err != nil {
		return
	}
	filtered := make([]vibeProjectRef, 0, len(file.Sessions))
	for _, ref := range file.Sessions {
		if ref.ID != sessionID {
			filtered = append(filtered, ref)
		}
	}
	file.Sessions = filtered
	out, _ := json.MarshalIndent(file, "", "  ")
	os.WriteFile(vibeJSONPath, out, 0644)
}

// AppendEvent adds an event to a session.
func (s *Store) AppendEvent(sessionID string, event Event) {
	s.mu.Lock()
	sess, ok := s.sessions[sessionID]
	if ok {
		event.ID = len(sess.Events) + 1
		event.CreatedAt = time.Now()
		sess.Events = append(sess.Events, event)
		sess.UpdatedAt = time.Now()
	}
	s.mu.Unlock()
	if ok {
		s.save(sess)
	}
}

func (s *Store) save(sess *Session) {
	if s.dir == "" {
		return
	}
	data, err := json.MarshalIndent(sess, "", "  ")
	if err != nil {
		return
	}
	path := filepath.Join(s.dir, sess.ID+".json")
	os.WriteFile(path, data, 0644)

	// Sync to project's .construct/vibe.json if project path is known
	if sess.ProjectPath != "" {
		s.syncProjectVibeJSON(sess)
	}
}

// vibeProjectRef is a session reference stored in .construct/vibe.json.
type vibeProjectRef struct {
	ID         string `json:"id"`
	Goal       string `json:"goal"`
	GoalCount  int    `json:"goal_count,omitempty"`
	Status     string `json:"status,omitempty"`
	CreatedAt  string `json:"created_at,omitempty"`
	UpdatedAt  string `json:"updated_at,omitempty"`
}

type vibeProjectFile struct {
	Sessions []vibeProjectRef `json:"sessions"`
}

// syncProjectVibeJSON writes/updates .construct/vibe.json in the project directory.
func (s *Store) syncProjectVibeJSON(sess *Session) {
	projectPath := strings.TrimSpace(sess.ProjectPath)
	if projectPath == "" {
		return
	}
	vibeJSONPath := filepath.Join(projectPath, ".construct", "vibe.json")

	// Read existing file
	var file vibeProjectFile
	if data, err := os.ReadFile(vibeJSONPath); err == nil {
		json.Unmarshal(data, &file)
	}

	// Update or add this session
	found := false
	for i, ref := range file.Sessions {
		if ref.ID == sess.ID {
			file.Sessions[i] = vibeProjectRef{
				ID:        sess.ID,
				Goal:      sess.Goal,
				GoalCount: len(sess.Goals),
				Status:    sess.Status,
				CreatedAt: sess.CreatedAt.Format(time.RFC3339),
				UpdatedAt: sess.UpdatedAt.Format(time.RFC3339),
			}
			found = true
			break
		}
	}
	if !found {
		file.Sessions = append(file.Sessions, vibeProjectRef{
			ID:        sess.ID,
			Goal:      sess.Goal,
			GoalCount: len(sess.Goals),
			Status:    sess.Status,
			CreatedAt: sess.CreatedAt.Format(time.RFC3339),
			UpdatedAt: sess.UpdatedAt.Format(time.RFC3339),
		})
	}

	// Ensure .construct dir exists
	os.MkdirAll(filepath.Join(projectPath, ".construct"), 0755)

	data, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return
	}
	os.WriteFile(vibeJSONPath, data, 0644)
}

// LoadProjectSessions reads session IDs from a project's .construct/vibe.json
// and returns full sessions from the store.
func (s *Store) LoadProjectSessions(projectPath string) []*Session {
	vibeJSONPath := filepath.Join(strings.TrimSpace(projectPath), ".construct", "vibe.json")
	data, err := os.ReadFile(vibeJSONPath)
	if err != nil {
		return nil
	}
	var file vibeProjectFile
	if err := json.Unmarshal(data, &file); err != nil {
		return nil
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*Session
	for _, ref := range file.Sessions {
		if sess, ok := s.sessions[ref.ID]; ok {
			result = append(result, sess)
		}
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].UpdatedAt.After(result[j].UpdatedAt)
	})
	return result
}

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
		fmt.Fprintf(os.Stderr, "[vibe] loaded %d sessions from disk\n", len(s.sessions))
	}
}
