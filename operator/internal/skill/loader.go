package skill

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

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
