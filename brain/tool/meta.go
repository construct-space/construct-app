// Meta-tools — discovery + dispatch primitives that let the model reach
// the hidden tool catalog without paying for every schema on every turn.
//
// Pi philosophy in action:
//   - Visible always: read/write/edit/bash + the four meta-tools below.
//   - Hidden: ~25 capabilities (git, grep, glob, lsp, graph, marketplace,
//     pdf, notebook, web, ask_user, space.*, preview, project_setup,
//     task, dispatch_subagent). Discoverable via list_tools, invocable
//     via call_tool.
//   - Skills: enumerated via list_skills, loaded via load_skill. Bodies
//     never sit in the default system prompt.
//
// The model's flow when it needs something exotic:
//  1. list_tools(filter?) → sees "git_status — Show working tree status …"
//  2. call_tool({name:"git_status", args:{}}) → gets the same string a
//     direct tool call would have returned.
package tool

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// ListTools dumps the catalog of registered tools (visible + hidden).
// `filter` is an optional substring match against name + description so
// the model can scope (e.g. filter="git" returns the five git_* tools).
type ListTools struct {
	Reg *Registry
}

func (ListTools) Name() string { return "list_tools" }

func (ListTools) Description() string {
	return "List the tools brain knows about — including hidden ones not shown in the default tools array. Returns name + description per tool. Use this when the obvious built-ins (read/write/edit/bash) don't fit the task; the result tells you what to invoke via call_tool. Pass `filter` (substring of name or description) to narrow down."
}

func (ListTools) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"filter": map[string]any{
				"type":        "string",
				"description": "Optional substring (case-insensitive) matched against name + description.",
			},
		},
	}
}

func (l ListTools) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	if l.Reg == nil {
		return "", fmt.Errorf("tool registry not configured")
	}
	var in struct {
		Filter string `json:"filter"`
	}
	_ = json.Unmarshal(raw, &in)
	all := l.Reg.ListAll()
	// Hide tools the current surface has opted out of. Keeps spacedev
	// from being tempted by host-level tools like list_spaces, and ask
	// from scaffolding/migrating spaces.
	surface := SurfaceFromCtx(ctx)
	if surface != "" {
		visible := all[:0]
		for _, t := range all {
			if SurfaceAllows(surface, t.Name) {
				visible = append(visible, t)
			}
		}
		all = visible
	}
	filter := strings.ToLower(strings.TrimSpace(in.Filter))
	if filter != "" {
		filtered := all[:0]
		for _, t := range all {
			if strings.Contains(strings.ToLower(t.Name), filter) ||
				strings.Contains(strings.ToLower(t.Description), filter) {
				filtered = append(filtered, t)
			}
		}
		all = filtered
	}
	// Render as a compact bullet list rather than JSON — easier for the
	// model to scan, smaller payload, and the structure carries no
	// information the model can act on programmatically.
	var b strings.Builder
	fmt.Fprintf(&b, "tools (%d):\n", len(all))
	for _, t := range all {
		mark := ""
		if t.Hidden {
			mark = " [call via call_tool]"
		}
		fmt.Fprintf(&b, "- %s%s — %s\n", t.Name, mark, t.Description)
	}
	return b.String(), nil
}

// CallTool is the single dispatcher for everything not in the visible
// set. The model passes a name and args object; brain looks the tool up
// in the registry (including hidden ones) and executes. Output is the
// underlying tool's result verbatim — call_tool is transparent.
type CallTool struct {
	Reg *Registry
}

func (CallTool) Name() string { return "call_tool" }

func (CallTool) Description() string {
	return "Invoke a tool by name with structured args. Use this for any tool list_tools showed as hidden. The result is the tool's output verbatim. Inspect input shape via list_tools(filter=name) or call_tool({name, args:{__schema__:true}}) returns the schema instead of running."
}

func (CallTool) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"name": map[string]any{"type": "string", "description": "Tool name as listed by list_tools."},
			"args": map[string]any{"type": "object", "description": "Arguments matching that tool's input schema."},
		},
		"required": []string{"name"},
	}
}

