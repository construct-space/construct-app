// Package agents loads built-in agent definitions (Builder, General,
// Ask, Project, Space, Verifier, Coordinator, Space Developer). Each
// agent ships a system prompt + optional bundled skills under
// builtin/<id>/. Files are embedded into the binary at build time so
// brain ships them with zero on-disk setup.
//
// Skills bundled under an agent's directory are returned alongside that
// agent; the prompt handler merges them with the space-discovered skills
// when assembling tier-1 disclosure. That gives Builder-flavoured
// sessions access to builder:contracts / builder:verify / etc. without
// touching the space skill layer.
package agents

import (
	"bufio"
	"embed"
	"fmt"
	"os"
	"path"
	"strings"

	"github.com/construct-space/brain/skill"
)

//go:embed builtin/*/prompt.md builtin/*/skills/*.md
var builtinFS embed.FS

// Agent is one shippable system prompt + its bundled skills.
type Agent struct {
	ID           string        `json:"id"`
	Name         string        `json:"name"`
	Description  string        `json:"description,omitempty"`
	Category     string        `json:"category,omitempty"`
	MaxTurns     int           `json:"max_turns,omitempty"`
	SystemPrompt string        `json:"-"` // not exposed over wire — large
	Skills       []skill.Skill `json:"-"`
	// SkillBodies maps skill.ID → full markdown body for skills bundled
	// via embed.FS. Tier-1 disclosure puts name+description in the
	// system prompt; load_skill reads from here when the model asks.
	SkillBodies map[string]string `json:"-"`
}

// Public is the wire-friendly view of an Agent (no prompt body, no
// skill bodies — those load on demand via load_skill or read).
type Public struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Category    string `json:"category,omitempty"`
	MaxTurns    int    `json:"max_turns,omitempty"`
	SkillCount  int    `json:"skill_count"`
}

func (a *Agent) Public() Public {
	return Public{
		ID:          a.ID,
		Name:        a.Name,
		Description: a.Description,
		Category:    a.Category,
		MaxTurns:    a.MaxTurns,
		SkillCount:  len(a.Skills),
	}
}

// Registry holds every loaded agent, keyed by id.
type Registry struct {
	agents map[string]*Agent
	order  []string // preserves listing order
}

func (r *Registry) Get(id string) (*Agent, bool) {
	if r == nil {
		return nil, false
	}
	a, ok := r.agents[id]
	return a, ok
}

func (r *Registry) List() []*Agent {
	if r == nil {
		return nil
	}
	out := make([]*Agent, 0, len(r.order))
	for _, id := range r.order {
		out = append(out, r.agents[id])
	}
	return out
}

// LoadBuiltin reads every agent under builtin/<id>/prompt.md + bundled
// skills under builtin/<id>/skills/. Parse errors on a single agent are
// logged and skipped; the rest still load.
func LoadBuiltin() (*Registry, error) {
	r := &Registry{agents: map[string]*Agent{}}

	entries, err := builtinFS.ReadDir("builtin")
	if err != nil {
		return nil, fmt.Errorf("read builtin: %w", err)
	}

	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		id := e.Name()
		a, err := loadAgent(id)
		if err != nil {
			fmt.Fprintf(os.Stderr, "[agents] %s: %v\n", id, err)
			continue
		}
		r.agents[id] = a
		r.order = append(r.order, id)
	}
	return r, nil
}

func loadAgent(id string) (*Agent, error) {
	promptPath := path.Join("builtin", id, "prompt.md")
	body, err := builtinFS.ReadFile(promptPath)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", promptPath, err)
	}

	a := &Agent{ID: id, Name: titleCase(id)}
	parseFrontmatter(string(body), a)

	// Skills bundled with the agent.
	a.SkillBodies = map[string]string{}
	skillsDir := path.Join("builtin", id, "skills")
	if entries, err := builtinFS.ReadDir(skillsDir); err == nil {
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".md") {
				continue
			}
			sb, err := builtinFS.ReadFile(path.Join(skillsDir, e.Name()))
			if err != nil {
				continue
			}
			s := parseSkillFromBytes(e.Name(), sb)
			s.Source = "builtin:" + id
			a.Skills = append(a.Skills, s)
			a.SkillBodies[s.ID] = string(sb)
		}
	}
	return a, nil
}

