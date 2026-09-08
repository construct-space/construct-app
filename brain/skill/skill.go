// Package skill loads Construct skill files. Each skill is a markdown
// file with YAML frontmatter (name, description, trigger). The model gets
// names + descriptions at tier 1 (system prompt); it pulls the full file
// via the `read` tool when relevant (tier 2).
package skill

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Skill is one loaded skill, ready to be cited in the system prompt.
type Skill struct {
	ID          string `json:"id"`                   // slug from frontmatter; falls back to file basename
	Name        string `json:"name"`                 // human-readable
	Description string `json:"description"`          // one-liner shown at tier 1
	Trigger     string `json:"trigger"`              // optional pipe-separated keywords
	Category    string `json:"category"`             // free-form grouping
	Scope       string `json:"scope,omitempty"`      // visibility filter — "builder", "spacekit", "any" (or empty=any)
	Path        string `json:"path"`                 // absolute path so the model can `read` it
	BodyOffset  int    `json:"bodyOffset,omitempty"` // byte index where body starts (after frontmatter)
	Body        string `json:"-"`                    // post-frontmatter markdown body; never sent over the
	// wire — fetched on demand via skills.content/skills.get
	Source string   `json:"source,omitempty"` // dir this skill was discovered from
	Origin string   `json:"origin,omitempty"` // frontmatter `source:` — "agent" for skill_manage-created, else author-set
	Raw    []string `json:"-"`                // unparsed keys we didn't promote — internal only
}

// VisibleIn reports whether this skill should appear in the tier-1 index
// for the given surface. Empty scope (or "any") = visible everywhere.
// Skills tagged "builder" only show in Builder/general agent surfaces;
// "spacekit" only in space-authoring surfaces. The filter is permissive
// by default so legacy skills without a scope tag keep working.
func (s Skill) VisibleIn(surface string) bool {
	if s.Scope == "" || s.Scope == "any" {
		return true
	}
	return s.Scope == surface
}

// LoadDir walks `dir` looking for .md files (one level deep, plus
// dir/<name>/SKILL.md for Anthropic-style skill directories). Returns
// every skill that parsed cleanly; logs parse errors to stderr.
func LoadDir(dir string) ([]Skill, error) {
	info, err := os.Stat(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("not a directory: %s", dir)
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	var out []Skill
	for _, e := range entries {
		full := filepath.Join(dir, e.Name())
		if e.IsDir() {
			// Anthropic-style: <skill>/SKILL.md
			candidate := filepath.Join(full, "SKILL.md")
			if _, err := os.Stat(candidate); err == nil {
				if s, err := ParseFile(candidate); err == nil {
					s.Source = dir
					out = append(out, s)
				} else {
					fmt.Fprintf(os.Stderr, "[skill] %s: %v\n", candidate, err)
				}
			}
			continue
		}
		name := e.Name()
		// Skip macOS resource-fork artifacts (Finder writes "._<file>"
		// alongside real files on FAT/NFS volumes).
		if strings.HasPrefix(name, "._") {
			continue
		}
		if !strings.HasSuffix(strings.ToLower(name), ".md") {
			continue
		}
		if s, err := ParseFile(full); err == nil {
			s.Source = dir
			out = append(out, s)
		} else {
			fmt.Fprintf(os.Stderr, "[skill] %s: %v\n", full, err)
		}
	}
	return out, nil
}

// LoadDirs is LoadDir over many roots; duplicate IDs keep the first seen.
func LoadDirs(dirs ...string) []Skill {
	seen := map[string]bool{}
	var all []Skill
	for _, d := range dirs {
		skills, err := LoadDir(d)
		if err != nil {
			fmt.Fprintf(os.Stderr, "[skill] LoadDir %s: %v\n", d, err)
			continue
		}
		for _, s := range skills {
			if seen[s.ID] {
				continue
			}
			seen[s.ID] = true
			all = append(all, s)
		}
	}
	return all
}

// ParseFile reads a single .md, extracts frontmatter, returns the Skill.
// Files without frontmatter are valid: ID/Name come from the basename and
// Description is empty (the model can still read it via `read`).
func ParseFile(path string) (Skill, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return Skill{}, err
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		abs = path
	}
	base := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	return parseSkillContent(content, base, abs), nil
}

// ParseBytes is ParseFile for in-memory content. `id` is the fallback
// ID/Name and `source` is shown in Path so the model can still cite where
// the skill came from.
func ParseBytes(content []byte, id, source string) Skill {
	return parseSkillContent(content, id, source)
}

// parseSkillContent does the actual frontmatter + body split. Kept in one
// place so file-loaded and bundle-loaded skills share semantics; the
// post-`---` body is preserved verbatim on the Skill so handlers can
// inline it when the caller explicitly pins this skill.
func parseSkillContent(content []byte, defaultID, sourcePath string) Skill {
	s := Skill{ID: defaultID, Name: defaultID, Path: sourcePath}
	text := string(content)
	if !strings.HasPrefix(text, "---") {
		// No frontmatter — whole file is the body.
		s.Body = text
		return s
	}
	// Trim the opening "---\n" (or "---\r\n").
	rest := strings.TrimPrefix(text, "---")
	rest = strings.TrimLeft(rest, "\r\n")
	end := strings.Index(rest, "\n---")
	if end < 0 {
		// Unterminated frontmatter — treat as no frontmatter, body = full file.
		s.Body = text
		return s
	}
	frontmatter := rest[:end]
	body := rest[end+len("\n---"):]
	body = strings.TrimLeft(body, "\r\n")
	s.Body = body
	s.BodyOffset = len(text) - len(body)

	for _, line := range strings.Split(frontmatter, "\n") {
		line = strings.TrimRight(line, "\r")
		k, v := splitKV(line)
		if k == "" {
			continue
		}
		switch k {
		case "id":
			s.ID = v
		case "name":
			s.Name = v
		case "description":
			s.Description = v
		case "source":
			// Frontmatter author tag (e.g. "agent"). Distinct from Source,
			// which LoadDir later sets to the discovery dir.
			s.Origin = v
		case "trigger":
			s.Trigger = v
		case "triggers":
			// open-design uses an inline array (`triggers: ["a", "b"]`) or
			// indented yaml list; we only consume the inline form. Strip
			// brackets/quotes and join with `|` to match the legacy
			// `trigger:` shape.
			t := strings.TrimSpace(v)
			t = strings.TrimPrefix(t, "[")
			t = strings.TrimSuffix(t, "]")
			parts := strings.Split(t, ",")
			for i, p := range parts {
				parts[i] = strings.Trim(strings.TrimSpace(p), `"'`)
			}
			s.Trigger = strings.Join(parts, "|")
		case "scope":
			s.Scope = v
		case "category":
			s.Category = v
		default:
			s.Raw = append(s.Raw, line)
		}
	}
	return s
}

// splitKV handles `key: value` lines. Trims surrounding quotes on values.
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
