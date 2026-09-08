// Agent memory — a bounded, self-curated store the model writes to across
// sessions (the "grows with you" loop). Scoped, à la the design agreed for
// Construct:
//
//   user    — personal, follows the user everywhere. <BrainDir>/memory/user.md
//   project — tied to the active project; lives with the repo so it travels
//             via git. <ProjectDir>/.construct/memory.md
//   org     — shared across the org's members. Server-side (source-api).
//             NOT YET WIRED — see docs/plans (Phase B); rejected for now.
//
// Applicable scopes are injected as a frozen snapshot into the system prompt
// each turn (LoadMemoryBlock). The model curates via the `memory` tool
// (add/replace/remove). Bounded by a soft char cap per file.
package tool

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const memorySoftCap = 4000 // per-scope soft char cap

// MemoryStore is file-backed and process-wide. Dir is <BrainDir>/memory (the
// user scope); project scope resolves against the active project dir.
//
// DirFn, when set, is consulted live on every access so memory follows
// profile switches — the brain may boot under one profile and switch to
// another without restarting, and a static boot-time dir would strand writes
// in the wrong profile.
type MemoryStore struct {
	mu    sync.Mutex
	Dir   string
	DirFn func() string
}

func NewMemoryStore(dir string) *MemoryStore { return &MemoryStore{Dir: dir} }

// NewMemoryStoreFn builds a store whose dir is resolved live (per profile).
func NewMemoryStoreFn(fn func() string) *MemoryStore { return &MemoryStore{DirFn: fn} }

func (s *MemoryStore) dir() string {
	if s.DirFn != nil {
		if d := s.DirFn(); d != "" {
			return d
		}
	}
	return s.Dir
}

// LoadMemoryBlock reads the applicable memory snapshot for system-prompt
// injection: user (always) + project (when projectDir is set). Free function
// so wire_prompt doesn't have to thread a store. Org scope is injected
// separately once the source-api store lands.
func LoadMemoryBlock(dir, projectDir string) string {
	return (&MemoryStore{Dir: dir}).Block(projectDir)
}

func (s *MemoryStore) userPath() string { return filepath.Join(s.dir(), "user.md") }

func projectPath(projectDir string) string {
	return filepath.Join(projectDir, ".construct", "memory.md")
}

// pathForScope resolves the on-disk file for a scope. projectDir is required
// for the project scope. Org is not yet available locally.
func (s *MemoryStore) pathForScope(scope, projectDir string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(scope)) {
	case "", "user":
		return s.userPath(), nil
	case "project":
		if projectDir == "" {
			return "", fmt.Errorf("no active project — open a project to use project-scoped memory")
		}
		return projectPath(projectDir), nil
	case "org":
		return "", fmt.Errorf("org-scoped memory is shared across your org and isn't available yet")
	default:
		return "", fmt.Errorf("unknown scope %q (user|project|org)", scope)
	}
}

func (s *MemoryStore) read(path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return string(b)
}

func (s *MemoryStore) write(path, content string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(content), 0o644)
}

