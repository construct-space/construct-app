// Package chatsession provides local JSON file persistence for agent chat sessions.
//
// Sessions are saved as {session_id}.json in the chat-sessions directory.
// Each session contains the Turn-based block model matching the frontend
// useAgentSession.ts schema — the shared contract for all clients.
package chatsession

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Block types matching the frontend useAgentSession.ts schema.
type Block struct {
	Type     string `json:"type"`
	Content  string `json:"content,omitempty"`
	Tool     string `json:"tool,omitempty"`
	Title    string `json:"title,omitempty"`
	CallID   string `json:"callId,omitempty"`
	Input    string `json:"input,omitempty"`
	Result   string `json:"result,omitempty"`
	State    string `json:"state,omitempty"`
	Language string `json:"language,omitempty"`
	Src      string `json:"src,omitempty"`
	Alt      string `json:"alt,omitempty"`
	Name     string `json:"name,omitempty"`
	Path     string `json:"path,omitempty"`
	Size     int64  `json:"size,omitempty"`
	Message  string `json:"message,omitempty"`

	// Data preserves custom block payloads (e.g. architect:plan, architect:questions)
	// so they round-trip through save/load without losing state.
	Data json.RawMessage `json:"data,omitempty"`
}

// Turn represents one request/response exchange in a chat session.
type Turn struct {
	ID        string  `json:"id"`
	Request   []Block `json:"request"`
	Response  []Block `json:"response"`
	AgentID   string  `json:"agentId"`
	Status    string  `json:"status"`
	Timestamp int64   `json:"timestamp"`
	Turns     int     `json:"turns,omitempty"`
}

// Session is a complete chat session with all turns.
type Session struct {
	ID          string         `json:"id"`
	AgentID     string         `json:"agentId"`
	ProjectID   string         `json:"projectId,omitempty"`
	ProjectName string         `json:"projectName,omitempty"`
	Turns       []Turn         `json:"turns"`
	CreatedAt   string         `json:"createdAt"`
	UpdatedAt   string         `json:"updatedAt"`
	Metadata    map[string]any `json:"metadata,omitempty"`
}

// SessionMeta is lightweight metadata returned by List (no turns payload).
type SessionMeta struct {
	ID          string `json:"id"`
	AgentID     string `json:"agentId"`
	ProjectID   string `json:"projectId,omitempty"`
	ProjectName string `json:"projectName,omitempty"`
	TurnCount   int    `json:"turnCount"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
}

// Store persists chat sessions as JSON files on disk.
type Store struct {
	dir string
}

// NewStore creates a chat session store rooted at dataDir/chat-sessions.
func NewStore(dataDir string) *Store {
	dir := filepath.Join(dataDir, "chat-sessions")
	os.MkdirAll(dir, 0755)
	return &Store{dir: dir}
}

// Save writes a session to disk as {id}.json. Sets UpdatedAt automatically.
func (s *Store) Save(session *Session) error {
	session.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	if session.CreatedAt == "" {
		session.CreatedAt = session.UpdatedAt
	}
	data, err := json.MarshalIndent(session, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal session: %w", err)
	}
	path := filepath.Join(s.dir, session.ID+".json")
	return os.WriteFile(path, data, 0644)
}

// Load reads a session from disk by ID.
func (s *Store) Load(id string) (*Session, error) {
	path := filepath.Join(s.dir, id+".json")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read session: %w", err)
	}
	var session Session
	if err := json.Unmarshal(data, &session); err != nil {
		return nil, fmt.Errorf("unmarshal session: %w", err)
	}
	return &session, nil
}

// List returns metadata for all sessions, sorted by UpdatedAt descending.
func (s *Store) List() ([]SessionMeta, error) {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	var metas []SessionMeta
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
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
		metas = append(metas, SessionMeta{
			ID:          sess.ID,
			AgentID:     sess.AgentID,
			ProjectID:   sess.ProjectID,
			ProjectName: sess.ProjectName,
			TurnCount:   len(sess.Turns),
			CreatedAt:   sess.CreatedAt,
			UpdatedAt:   sess.UpdatedAt,
		})
	}

	// Sort by UpdatedAt descending (most recent first)
	sort.Slice(metas, func(i, j int) bool {
		return metas[i].UpdatedAt > metas[j].UpdatedAt
	})

	return metas, nil
}

// Delete removes a session file from disk.
func (s *Store) Delete(id string) error {
	path := filepath.Join(s.dir, id+".json")
	return os.Remove(path)
}

// FindByAgent returns the most recent session for a given agent+project pair.
func (s *Store) FindByAgent(agentID, projectID string) (*Session, error) {
	metas, err := s.List()
	if err != nil {
		return nil, err
	}
	for _, m := range metas {
		if m.AgentID == agentID && m.ProjectID == projectID {
			return s.Load(m.ID)
		}
	}
	return nil, nil // no session found
}
