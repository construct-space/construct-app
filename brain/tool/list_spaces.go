package tool

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// ListSpaces enumerates spaces installed on this machine. A "space" is
// a directory with a space.manifest.json at its root, conventionally
// under ~/Spaces/space-*. Brain returns each space's id, name, scope,
// description, and the agent + tools it declares — enough for the LLM
// to decide "is there already a space that does X?" before suggesting
// an install or writing a new one.
//
// Hidden tool: the model finds it through list_tools when the user
// asks about installed spaces, or when planning whether to call
// space_run_action.
type ListSpaces struct{}

func (ListSpaces) Name() string { return "list_spaces" }

func (ListSpaces) Description() string {
	return "List spaces installed on this machine. Each space is a sandboxed module with its own actions, agent, and skills. Returns id + name + scope + agent + action names per space. Use this before space_run_action so you know which space exposes the action you need, and before suggesting a new space so you don't duplicate one that already exists."
}

func (ListSpaces) InputSchema() map[string]any {
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

// spaceManifest captures the bits brain surfaces. The real manifest has
// many more fields (scopes, permissions, theme, etc.) — list_spaces
// projects to a compact shape so a discovery call doesn't blow tokens.
//
// `actions` is intentionally `json.RawMessage` because manifests use
// the field two different ways:
//   - Static manifests (calculator, clock): `null` or omitted.
//   - Runtime-loaded actions (mail, calendar, chat, …): a STRING path
//     like "src/actions.ts" — the real action list comes from the
//     bundled JS at load time.
//   - Hypothetical inline form: an array of {name, description}.
//
// Modeling it as []struct rejects the string form and made the whole
// manifest fail to parse, dropping every space that declares runtime
// actions. RawMessage tolerates all three; we lazily peek at the
// shape in parseActions below.
type spaceAgent struct {
	ID string `json:"id,omitempty"`
}

type spaceManifest struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Description string          `json:"description,omitempty"`
	Scope       string          `json:"scope,omitempty"`
	Version     string          `json:"version,omitempty"`
	Agent       json.RawMessage `json:"agent,omitempty"`
	Actions     json.RawMessage `json:"actions,omitempty"`
}

// parseActions extracts a list of action names from the manifest's
// `actions` field. Returns nil for the path/string form (action names
// live in the bundle, not the manifest) and a populated list for
// inline-array manifests.
func parseActions(raw json.RawMessage) []string {
	if len(raw) == 0 {
		return nil
	}
	// String form ("src/actions.ts") → no names exposed at the manifest
	// layer; callers see the action list via space_list_actions instead.
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return nil
	}
	var arr []struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(raw, &arr); err == nil {
		names := make([]string, 0, len(arr))
		for _, a := range arr {
			if a.Name != "" {
				names = append(names, a.Name)
			}
		}
		return names
	}
	return nil
}

// parseAgent recovers the agent id from either a string ("agent/config.md")
// or an object ({"id": "mail-agent", ...}). Same defensive shape as actions.
func parseAgent(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return s
	}
	var obj spaceAgent
	if err := json.Unmarshal(raw, &obj); err == nil {
		return obj.ID
	}
	return ""
}

type spaceSummary struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Path        string   `json:"path"`
	Description string   `json:"description,omitempty"`
	Scope       string   `json:"scope,omitempty"`
	Version     string   `json:"version,omitempty"`
	Agent       string   `json:"agent,omitempty"`
	Actions     []string `json:"actions,omitempty"`
}

func (ListSpaces) Execute(_ context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		Filter string `json:"filter"`
	}
	_ = json.Unmarshal(raw, &in)
	filter := strings.ToLower(strings.TrimSpace(in.Filter))

	dirs := spaceSearchDirs()
	var out []spaceSummary
	seen := map[string]bool{}
	for _, dir := range dirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if !e.IsDir() || !strings.HasPrefix(e.Name(), "space-") {
				continue
			}
			path := filepath.Join(dir, e.Name())
			mfPath := filepath.Join(path, "space.manifest.json")
			b, err := os.ReadFile(mfPath)
			if err != nil {
				continue
			}
			var mf spaceManifest
			if err := json.Unmarshal(b, &mf); err != nil {
				continue
			}
			id := mf.ID
			if id == "" {
				// Fall back to dir name minus the "space-" prefix.
				id = strings.TrimPrefix(e.Name(), "space-")
			}
			if seen[id] {
				continue
			}
			seen[id] = true
			s := spaceSummary{
				ID: id, Name: mf.Name, Path: path,
				Description: mf.Description, Scope: mf.Scope, Version: mf.Version,
				Agent:   parseAgent(mf.Agent),
				Actions: parseActions(mf.Actions),
			}
			out = append(out, s)
		}
	}

	if filter != "" {
		filtered := out[:0]
		for _, s := range out {
			hay := strings.ToLower(s.ID + " " + s.Name + " " + s.Description)
			if strings.Contains(hay, filter) {
				filtered = append(filtered, s)
			}
		}
		out = filtered
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })

	if len(out) == 0 {
		return "no spaces installed", nil
	}
	body, err := json.MarshalIndent(map[string]any{
		"total":  len(out),
		"spaces": out,
	}, "", "  ")
	if err != nil {
		return "", fmt.Errorf("marshal: %w", err)
	}
	return string(body), nil
}

// spaceSearchDirs returns directories brain scans for installed spaces.
// Order: env override → ~/Spaces (the documented home) → CWD (for dev
// where a developer is iterating on a space they haven't installed yet).
func spaceSearchDirs() []string {
	var dirs []string
	if env := os.Getenv("CONSTRUCT_SPACES_DIR"); env != "" {
		dirs = append(dirs, env)
	}
	if home, err := os.UserHomeDir(); err == nil {
		dirs = append(dirs, filepath.Join(home, "Spaces"))
	}
	if cwd, err := os.Getwd(); err == nil {
		dirs = append(dirs, cwd)
	}
	return dirs
}
