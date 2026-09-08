// Package session persists conversations as JSONL on disk. One file per
// session at <SessionsDir>/<id>.jsonl. Each line is one message in the
// provider's block-shape. Replay-friendly: brain reads the file, appends
// the new user prompt, runs the agent, then appends each new turn.
package session

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/construct-space/brain/provider"
)

// Entry is one JSONL line. We carry timestamps so the UI can render order
// without inventing them.
type Entry struct {
	Role    string           `json:"role"` // "user" | "assistant"
	Content []provider.Block `json:"content"`
	Time    time.Time        `json:"ts"`
}

// Store is the on-disk session repo. Goroutine-safe.
type Store struct {
	dir string
	mu  sync.Mutex
}

func NewStore(dir string) *Store { return &Store{dir: dir} }

// Rebind retargets the store at a different sessions directory. Called
// from profile.switch so brain reads/writes new conversations under the
// active profile after a profile change.
func (s *Store) Rebind(dir string) {
	s.mu.Lock()
	s.dir = dir
	s.mu.Unlock()
}

// NewID returns a fresh hex session id. 16 bytes = 32 hex chars.
func NewID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// validID rejects anything that could escape the sessions dir when
// joined into a path. Ids arrive verbatim off the wire (an
// unauthenticated loopback port) — without this, "../../x" reads,
// overwrites, or deletes arbitrary *.jsonl paths the user can write.
func validID(id string) bool {
	if id == "" || len(id) > 128 {
		return false
	}
	if strings.ContainsAny(id, "/\\") || strings.Contains(id, "..") {
		return false
	}
	return filepath.Base(id) == id
}

var errInvalidID = fmt.Errorf("invalid session id")

// path joins id into the CURRENT dir. Callers must hold s.mu (Save,
// Append, Delete already do); lock-free contexts use snapshotDir first.
func (s *Store) path(id string) string { return filepath.Join(s.dir, id+".jsonl") }

// snapshotDir returns the current dir under the lock, so lock-free
// readers don't race Rebind.
func (s *Store) snapshotDir() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.dir
}

// Load reads every entry for a session. Returns empty for a new session.
func (s *Store) Load(id string) ([]Entry, error) {
	if !validID(id) {
		return nil, errInvalidID
	}
	f, err := os.Open(filepath.Join(s.snapshotDir(), id+".jsonl"))
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	defer f.Close()
	var out []Entry
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 1<<20), 1<<24)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var e Entry
		if err := json.Unmarshal([]byte(line), &e); err != nil {
			fmt.Fprintf(os.Stderr, "[session] %s: %v\n", id, err)
			continue
		}
		out = append(out, e)
	}
	return out, scanner.Err()
}

// Delete removes a session file. Returns nil if the file is already
// absent — callers usually treat delete as idempotent.
func (s *Store) Delete(id string) error {
	if !validID(id) {
		return errInvalidID
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.Remove(s.path(id)); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// Save replaces the entire session file with the given entries. Atomic:
// writes to <id>.jsonl.tmp first, then renames over the target so a
// crash mid-write can't corrupt the live file.
func (s *Store) Save(id string, entries []Entry) error {
	if !validID(id) {
		return errInvalidID
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return err
	}
	tmp := s.path(id) + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	for _, e := range entries {
		body, mErr := json.Marshal(e)
		if mErr != nil {
			f.Close()
			os.Remove(tmp)
			return mErr
		}
		body = append(body, '\n')
		if _, wErr := f.Write(body); wErr != nil {
			f.Close()
			os.Remove(tmp)
			return wErr
		}
	}
	if cErr := f.Close(); cErr != nil {
		os.Remove(tmp)
		return cErr
	}
	return os.Rename(tmp, s.path(id))
}

// Append writes one entry. Creates the file if needed.
func (s *Store) Append(id string, e Entry) error {
	if !validID(id) {
		return errInvalidID
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(s.path(id), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	body, err := json.Marshal(e)
	if err != nil {
		return err
	}
	body = append(body, '\n')
	_, err = f.Write(body)
	return err
}

// List returns session ids on disk, newest first by mtime.
func (s *Store) List() ([]Info, error) {
	entries, err := os.ReadDir(s.snapshotDir())
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var out []Info
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".jsonl") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		id := strings.TrimSuffix(e.Name(), ".jsonl")
		out = append(out, Info{ID: id, UpdatedAt: info.ModTime(), Size: info.Size()})
	}
	// Newest first.
	for i := 0; i < len(out); i++ {
		for j := i + 1; j < len(out); j++ {
			if out[j].UpdatedAt.After(out[i].UpdatedAt) {
				out[i], out[j] = out[j], out[i]
			}
		}
	}
	return out, nil
}

// Info is a compact session record for listing.
type Info struct {
	ID        string    `json:"id"`
	UpdatedAt time.Time `json:"updated_at"`
	Size      int64     `json:"size"`
}

// AsMessages converts entries into provider.Message for replay into the agent.
func AsMessages(entries []Entry) []provider.Message {
	out := make([]provider.Message, 0, len(entries))
	for _, e := range entries {
		out = append(out, provider.Message{Role: e.Role, Content: e.Content})
	}
	return out
}
