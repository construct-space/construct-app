package skill

import (
	"fmt"
	"strings"
)

// BuildSystemPrompt returns the base system prompt plus a compact skill
// index (id + description, one per line). Bodies are NOT inlined — the
// model calls load_skill(id) when a task matches a description. This is
// the pi-mono pattern: a menu the model can scan in one cached prefix,
// without paying for every body up front.
func BuildSystemPrompt(base string, skills []Skill) string {
	var b strings.Builder
	b.WriteString(base)
	if base != "" && !strings.HasSuffix(base, "\n") {
		b.WriteByte('\n')
	}
	if len(skills) == 0 {
		return b.String()
	}
	if base != "" {
		b.WriteByte('\n')
	}
	b.WriteString("## Available skills\n")
	b.WriteString("Load with `load_skill(id)` when a task matches the description.\n\n")
	for _, s := range skills {
		desc := s.Description
		if desc == "" {
			desc = s.Name
		}
		fmt.Fprintf(&b, "- `%s` — %s\n", s.ID, desc)
	}
	return b.String()
}

// BuildSystemPromptHybrid inlines `inlined` skill bodies verbatim AND
// lists `indexed` skills as a load_skill(id) menu. Use when some skills
// matched a trigger heuristic for this turn (auto-loaded) but the rest
// should remain discoverable on demand.
func BuildSystemPromptHybrid(base string, indexed, inlined []Skill) string {
	var b strings.Builder
	b.WriteString(base)
	if base != "" && !strings.HasSuffix(base, "\n") {
		b.WriteByte('\n')
	}
	for _, s := range inlined {
		if s.Body == "" {
			continue
		}
		b.WriteString("\n## Skill: ")
		if s.Name != "" {
			b.WriteString(s.Name)
		} else {
			b.WriteString(s.ID)
		}
		if s.Description != "" {
			b.WriteString(" — ")
			b.WriteString(s.Description)
		}
		b.WriteString(" _(auto-loaded by trigger)_\n\n")
		b.WriteString(strings.TrimSpace(s.Body))
		b.WriteByte('\n')
	}
	if len(indexed) > 0 {
		b.WriteString("\n## Available skills\n")
		b.WriteString("Load with `load_skill(id)` when a task matches the description.\n\n")
		for _, s := range indexed {
			desc := s.Description
			if desc == "" {
				desc = s.Name
			}
			fmt.Fprintf(&b, "- `%s` — %s\n", s.ID, desc)
		}
	}
	return b.String()
}

// MatchTriggers partitions `skills` into (matched, rest) based on
// whether any of each skill's pipe-separated Trigger keywords appears
// in `text` (case-insensitive substring match). Skills with an empty
// Trigger are never auto-matched — they remain in `rest` for tier-1
// discovery. Keywords are trimmed; empties are ignored. The text is
// lower-cased once up front.
func MatchTriggers(skills []Skill, text string) (matched, rest []Skill) {
	hay := strings.ToLower(text)
	if hay == "" {
		return nil, skills
	}
	for _, s := range skills {
		if s.Trigger == "" {
			rest = append(rest, s)
			continue
		}
		hit := false
		for _, kw := range strings.Split(s.Trigger, "|") {
			kw = strings.ToLower(strings.TrimSpace(kw))
			if kw == "" {
				continue
			}
			if strings.Contains(hay, kw) {
				hit = true
				break
			}
		}
		if hit {
			matched = append(matched, s)
		} else {
			rest = append(rest, s)
		}
	}
	return matched, rest
}

// BuildSystemPromptWithInlined returns the base prompt with the bodies
// of `pinned` skills appended verbatim. Use when the caller has
// explicitly named which skills are in-context for this turn (the
// space-panel "you're inside Pages — load the pages skill" path). Skips
// the discovery pointer because the only relevant skills are already
// right here.
func BuildSystemPromptWithInlined(base string, pinned []Skill) string {
	var b strings.Builder
	b.WriteString(base)
	if base != "" && !strings.HasSuffix(base, "\n") {
		b.WriteByte('\n')
	}
	for _, s := range pinned {
		if s.Body == "" {
			continue
		}
		b.WriteString("\n## Skill: ")
		if s.Name != "" {
			b.WriteString(s.Name)
		} else {
			b.WriteString(s.ID)
		}
		if s.Description != "" {
			b.WriteString(" — ")
			b.WriteString(s.Description)
		}
		b.WriteString("\n\n")
		b.WriteString(strings.TrimSpace(s.Body))
		b.WriteByte('\n')
	}
	return b.String()
}
