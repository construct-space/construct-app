package tool

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
)

// SkillEntry is one skill brain can load on demand. Either Path is set
// (read from disk at call time) or Body is set (built-in / embedded).
type SkillEntry struct {
	ID          string
	Name        string
	Description string
	Path        string // absolute path, or "" when Body is inline
	Body        string // populated for embedded skills (no on-disk file)
}

// SkillRegistry is the lookup table for load_skill. Populated at brain
// boot — once with space-discovered skills, once with each agent's
// bundled skills.
type SkillRegistry struct {
	mu sync.RWMutex
	m  map[string]SkillEntry
}

func NewSkillRegistry() *SkillRegistry { return &SkillRegistry{m: map[string]SkillEntry{}} }

func (r *SkillRegistry) Add(e SkillEntry) {
	r.mu.Lock()
	r.m[e.ID] = e
	r.mu.Unlock()
}

// ListAll returns every registered skill, used by the list_skills meta-
// tool. Order is undefined — callers sort if they need stability.
func (r *SkillRegistry) ListAll() []SkillEntry {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]SkillEntry, 0, len(r.m))
	for _, s := range r.m {
		out = append(out, s)
	}
	return out
}

func (r *SkillRegistry) Get(id string) (SkillEntry, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	// Exact match first.
	if s, ok := r.m[id]; ok {
		return s, true
	}
	// "agent:skill_id" form — strip the agent qualifier.
	if idx := strings.Index(id, ":"); idx >= 0 {
		if s, ok := r.m[id[idx+1:]]; ok {
			return s, true
		}
	}
	return SkillEntry{}, false
}

// LoadSkill exposes the registry as a tool the model can call.
// Returns the skill body so the model can read its instructions.
type LoadSkill struct {
	Reg *SkillRegistry
}

func (LoadSkill) Name() string { return "load_skill" }

func (LoadSkill) Description() string {
	return "Load a skill's full instructions into the conversation. Skills are listed in the system prompt by name + description; call this when you need the body. The skill_id is the bare id (e.g. 'contracts', 'frontend') or the agent-qualified form ('builder:contracts')."
}

func (LoadSkill) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"skill_id": map[string]any{
				"type":        "string",
				"description": "Skill identifier — bare id or 'agent:id' form.",
			},
		},
		"required": []string{"skill_id"},
	}
}

func (l LoadSkill) Execute(_ context.Context, raw json.RawMessage) (string, error) {
	if l.Reg == nil {
		return "", fmt.Errorf("skill registry not configured")
	}
	var in struct {
		SkillID string `json:"skill_id"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fmt.Errorf("invalid input: %w", err)
	}
	if in.SkillID == "" {
		return "", fmt.Errorf("skill_id is required")
	}
	s, ok := l.Reg.Get(in.SkillID)
	if !ok {
		return "", fmt.Errorf("unknown skill: %s (call list_skills to see what's available)", in.SkillID)
	}
	if s.Body != "" {
		return s.Body, nil
	}
	if s.Path == "" {
		return "", fmt.Errorf("skill %s has neither body nor path", in.SkillID)
	}
	b, err := os.ReadFile(s.Path)
	if err != nil {
		return "", fmt.Errorf("read skill %s: %w", in.SkillID, err)
	}
	return string(b), nil
}
