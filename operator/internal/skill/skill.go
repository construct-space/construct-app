// Package skill implements the skill system.
// Skills are reusable prompt+tool bundles that agents can invoke.
// Operator skills are dynamic: they can be loaded from spaces, MCP, or inline.
//
// Think of skills like Claude Code's /commit, /review-pr — they expand into
// a full prompt with context and specific tool access.
package skill

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"gopkg.in/yaml.v3"
)

// Skill is an invocable capability.
type Skill struct {
	ID          string   `json:"id" yaml:"id"`
	Name        string   `json:"name" yaml:"name"`
	Description string   `json:"description" yaml:"description"`
	Trigger     string   `json:"trigger,omitempty" yaml:"trigger"`   // Regex or keyword trigger
	Prompt      string   `json:"prompt" yaml:"-"`                    // The prompt template (markdown body)
	Tools       []string `json:"tools,omitempty" yaml:"tools"`       // Additional tools this skill needs
	Source      string   `json:"source" yaml:"-"`                    // "builtin", "space:<id>", "user"
	Category    string   `json:"category,omitempty" yaml:"category"` // For grouping
}

type State struct {
	Loaded    bool   `json:"loaded"`
	Enabled   bool   `json:"enabled"`
	LoadedAt  string `json:"loadedAt,omitempty"`
	UpdatedAt string `json:"updatedAt"`
}

type Metrics struct {
	LastUsed string `json:"lastUsed,omitempty"`
}

// Registry holds all available skills.
type Registry struct {
	mu      sync.RWMutex
	skills  map[string]*Skill
	states  map[string]State
	metrics map[string]Metrics
}

func NewRegistry() *Registry {
	return &Registry{
		skills:  make(map[string]*Skill),
		states:  make(map[string]State),
		metrics: make(map[string]Metrics),
	}
}

func (r *Registry) Register(s *Skill) {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.skills[s.ID] = s
	if s.Name == "" {
		s.Name = s.ID
	}
	if s.Category == "" {
		s.Category = "custom"
	}
	if _, ok := r.states[s.ID]; !ok {
		now := nowUTC()
		r.states[s.ID] = State{
			Loaded:    true,
			Enabled:   true,
			LoadedAt:  now,
			UpdatedAt: now,
		}
	}
}

func (r *Registry) Get(id string) (*Skill, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	s, ok := r.skills[id]
	return s, ok
}

func (r *Registry) All() []*Skill {
	r.mu.RLock()
	defer r.mu.RUnlock()

	result := make([]*Skill, 0, len(r.skills))
	for _, id := range r.sortedIDsLocked() {
		result = append(result, r.skills[id])
	}
	return result
}

func (r *Registry) State(id string) (State, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	state, ok := r.states[id]
	return state, ok
}

func (r *Registry) SetState(id string, state State) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.setStateLocked(id, state)
}

func (r *Registry) Load(id string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	state, ok := r.states[id]
	if !ok {
		return false
	}
	state.Loaded = true
	if state.LoadedAt == "" {
		state.LoadedAt = nowUTC()
	}
	state.UpdatedAt = nowUTC()
	r.states[id] = state
	return true
}

func (r *Registry) Unload(id string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	state, ok := r.states[id]
	if !ok {
		return false
	}
	state.Loaded = false
	state.Enabled = false
	state.UpdatedAt = nowUTC()
	r.states[id] = state
	return true
}

func (r *Registry) Enable(id string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	state, ok := r.states[id]
	if !ok {
		return false
	}
	state.Loaded = true
	state.Enabled = true
	if state.LoadedAt == "" {
		state.LoadedAt = nowUTC()
	}
	state.UpdatedAt = nowUTC()
	r.states[id] = state
	return true
}

func (r *Registry) Disable(id string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	state, ok := r.states[id]
	if !ok {
		return false
	}
	state.Enabled = false
	state.UpdatedAt = nowUTC()
	r.states[id] = state
	return true
}

func (r *Registry) Metrics() map[string]Metrics {
	r.mu.RLock()
	defer r.mu.RUnlock()

	result := make(map[string]Metrics, len(r.metrics))
	for id, metric := range r.metrics {
		result[id] = metric
	}
	return result
}

// Match finds skills whose trigger matches the given input.
func (r *Registry) Match(input string) []*Skill {
	r.mu.Lock()
	defer r.mu.Unlock()

	var matches []*Skill
	now := nowUTC()
	for _, id := range r.sortedIDsLocked() {
		s := r.skills[id]
		state := r.states[id]
		if !state.Loaded || !state.Enabled {
			continue
		}
		if s.Trigger != "" && matchesTrigger(s.Trigger, input) {
			matches = append(matches, s)
			metric := r.metrics[id]
			metric.LastUsed = now
			r.metrics[id] = metric
		}
	}
	return matches
}

// Expand renders a skill's prompt template with the given context variables.
// Supports {{variable}} expansion.
func (s *Skill) Expand(ctx context.Context, vars map[string]any) string {
	result := s.Prompt
	for k, v := range vars {
		placeholder := "{{" + k + "}}"
		result = strings.ReplaceAll(result, placeholder, fmt.Sprintf("%v", v))
	}

	// Also support nested keys like {{project.name}}
	for k, v := range vars {
		if m, ok := v.(map[string]any); ok {
			for subK, subV := range m {
				placeholder := "{{" + k + "." + subK + "}}"
				result = strings.ReplaceAll(result, placeholder, fmt.Sprintf("%v", subV))
			}
		}
	}

	return result
}