// Block returns the formatted memory snapshot (user + project) for the system
// prompt, or "" if empty. Safe with a nil store.
func (s *MemoryStore) Block(projectDir string) string {
	if s == nil {
		return ""
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	usr := strings.TrimSpace(s.read(s.userPath()))
	var proj string
	if projectDir != "" {
		proj = strings.TrimSpace(s.read(projectPath(projectDir)))
	}
	if usr == "" && proj == "" {
		return ""
	}
	var b strings.Builder
	b.WriteString("<memory>\nWhat you've learned across sessions. Treat as background context, " +
		"and keep it current with the `memory` tool when you learn something durable.\n")
	if usr != "" {
		b.WriteString("\n## About the user (personal)\n")
		b.WriteString(usr)
		b.WriteString("\n")
	}
	if proj != "" {
		b.WriteString("\n## This project\n")
		b.WriteString(proj)
		b.WriteString("\n")
	}
	b.WriteString("</memory>")
	return b.String()
}

// Get returns the raw content for a scope (settings UI). projectDir required
// for project scope.
func (s *MemoryStore) Get(scope, projectDir string) (string, error) {
	if s == nil {
		return "", nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	path, err := s.pathForScope(scope, projectDir)
	if err != nil {
		return "", err
	}
	return s.read(path), nil
}

// Set overwrites a scope's content (manual edit in the UI).
func (s *MemoryStore) Set(scope, projectDir, content string) error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	path, err := s.pathForScope(scope, projectDir)
	if err != nil {
		return err
	}
	return s.write(path, content)
}

// Memory is the model-facing tool. add appends a bullet; replace swaps a
// substring; remove deletes one. Org is optional — when set, scope=org reads
// & writes the org's shared memory via source-api instead of a local file.
type Memory struct {
	Store *MemoryStore
	Org   *OrgMemoryClient
}

func (Memory) Name() string { return "memory" }

func (Memory) Description() string {
	return "Persist durable knowledge across sessions. action=add appends an entry; replace swaps matching text; remove deletes it. scope=user (about the user / personal preferences, default) or project (facts & conventions for the current project). Save things worth recalling next session — skip ephemera, secrets, and easily re-discoverable facts."
}

func (Memory) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"action": map[string]any{
				"type": "string",
				"enum": []string{"add", "replace", "remove"},
			},
			"scope": map[string]any{
				"type":        "string",
				"enum":        []string{"user", "project", "org"},
				"description": "user (default) = anything personal: the user's preferences, identity, working style — e.g. \"I prefer Astro\" is user. project = facts/conventions of the active project. org = shared with the whole organization (use sparingly). When unsure, use user.",
			},
			"text": map[string]any{"type": "string", "description": "add: the entry to save (a full sentence is best, e.g. \"Prefers Astro + Tailwind for landing pages\"); replace: the new text."},
			"find": map[string]any{"type": "string", "description": "replace/remove: the existing substring to match."},
		},
		"required": []string{"action"},
	}
}

