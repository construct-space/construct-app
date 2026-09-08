package skill

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// LoadSpaceSkill reads the root SKILL.md from a .space bundle. The bundle
// directory name is the fallback id so agentskills.io files that declare
// `name:` but not a Construct-specific `id:` still load as the space id.
func LoadSpaceSkill(skillPath string) (Skill, error) {
	raw, err := os.ReadFile(skillPath)
	if err != nil {
		return Skill{}, err
	}
	abs, err := filepath.Abs(skillPath)
	if err != nil {
		abs = skillPath
	}
	spaceDir := filepath.Dir(skillPath)
	id := strings.TrimSuffix(filepath.Base(spaceDir), ".space")
	s := ParseBytes(raw, id, abs)
	s.Source = spaceDir
	return s, nil
}

// LoadSpaceSkillsGlob walks root SKILL.md files inside installed .space
// bundles and returns one discoverable skill per space. Duplicate IDs keep
// the first seen, matching LoadDirs semantics.
func LoadSpaceSkillsGlob(pattern string) []Skill {
	matches, _ := filepath.Glob(pattern)
	if len(matches) == 0 {
		return nil
	}
	seen := make(map[string]bool)
	out := make([]Skill, 0, len(matches))
	for _, m := range matches {
		s, err := LoadSpaceSkill(m)
		if err != nil {
			fmt.Fprintf(os.Stderr, "[skill] space skill %s: %v\n", m, err)
			continue
		}
		if seen[s.ID] {
			continue
		}
		seen[s.ID] = true
		out = append(out, s)
	}
	return out
}
