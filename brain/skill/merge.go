package skill

// Merge concatenates two skill slices, preferring the first occurrence
// of any duplicate id. Used when an agent's bundled skills are layered
// on top of space-discovered ones — bundled wins, but anything the
// agent doesn't ship still bubbles through.
func Merge(base []Skill, extras []Skill) []Skill {
	seen := make(map[string]bool, len(base)+len(extras))
	out := make([]Skill, 0, len(base)+len(extras))
	for _, s := range base {
		if seen[s.ID] {
			continue
		}
		seen[s.ID] = true
		out = append(out, s)
	}
	for _, s := range extras {
		if seen[s.ID] {
			continue
		}
		seen[s.ID] = true
		out = append(out, s)
	}
	return out
}
