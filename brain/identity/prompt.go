package identity

import (
	"fmt"
	"strings"
)

// CurrentUserBlock returns a Markdown "## Current user" snippet for
// prepending to an agent's system prompt. Returns "" when the loader is
// nil or there's no signed-in user — caller can safely concatenate.
//
// Shared by handlePrompt (main streaming chat) and the subagent runner
// so every brain-routed agent — top-level Ask, Architect, Vibe, Coder,
// and any agent spawned via the `task` tool — sees the same identity
// context. Spaces that route their LLM calls through brain pick it up
// automatically; spaces that call providers directly are responsible
// for their own injection (none do today).
func CurrentUserBlock(l *Loader) string {
	if l == nil {
		return ""
	}
	u := l.Current().User
	if u.Email == "" {
		return ""
	}
	var b strings.Builder
	b.WriteString("## Current user\n")
	if u.Name != "" {
		fmt.Fprintf(&b, "- Name: %s\n", u.Name)
	} else if u.FirstName != "" || u.LastName != "" {
		fmt.Fprintf(&b, "- Name: %s %s\n", u.FirstName, u.LastName)
	}
	fmt.Fprintf(&b, "- Email: %s\n", u.Email)
	if u.Username != "" {
		fmt.Fprintf(&b, "- Username: %s\n", u.Username)
	}
	b.WriteString("Use this when the user says \"send me\", \"email me\", \"CC me\", or refers to themselves without stating an address.\n")
	b.WriteString("To look up colleagues, team members, or org structure: call `org_members` (hidden tool — use call_tool). It supports optional filters: department, role, q (name/email search). Never ask the user who their teammates are — call org_members first.\n")
	return b.String()
}