func (c CallTool) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	if c.Reg == nil {
		return "", fmt.Errorf("tool registry not configured")
	}
	var in struct {
		Name string          `json:"name"`
		Args json.RawMessage `json:"args"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fmt.Errorf("invalid input: %w", err)
	}
	if in.Name == "" {
		return "", fmt.Errorf("name is required")
	}
	if _, ok := c.Reg.Get(in.Name); !ok {
		// Don't just say "unknown" and hope the model calls list_tools — we
		// saw a loop where the same bogus name was retried four times in a
		// row. Inline the actual names (plus a closest-match suggestion when
		// one looks plausible) so the next call has what it needs without
		// another round trip.
		surface := SurfaceFromCtx(ctx)
		allNames := c.Reg.Names()
		names := make([]string, 0, len(allNames))
		for _, n := range allNames {
			if SurfaceAllows(surface, n) {
				names = append(names, n)
			}
		}
		sort.Strings(names)
		msg := fmt.Sprintf("unknown tool: %q.", in.Name)
		if suggest := closestName(in.Name, names); suggest != "" {
			msg += fmt.Sprintf(" Did you mean %q?", suggest)
		}
		msg += " Brain has no `org_members`/`list_users`/etc. — only the names below exist. Pick one (or stop and ask the user) instead of retrying with another guess.\n\nAvailable tools:\n  " + strings.Join(names, ", ")
		return "", fmt.Errorf("%s", msg)
	}
	// Schema introspection escape hatch — model passes args:{__schema__:true}
	// to retrieve the input schema instead of executing. Useful when the
	// model wants to construct args carefully for an unfamiliar tool.
	if schemaOnly(in.Args) {
		schema := c.Reg.SchemaOf(in.Name)
		b, _ := json.MarshalIndent(schema, "", "  ")
		return string(b), nil
	}
	if len(in.Args) == 0 {
		in.Args = json.RawMessage("{}")
	}
	out, isError := c.Reg.Execute(ctx, in.Name, in.Args)
	if isError {
		return "", fmt.Errorf("%s", out)
	}
	return out, nil
}

func schemaOnly(args json.RawMessage) bool {
	if len(args) == 0 {
		return false
	}
	var m map[string]any
	if err := json.Unmarshal(args, &m); err != nil {
		return false
	}
	v, ok := m["__schema__"]
	if !ok {
		return false
	}
	if b, ok := v.(bool); ok && b {
		return true
	}
	return false
}

// ListSkills enumerates registered skills with name + description. The
// model then calls load_skill(id) to read the full body. Replaces the
// "## Available skills" block that used to live in the system prompt.
type ListSkills struct {
	Reg *SkillRegistry
}

func (ListSkills) Name() string { return "list_skills" }

func (ListSkills) Description() string {
	return "List skills available in this brain — markdown playbooks with focused instructions for a domain. Returns id + name + description per skill. Call load_skill(id) to read the full body when one matches your task."
}

func (ListSkills) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"filter": map[string]any{
				"type":        "string",
				"description": "Optional substring matched against id + name + description.",
			},
		},
	}
}

func (l ListSkills) Execute(_ context.Context, raw json.RawMessage) (string, error) {
	if l.Reg == nil {
		return "no skills registered", nil
	}
	var in struct {
		Filter string `json:"filter"`
	}
	_ = json.Unmarshal(raw, &in)
	items := l.Reg.ListAll()
	filter := strings.ToLower(strings.TrimSpace(in.Filter))
	if filter != "" {
		filtered := items[:0]
		for _, s := range items {
			hay := strings.ToLower(s.ID + " " + s.Name + " " + s.Description)
			if strings.Contains(hay, filter) {
				filtered = append(filtered, s)
			}
		}
		items = filtered
	}
	sort.Slice(items, func(i, j int) bool { return items[i].ID < items[j].ID })
	var b strings.Builder
	fmt.Fprintf(&b, "skills (%d):\n", len(items))
	for _, s := range items {
		label := s.Name
		if label == "" {
			label = s.ID
		}
		fmt.Fprintf(&b, "- %s (%s) — %s\n", s.ID, label, s.Description)
	}
	return b.String(), nil
}

// closestName returns the candidate with the smallest Levenshtein-style
// distance from `target`, but only when the match is reasonably close
// (≤ ~40% of target length). Avoids suggesting wildly unrelated names
// like "bash" for "org_members" — a bad suggestion is worse than none.
func closestName(target string, candidates []string) string {
	if target == "" || len(candidates) == 0 {
		return ""
	}
	target = strings.ToLower(target)
	best := ""
	bestDist := -1
	for _, c := range candidates {
		d := editDistance(target, strings.ToLower(c))
		if bestDist < 0 || d < bestDist {
			bestDist = d
			best = c
		}
	}
	limit := len(target) * 2 / 5
	if limit < 2 {
		limit = 2
	}
	if bestDist > limit {
		return ""
	}
	return best
}

func editDistance(a, b string) int {
	ar, br := []rune(a), []rune(b)
	if len(ar) == 0 {
		return len(br)
	}
	if len(br) == 0 {
		return len(ar)
	}
	prev := make([]int, len(br)+1)
	cur := make([]int, len(br)+1)
	for j := range prev {
		prev[j] = j
	}
	for i := 1; i <= len(ar); i++ {
		cur[0] = i
		for j := 1; j <= len(br); j++ {
			cost := 1
			if ar[i-1] == br[j-1] {
				cost = 0
			}
			cur[j] = min3(cur[j-1]+1, prev[j]+1, prev[j-1]+cost)
		}
		prev, cur = cur, prev
	}
	return prev[len(br)]
}

func min3(a, b, c int) int {
	if a < b {
		if a < c {
			return a
		}
		return c
	}
	if b < c {
		return b
	}
	return c
}
