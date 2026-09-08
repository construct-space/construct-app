// Agent task tracker — task_create / task_update / task_list. Used by
// coordinator-style agents to break complex work into discrete steps the
// user can watch progress on. Operator scoped tasks to a session; brain
// does the same but the session id is supplied externally (set by the
// prompt handler before each turn) rather than read from a global.
package tool

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"sync"
)

// WorkflowTask matches operator's wire shape so existing frontends that
// render task lists continue to work unchanged.
type WorkflowTask struct {
	ID           int    `json:"id"`
	Title        string `json:"title"`
	Description  string `json:"description,omitempty"`
	Status       string `json:"status"` // pending|in_progress|completed|error|skipped
	Dependencies []int  `json:"dependencies,omitempty"`
	TeamID       string `json:"team_id,omitempty"`
}

// TaskStore is a per-session in-memory task map. Brain doesn't persist
// these to disk yet (operator did, scoped per session JSONL) — sessions
// outlive a brain restart but tasks don't. If a user complains about
// losing the plan on restart, persist to state.Store via a "tasks"
// bucket keyed by session_id.
type TaskStore struct {
	mu       sync.Mutex
	bySess   map[string]*sessionTasks
	currentS string
}

type sessionTasks struct {
	nextID int
	tasks  []*WorkflowTask
}

func NewTaskStore() *TaskStore {
	return &TaskStore{bySess: map[string]*sessionTasks{}}
}

// SetSession is called by the prompt handler before each turn so
// subsequent Create/Update/List calls land in the right bucket.
func (s *TaskStore) SetSession(id string) {
	s.mu.Lock()
	s.currentS = id
	if _, ok := s.bySess[id]; !ok {
		s.bySess[id] = &sessionTasks{nextID: 1}
	}
	s.mu.Unlock()
}

func (s *TaskStore) bucket() *sessionTasks {
	if s.currentS == "" {
		// Fall back to a process-wide "default" bucket — no session bound.
		if _, ok := s.bySess[""]; !ok {
			s.bySess[""] = &sessionTasks{nextID: 1}
		}
	}
	return s.bySess[s.currentS]
}

func (s *TaskStore) Create(title, desc, status, teamID string, deps []int) (*WorkflowTask, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if title == "" {
		return nil, fmt.Errorf("title is required")
	}
	if status == "" {
		status = "pending"
	}
	b := s.bucket()
	t := &WorkflowTask{
		ID:           b.nextID,
		Title:        title,
		Description:  desc,
		Status:       status,
		Dependencies: deps,
		TeamID:       teamID,
	}
	b.nextID++
	b.tasks = append(b.tasks, t)
	return t, nil
}

func (s *TaskStore) Update(id int, status, desc string) (*WorkflowTask, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	b := s.bucket()
	for _, t := range b.tasks {
		if t.ID == id {
			if status != "" {
				t.Status = status
			}
			if desc != "" {
				t.Description = desc
			}
			return t, nil
		}
	}
	return nil, fmt.Errorf("task %d not found", id)
}

func (s *TaskStore) List(teamID string) []*WorkflowTask {
	s.mu.Lock()
	defer s.mu.Unlock()
	b := s.bucket()
	out := make([]*WorkflowTask, 0, len(b.tasks))
	for _, t := range b.tasks {
		if teamID != "" && t.TeamID != teamID {
			continue
		}
		out = append(out, t)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// ─── tool surfaces ──────────────────────────────────────────────────

type TaskCreateTool struct{ Store *TaskStore }

func (TaskCreateTool) Name() string { return "task_create" }
func (TaskCreateTool) Description() string {
	return "Create a structured task to track work progress. Use this to break complex work into discrete steps the user can watch progress on."
}
func (TaskCreateTool) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"title":        map[string]any{"type": "string"},
			"description":  map[string]any{"type": "string"},
			"status":       map[string]any{"type": "string", "enum": []string{"pending", "in_progress", "completed", "error", "skipped"}},
			"dependencies": map[string]any{"type": "array", "items": map[string]any{"type": "integer"}},
			"team_id":      map[string]any{"type": "string"},
		},
		"required": []string{"title"},
	}
}
func (t TaskCreateTool) Execute(_ context.Context, raw json.RawMessage) (string, error) {
	if t.Store == nil {
		return "", fmt.Errorf("task store not configured")
	}
	var in struct {
		Title        string `json:"title"`
		Description  string `json:"description"`
		Status       string `json:"status"`
		Dependencies []int  `json:"dependencies"`
		TeamID       string `json:"team_id"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fmt.Errorf("invalid input: %w", err)
	}
	task, err := t.Store.Create(in.Title, in.Description, in.Status, in.TeamID, in.Dependencies)
	if err != nil {
		return "", err
	}
	out, _ := json.Marshal(task)
	return string(out), nil
}

type TaskUpdateTool struct{ Store *TaskStore }

func (TaskUpdateTool) Name() string { return "task_update" }
func (TaskUpdateTool) Description() string {
	return "Update a task's status. Mark as in_progress when starting, completed when done, error if blocked."
}
func (TaskUpdateTool) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"id":          map[string]any{"type": "integer"},
			"status":      map[string]any{"type": "string", "enum": []string{"pending", "in_progress", "completed", "error", "skipped"}},
			"description": map[string]any{"type": "string"},
		},
		"required": []string{"id", "status"},
	}
}
func (t TaskUpdateTool) Execute(_ context.Context, raw json.RawMessage) (string, error) {
	if t.Store == nil {
		return "", fmt.Errorf("task store not configured")
	}
	var in struct {
		ID          int    `json:"id"`
		Status      string `json:"status"`
		Description string `json:"description"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fmt.Errorf("invalid input: %w", err)
	}
	task, err := t.Store.Update(in.ID, in.Status, in.Description)
	if err != nil {
		return "", err
	}
	out, _ := json.Marshal(task)
	return string(out), nil
}

type TaskListTool struct{ Store *TaskStore }

func (TaskListTool) Name() string { return "task_list" }
func (TaskListTool) Description() string {
	return "List all tasks for the current session and their status. Shows the full plan with completion progress."
}
func (TaskListTool) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"team_id": map[string]any{"type": "string"},
		},
	}
}
func (t TaskListTool) Execute(_ context.Context, raw json.RawMessage) (string, error) {
	if t.Store == nil {
		return "", fmt.Errorf("task store not configured")
	}
	var in struct {
		TeamID string `json:"team_id"`
	}
	_ = json.Unmarshal(raw, &in)
	tasks := t.Store.List(in.TeamID)
	if len(tasks) == 0 {
		return "No tasks created yet.", nil
	}
	out, _ := json.MarshalIndent(tasks, "", "  ")
	return string(out), nil
}
