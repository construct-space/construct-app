// skill_manage — lets the agent write its own skills (procedural memory).
// After figuring out a non-trivial workflow, the model saves it as a SKILL.md
// under <SkillsDir>/<id>/ so future sessions can load it via list_skills /
// load_skill. This is the skill half of the "grows with you" loop.
//
// Actions:
//   create — new skill from name/description/body (errors if it exists)
//   patch  — find/replace a substring in the body (token-cheap, preferred)
//   edit   — replace the whole body
//   delete — archive the skill (move to .archive/, never hard-delete)
//
// Skills written here carry `source: agent` in frontmatter so the curator
// (and the UI) can tell agent-created skills from bundled/space ones.
package tool

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// SkillStore is the on-disk home for agent-created skills: <SkillsDir>.
// DirFn (when set) resolves the dir live so skills follow profile switches.
type SkillStore struct {
	mu    sync.Mutex
	Dir   string
	DirFn func() string
}

func NewSkillStore(dir string) *SkillStore { return &SkillStore{Dir: dir} }

// NewSkillStoreFn builds a store whose dir is resolved live (per profile).
func NewSkillStoreFn(fn func() string) *SkillStore { return &SkillStore{DirFn: fn} }

func (s *SkillStore) dir() string {
	if s.DirFn != nil {
		if d := s.DirFn(); d != "" {
			return d
		}
	}
	return s.Dir
}

var slugRe = regexp.MustCompile(`[^a-z0-9]+`)

func slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = slugRe.ReplaceAllString(s, "-")
	return strings.Trim(s, "-")
}

func (s *SkillStore) skillPath(id string) string {
	return filepath.Join(s.dir(), id, "SKILL.md")
}

// SkillManage is the model-facing tool.
type SkillManage struct {
	Store *SkillStore
}

func (SkillManage) Name() string { return "skill_manage" }

func (SkillManage) Description() string {
	return "Save or refine a reusable skill (a SKILL.md procedure) so future sessions can reuse it. action=create (new skill from name/description/body), patch (find+replace a snippet in the body — preferred, token-cheap), edit (replace the whole body), delete (archive it). Create a skill after you work out a non-trivial multi-step workflow, recover from a tricky error, or the user corrects your approach."
}

func (SkillManage) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"action": map[string]any{
				"type": "string",
				"enum": []string{"create", "patch", "edit", "delete"},
			},
			"id": map[string]any{
				"type":        "string",
				"description": "Skill slug (kebab-case). For create, derived from name if omitted.",
			},
			"name":        map[string]any{"type": "string", "description": "Human-readable name (create)."},
			"description": map[string]any{"type": "string", "description": "One-line description shown in list_skills (create)."},
			"triggers":    map[string]any{"type": "string", "description": "Optional comma/pipe-separated keywords that auto-load this skill."},
			"body":        map[string]any{"type": "string", "description": "Markdown body (create/edit). Use sections: When to use, Procedure, Pitfalls, Verification."},
			"find":        map[string]any{"type": "string", "description": "patch: existing substring to replace."},
			"replace":     map[string]any{"type": "string", "description": "patch: replacement text."},
		},
		"required": []string{"action"},
	}
}