func matchesTrigger(trigger, input string) bool {
	lower := strings.ToLower(input)

	// If trigger contains commas, treat as keyword list
	if strings.Contains(trigger, ",") {
		keywords := strings.Split(strings.ToLower(trigger), ",")
		for _, kw := range keywords {
			kw = strings.TrimSpace(kw)
			if kw != "" && strings.Contains(lower, kw) {
				return true
			}
		}
		return false
	}

	// Try as regex
	if re, err := regexp.Compile("(?i)" + trigger); err == nil {
		return re.MatchString(lower)
	}

	// Single keyword
	return strings.Contains(lower, strings.ToLower(trigger))
}

// --- Loading ---

// LoadFromDir loads skills from a directory of .md files with YAML frontmatter.
func LoadFromDir(dir, source string) ([]*Skill, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	var skills []*Skill
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".md" {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		skill, err := parseSkillMarkdown(string(data), source)
		if err != nil {
			fmt.Fprintf(os.Stderr, "[skill] warning: %s: %v\n", e.Name(), err)
			continue
		}
		if skill.ID == "" {
			skill.ID = strings.TrimSuffix(e.Name(), ".md")
		}
		skills = append(skills, skill)
	}
	return skills, nil
}

// LoadAll loads skills from multiple directories (spaces + user).
func LoadAll(spacesDir, userSkillsDir string) []*Skill {
	var all []*Skill

	// Load from spaces
	if entries, err := os.ReadDir(spacesDir); err == nil {
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			// Load skills from agent/skills/
			for _, subDir := range []string{"agent/skills"} {
				skillDir := filepath.Join(spacesDir, e.Name(), subDir)
				if skills, err := LoadFromDir(skillDir, "space:"+e.Name()); err == nil {
					all = append(all, skills...)
				}
			}
		}
	}

	// Load from user skills directory
	if skills, err := LoadFromDir(userSkillsDir, "user"); err == nil {
		all = append(all, skills...)
	}

	return all
}

func parseSkillMarkdown(content, source string) (*Skill, error) {
	frontmatter, body, err := splitFrontmatter(content)
	if err != nil || frontmatter == "" {
		return nil, fmt.Errorf("no frontmatter")
	}

	var skill Skill
	if err := yaml.Unmarshal([]byte(frontmatter), &skill); err != nil {
		return nil, err
	}

	skill.Prompt = strings.TrimSpace(body)
	skill.Source = source
	return &skill, nil
}

func splitFrontmatter(content string) (string, string, error) {
	trimmed := strings.TrimSpace(content)
	if !strings.HasPrefix(trimmed, "---") {
		return "", trimmed, nil
	}
	trimmed = strings.TrimPrefix(trimmed, "---")
	before, after, found := strings.Cut(trimmed, "\n---")
	if !found {
		return "", "", fmt.Errorf("unclosed frontmatter")
	}
	return strings.TrimSpace(before), strings.TrimSpace(after), nil
}

func (r *Registry) setStateLocked(id string, state State) bool {
	if _, ok := r.skills[id]; !ok {
		return false
	}
	if state.Loaded && state.LoadedAt == "" {
		state.LoadedAt = nowUTC()
	}
	if state.UpdatedAt == "" {
		state.UpdatedAt = nowUTC()
	}
	r.states[id] = state
	return true
}

func (r *Registry) sortedIDsLocked() []string {
	ids := make([]string, 0, len(r.skills))
	for id := range r.skills {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

func nowUTC() string {
	return time.Now().UTC().Format(time.RFC3339)
}

// --- Built-in Skills ---

var builtinSkillIDs = []string{"commit", "review", "explain", "test"}

func BuiltinIDs() []string {
	ids := make([]string, len(builtinSkillIDs))
	copy(ids, builtinSkillIDs)
	return ids
}

// RegisterBuiltins adds built-in skills to the registry.
func RegisterBuiltins(reg *Registry) {
	reg.Register(&Skill{
		ID:          "commit",
		Name:        "Commit",
		Description: "Create a git commit with a well-crafted message",
		Trigger:     "commit,/commit",
		Category:    "git",
		Prompt: `Analyze the staged changes (git diff --cached) and create a commit.

Steps:
1. Run git status and git diff --cached to see what's staged
2. Write a concise commit message following conventional commits format
3. Run git commit -m "the message"

If nothing is staged, stage all modified files first (but warn about untracked files).`,
		Source: "builtin",
	})

	reg.Register(&Skill{
		ID:          "review",
		Name:        "Code Review",
		Description: "Review code changes for bugs, style issues, and improvements",
		Trigger:     "review,/review",
		Category:    "code",
		Prompt: `Review the current changes (git diff) or the specified file(s).

Look for:
- Bugs and logic errors
- Security vulnerabilities
- Performance issues
- Code style and readability
- Missing error handling
- Test coverage gaps

Format your review as actionable comments with file paths and line numbers.`,
		Source: "builtin",
	})

	reg.Register(&Skill{
		ID:          "explain",
		Name:        "Explain Code",
		Description: "Explain how code works at the right level of detail",
		Trigger:     "explain,/explain",
		Category:    "code",
		Prompt: `Read and explain the specified code. Adapt your explanation depth to the complexity:

- For simple code: brief one-liner explanation
- For complex code: break down the architecture, data flow, and key decisions
- Always mention non-obvious things: edge cases handled, performance tradeoffs, why something was done a certain way`,
		Source: "builtin",
	})

	reg.Register(&Skill{
		ID:          "test",
		Name:        "Write Tests",
		Description: "Generate tests for existing code",
		Trigger:     "test,/test,write tests",
		Category:    "code",
		Prompt: `Write tests for the specified code or recent changes.

Guidelines:
- Match the existing test framework and style
- Cover happy paths, edge cases, and error cases
- Use descriptive test names
- Keep tests focused and independent
- Mock external dependencies, not internal code`,
		Source: "builtin",
	})
}
