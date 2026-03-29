// Package tool defines the tool system.
// Tools are composable and can come from built-ins, spaces, MCP servers, or skills.
package tool

import (
	"context"
	"strings"
	"sync"

	"construct-operator/internal/provider"
	"construct-operator/internal/provider/helpers"
)

// legacySanitizeName mirrors the older registry-time sanitization scheme.
// Keep it only as a compatibility alias for existing sessions/config.
func legacySanitizeName(name string) string {
	name = strings.ReplaceAll(name, ".", "__")
	name = strings.ReplaceAll(name, ":", "__")
	name = strings.ReplaceAll(name, " ", "_")
	return name
}

// Executor runs a tool and returns the result.
type Executor interface {
	// Execute runs the tool with the given JSON input.
	Execute(ctx context.Context, input string) (*Result, error)
}

// Result is what a tool execution returns.
type Result struct {
	Content string `json:"content"`
	IsError bool   `json:"is_error,omitempty"`
}

// Tool is a registered tool with its definition and executor.
type Tool struct {
	Def      provider.ToolDef
	Executor Executor
	Source   string // "builtin", "mcp:<server-id>", "skill:<skill-id>"
}

// Registry holds all available tools.
type Registry struct {
	mu    sync.RWMutex
	tools map[string]*Tool
	// aliases maps legacy/provider-encoded names back to canonical tool names.
	aliases map[string]string
}

func NewRegistry() *Registry {
	return &Registry{
		tools:   make(map[string]*Tool),
		aliases: make(map[string]string),
	}
}

func (r *Registry) Register(t *Tool) {
	r.mu.Lock()
	defer r.mu.Unlock()

	name := strings.TrimSpace(t.Def.Name)
	t.Def.Name = name
	r.tools[name] = t
	r.removeAliasesLocked(name)

	if alias := legacySanitizeName(name); alias != "" && alias != name {
		r.aliases[alias] = name
	}
}

func (r *Registry) Get(name string) (*Tool, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	t, ok := r.tools[name]
	if ok {
		return t, true
	}

	if canonical, ok := r.aliases[name]; ok {
		t, ok = r.tools[canonical]
		return t, ok
	}

	if decoded := helpers.UnsanitizeToolName(name); decoded != name {
		t, ok = r.tools[decoded]
		if ok {
			return t, true
		}
		if canonical, ok := r.aliases[decoded]; ok {
			t, ok = r.tools[canonical]
			return t, ok
		}
	}

	return t, ok
}

func (r *Registry) Remove(name string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	canonical := r.canonicalizeNameLocked(name)
	delete(r.tools, canonical)
	r.removeAliasesLocked(canonical)
}

func (r *Registry) RemoveBySource(source string) int {
	r.mu.Lock()
	defer r.mu.Unlock()

	removed := 0
	for name, t := range r.tools {
		if t.Source == source || strings.HasPrefix(t.Source, source+":") {
			delete(r.tools, name)
			r.removeAliasesLocked(name)
			removed++
		}
	}
	return removed
}

// ForAgent returns tools filtered by an agent's allowed/blocked lists.
func (r *Registry) ForAgent(allowed, blocked []string) []*Tool {
	r.mu.RLock()
	defer r.mu.RUnlock()

	if len(allowed) == 0 && len(blocked) == 0 {
		return r.allLocked()
	}

	allowSet := r.toCanonicalSetLocked(allowed)
	blockSet := r.toCanonicalSetLocked(blocked)

	// Extract prefix patterns (entries ending with *)
	var blockPrefixes []string
	for _, b := range blocked {
		if strings.HasSuffix(b, "*") {
			blockPrefixes = append(blockPrefixes, strings.TrimSuffix(b, "*"))
		}
	}

	var result []*Tool
	for _, t := range r.tools {
		name := t.Def.Name
		if len(blockSet) > 0 && blockSet[name] {
			continue
		}
		blocked := false
		for _, prefix := range blockPrefixes {
			if strings.HasPrefix(name, prefix) {
				blocked = true
				break
			}
		}
		if blocked {
			continue
		}
		if len(allowSet) > 0 && !allowSet[name] {
			continue
		}
		result = append(result, t)
	}
	return result
}

func (r *Registry) All() []*Tool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.allLocked()
}

func (r *Registry) allLocked() []*Tool {
	result := make([]*Tool, 0, len(r.tools))
	for _, t := range r.tools {
		result = append(result, t)
	}
	return result
}

func (r *Registry) Defs() []provider.ToolDef {
	r.mu.RLock()
	defer r.mu.RUnlock()

	defs := make([]provider.ToolDef, 0, len(r.tools))
	for _, t := range r.tools {
		defs = append(defs, t.Def)
	}
	return defs
}

// Func creates a Tool from a function — convenience for inline tool definitions.
func Func(name, description string, inputSchema any, fn func(ctx context.Context, input string) (*Result, error)) *Tool {
	return &Tool{
		Def: provider.ToolDef{
			Name:        name,
			Description: description,
			InputSchema: inputSchema,
		},
		Executor: &funcExec{fn: fn},
		Source:   "builtin",
	}
}

type funcExec struct {
	fn func(ctx context.Context, input string) (*Result, error)
}

func (f *funcExec) Execute(ctx context.Context, input string) (*Result, error) {
	return f.fn(ctx, input)
}

func (r *Registry) canonicalizeNameLocked(name string) string {
	if canonical, ok := r.aliases[name]; ok {
		return canonical
	}
	if decoded := helpers.UnsanitizeToolName(name); decoded != name {
		if canonical, ok := r.aliases[decoded]; ok {
			return canonical
		}
		return decoded
	}
	return name
}

func (r *Registry) removeAliasesLocked(canonical string) {
	for alias, target := range r.aliases {
		if target == canonical {
			delete(r.aliases, alias)
		}
	}
}

func (r *Registry) toCanonicalSetLocked(items []string) map[string]bool {
	m := make(map[string]bool, len(items))
	for _, item := range items {
		if strings.HasSuffix(item, "*") {
			continue
		}
		m[r.canonicalizeNameLocked(item)] = true
	}
	return m
}

func toSet(ss []string) map[string]bool {
	m := make(map[string]bool, len(ss))
	for _, s := range ss {
		m[s] = true
	}
	return m
}