func (sm SkillManage) Execute(_ context.Context, raw json.RawMessage) (string, error) {
	if sm.Store == nil || sm.Store.dir() == "" {
		return "", fmt.Errorf("skill store unavailable")
	}
	var in struct {
		Action      string `json:"action"`
		ID          string `json:"id"`
		Name        string `json:"name"`
		Description string `json:"description"`
		Triggers    string `json:"triggers"`
		Body        string `json:"body"`
		Find        string `json:"find"`
		Replace     string `json:"replace"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fmt.Errorf("invalid input: %w", err)
	}
	sm.Store.mu.Lock()
	defer sm.Store.mu.Unlock()

	id := slugify(in.ID)
	if id == "" {
		id = slugify(in.Name)
	}

	switch strings.ToLower(strings.TrimSpace(in.Action)) {
	case "create":
		if id == "" {
			return "", fmt.Errorf("id or name is required for create")
		}
		if strings.TrimSpace(in.Body) == "" {
			return "", fmt.Errorf("body is required for create")
		}
		path := sm.Store.skillPath(id)
		if _, err := os.Stat(path); err == nil {
			return "", fmt.Errorf("skill %q already exists — use patch/edit to change it", id)
		}
		fm := buildFrontmatter(id, firstNonEmpty(in.Name, id), in.Description, in.Triggers)
		content := fm + "\n" + strings.TrimSpace(in.Body) + "\n"
		if err := writeSkill(path, content); err != nil {
			return "", err
		}
		return jsonResult(map[string]any{"ok": true, "action": "create", "id": id, "path": path}), nil

	case "patch":
		path := sm.Store.skillPath(id)
		cur, err := os.ReadFile(path)
		if err != nil {
			return "", fmt.Errorf("skill %q not found", id)
		}
		if in.Find == "" || !strings.Contains(string(cur), in.Find) {
			return "", fmt.Errorf("find text not present in skill %q", id)
		}
		updated := strings.Replace(string(cur), in.Find, in.Replace, 1)
		if err := writeSkill(path, updated); err != nil {
			return "", err
		}
		return jsonResult(map[string]any{"ok": true, "action": "patch", "id": id}), nil

	case "edit":
		path := sm.Store.skillPath(id)
		cur, err := os.ReadFile(path)
		if err != nil {
			return "", fmt.Errorf("skill %q not found", id)
		}
		if strings.TrimSpace(in.Body) == "" {
			return "", fmt.Errorf("body is required for edit")
		}
		// Preserve the existing frontmatter; swap only the body.
		fm := extractFrontmatter(string(cur))
		content := fm + "\n" + strings.TrimSpace(in.Body) + "\n"
		if err := writeSkill(path, content); err != nil {
			return "", err
		}
		return jsonResult(map[string]any{"ok": true, "action": "edit", "id": id}), nil

	case "delete":
		src := filepath.Join(sm.Store.dir(), id)
		if _, err := os.Stat(src); err != nil {
			return "", fmt.Errorf("skill %q not found", id)
		}
		// Archive, never hard-delete — recoverable.
		archive := filepath.Join(sm.Store.dir(), ".archive", fmt.Sprintf("%s-%d", id, time.Now().Unix()))
		if err := os.MkdirAll(filepath.Dir(archive), 0o755); err != nil {
			return "", err
		}
		if err := os.Rename(src, archive); err != nil {
			return "", fmt.Errorf("archive skill %q: %w", id, err)
		}
		return jsonResult(map[string]any{"ok": true, "action": "delete", "id": id, "archived_to": archive}), nil

	default:
		return "", fmt.Errorf("unknown action %q (create|patch|edit|delete)", in.Action)
	}
}

func writeSkill(path, content string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(content), 0o644)
}

func buildFrontmatter(id, name, desc, triggers string) string {
	var b strings.Builder
	b.WriteString("---\n")
	b.WriteString("id: " + id + "\n")
	b.WriteString("name: " + name + "\n")
	if desc != "" {
		b.WriteString("description: " + desc + "\n")
	}
	if t := strings.TrimSpace(triggers); t != "" {
		b.WriteString("triggers: " + t + "\n")
	}
	b.WriteString("source: agent\n") // marks agent-created for the curator + UI
	b.WriteString("---\n")
	return b.String()
}

// extractFrontmatter returns the leading --- ... --- block (with trailing
// newline) or a minimal one if the file had none.
func extractFrontmatter(content string) string {
	if !strings.HasPrefix(content, "---") {
		return "---\nsource: agent\n---\n"
	}
	rest := content[len("---"):]
	end := strings.Index(rest, "\n---")
	if end < 0 {
		return "---\nsource: agent\n---\n"
	}
	return content[:len("---")+end+len("\n---")+1]
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