// FromMarkdown builds an Agent from a raw config.md string — e.g. an installed
// Space's agent/config.md fetched over the host bridge. Frontmatter is parsed
// (name, maxIterations, …); the body becomes the SystemPrompt. Skills are not
// loaded here. Falls back to the given id/name when frontmatter omits them.
func FromMarkdown(id, md string) *Agent {
	a := &Agent{ID: id, Name: titleCase(id)}
	parseFrontmatter(md, a)
	if a.ID == "" {
		a.ID = id
	}
	return a
}

// parseFrontmatter reads YAML-ish frontmatter at the head of body and
// promotes the keys brain cares about. The post-frontmatter body becomes
// the SystemPrompt.
func parseFrontmatter(body string, a *Agent) {
	scanner := bufio.NewScanner(strings.NewReader(body))
	scanner.Buffer(make([]byte, 1<<20), 1<<24)
	if !scanner.Scan() {
		a.SystemPrompt = strings.TrimSpace(body)
		return
	}
	if strings.TrimSpace(scanner.Text()) != "---" {
		// No frontmatter at all.
		a.SystemPrompt = strings.TrimSpace(body)
		return
	}

	var promptBuf strings.Builder
	inFrontmatter := true
	for scanner.Scan() {
		line := scanner.Text()
		if inFrontmatter {
			if strings.TrimSpace(line) == "---" {
				inFrontmatter = false
				continue
			}
			k, v := splitKV(line)
			switch k {
			case "id":
				if v != "" {
					a.ID = v
				}
			case "name":
				if v != "" {
					a.Name = v
				}
			case "description":
				a.Description = v
			case "category":
				a.Category = v
			case "maxIterations", "max_turns":
				a.MaxTurns = atoiSafe(v)
			}
			continue
		}
		promptBuf.WriteString(line)
		promptBuf.WriteByte('\n')
	}
	a.SystemPrompt = strings.TrimSpace(promptBuf.String())
}

// parseSkillFromBytes is a small mirror of skill.ParseFile that works
// off bytes from embed.FS (skill.ParseFile takes an os filesystem path).
func parseSkillFromBytes(filename string, body []byte) skill.Skill {
	s := skill.Skill{
		ID:   strings.TrimSuffix(filename, ".md"),
		Name: strings.TrimSuffix(filename, ".md"),
		Path: "builtin://" + filename,
	}
	scanner := bufio.NewScanner(strings.NewReader(string(body)))
	scanner.Buffer(make([]byte, 1<<20), 1<<24)
	if !scanner.Scan() {
		return s
	}
	if strings.TrimSpace(scanner.Text()) != "---" {
		return s
	}
	for scanner.Scan() {
		line := scanner.Text()
		if strings.TrimSpace(line) == "---" {
			return s
		}
		k, v := splitKV(line)
		switch k {
		case "id":
			s.ID = v
		case "name":
			s.Name = v
		case "description":
			s.Description = v
		case "trigger":
			s.Trigger = v
		case "category":
			s.Category = v
		}
	}
	return s
}

func splitKV(line string) (string, string) {
	idx := strings.IndexByte(line, ':')
	if idx <= 0 {
		return "", ""
	}
	key := strings.TrimSpace(line[:idx])
	val := strings.TrimSpace(line[idx+1:])
	val = strings.Trim(val, `"'`)
	return key, val
}

func atoiSafe(s string) int {
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			return 0
		}
		n = n*10 + int(r-'0')
	}
	return n
}

func titleCase(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}