func (m Memory) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	if m.Store == nil {
		return "", fmt.Errorf("memory store unavailable")
	}
	var in struct {
		Action string `json:"action"`
		Scope  string `json:"scope"`
		Text   string `json:"text"`
		Find   string `json:"find"`
		// Lenient aliases — models reach for value/content/key/entry. Accept
		// them so a reasonable call doesn't error on a param-name guess.
		Value   string `json:"value"`
		Content string `json:"content"`
		Key     string `json:"key"`
		Entry   string `json:"entry"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fmt.Errorf("invalid input: %w", err)
	}
	// Normalize the entry text from whichever field the model used.
	if strings.TrimSpace(in.Text) == "" {
		in.Text = firstNonEmpty(in.Value, in.Content, in.Entry)
	}
	if k := strings.TrimSpace(in.Key); k != "" && strings.TrimSpace(in.Text) != "" {
		in.Text = k + ": " + in.Text // "landing_stack: Astro + Tailwind"
	}

	scope := strings.ToLower(strings.TrimSpace(in.Scope))

	// Org scope routes to source-api (shared across the org) rather than a
	// local file. Read-modify-write the shared doc.
	if scope == "org" {
		return m.executeOrg(ctx, in.Action, in.Text, in.Find)
	}

	// Project scope needs an active project; if there isn't one, a stated
	// preference is better saved to user memory than lost — fall back.
	projectDir := CwdRaw(ctx)
	if scope == "project" && projectDir == "" {
		scope = "user"
	}

	m.Store.mu.Lock()
	defer m.Store.mu.Unlock()

	path, err := m.Store.pathForScope(scope, projectDir)
	if err != nil {
		return "", err
	}
	current := m.Store.read(path)

	updated, skipped, err := applyMemoryAction(in.Action, current, in.Text, in.Find, scopeLabel(in.Scope))
	if err != nil {
		return "", err
	}
	if skipped != "" {
		return jsonResult(map[string]any{"ok": true, "skipped": skipped}), nil
	}
	if err := m.Store.write(path, updated); err != nil {
		return "", fmt.Errorf("write memory: %w", err)
	}

	res := map[string]any{"ok": true, "scope": scopeLabel(in.Scope), "bytes": len(updated)}
	if len(updated) > memorySoftCap {
		res["warning"] = fmt.Sprintf("%s memory is %d chars (soft cap %d) — consider consolidating.", scopeLabel(in.Scope), len(updated), memorySoftCap)
	}
	return jsonResult(res), nil
}

// executeOrg routes scope=org through source-api: read the shared doc, apply
// the action, write it back. Shared across the org's members.
func (m Memory) executeOrg(ctx context.Context, action, text, find string) (string, error) {
	if m.Org == nil || m.Org.Token == "" {
		return "", fmt.Errorf("org memory unavailable — not signed in to an organization")
	}
	current, err := m.Org.Get(ctx)
	if err != nil {
		return "", fmt.Errorf("read org memory: %w", err)
	}
	updated, skipped, err := applyMemoryAction(action, current, text, find, "org")
	if err != nil {
		return "", err
	}
	if skipped != "" {
		return jsonResult(map[string]any{"ok": true, "skipped": skipped}), nil
	}
	if err := m.Org.Set(ctx, updated); err != nil {
		return "", fmt.Errorf("write org memory: %w", err)
	}
	return jsonResult(map[string]any{"ok": true, "scope": "org", "bytes": len(updated)}), nil
}

// applyMemoryAction returns the updated content for add/replace/remove, or a
// `skipped` reason (e.g. duplicate) when nothing changed. Shared by all scopes.
func applyMemoryAction(action, current, text, find, label string) (updated, skipped string, err error) {
	switch strings.ToLower(strings.TrimSpace(action)) {
	case "add":
		entry := strings.TrimSpace(text)
		if entry == "" {
			return "", "", fmt.Errorf("text is required for add")
		}
		// Fuzzy dedup: skip if a near-identical entry already exists (ignoring
		// case, whitespace, list-bullet, and trailing punctuation). Catches the
		// common "pages" vs "pages." double-save from an explicit add plus the
		// background review.
		if norm := normalizeMemoryEntry(entry); norm != "" {
			for _, line := range strings.Split(current, "\n") {
				if normalizeMemoryEntry(line) == norm {
					return "", "duplicate", nil
				}
			}
		}
		if !strings.HasPrefix(entry, "- ") {
			entry = "- " + entry
		}
		out := strings.TrimRight(current, "\n")
		if out != "" {
			out += "\n"
		}
		return out + entry + "\n", "", nil
	case "replace":
		if find == "" {
			return "", "", fmt.Errorf("find is required for replace")
		}
		if !strings.Contains(current, find) {
			return "", "", fmt.Errorf("find text not present in %s memory", label)
		}
		return strings.Replace(current, find, text, 1), "", nil
	case "remove":
		if find == "" {
			return "", "", fmt.Errorf("find is required for remove")
		}
		if !strings.Contains(current, find) {
			return "", "", fmt.Errorf("find text not present in %s memory", label)
		}
		return strings.ReplaceAll(strings.Replace(current, find, "", 1), "\n\n\n", "\n\n"), "", nil
	default:
		return "", "", fmt.Errorf("unknown action %q (add|replace|remove)", action)
	}
}

// normalizeMemoryEntry canonicalizes a memory line for dedup: lowercased,
// bullet + trailing punctuation stripped, internal whitespace collapsed.
func normalizeMemoryEntry(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.TrimPrefix(s, "- ")
	s = strings.TrimRight(strings.TrimSpace(s), ".,;:!? ")
	return strings.Join(strings.Fields(s), " ")
}

func scopeLabel(scope string) string {
	if s := strings.ToLower(strings.TrimSpace(scope)); s != "" {
		return s
	}
	return "user"
}

func jsonResult(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}
