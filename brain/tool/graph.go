// Graph tools wrap the `construct graph ...` CLI subcommands so agents
// can model space data without learning the CLI's full surface. Each
// tool resolves a space directory (CWD if it has space.manifest.json;
// otherwise the single space-*/ subdir with a manifest) and shells the
// CLI. Mirrors operator/internal/tool/builtin_graph.go.
package tool

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// resolveSpaceDir picks the working directory for a `construct graph ...`
// call. Caller-provided path wins; otherwise CWD or a single space-*/
// subdir. Errors out if zero or multiple candidates exist — agents must
// then pass `path` explicitly.
func resolveSpaceDir(userPath string) (string, error) {
	cwd, _ := os.Getwd()
	if userPath != "" {
		p := userPath
		if !filepath.IsAbs(p) && cwd != "" {
			p = filepath.Join(cwd, p)
		}
		if manifestExists(p) {
			return p, nil
		}
		return "", fmt.Errorf("path %q has no space.manifest.json", p)
	}
	if manifestExists(cwd) {
		return cwd, nil
	}
	entries, err := os.ReadDir(cwd)
	if err != nil {
		return "", fmt.Errorf("cannot read cwd %s: %w", cwd, err)
	}
	var candidates []string
	for _, e := range entries {
		if !e.IsDir() || !strings.HasPrefix(e.Name(), "space-") {
			continue
		}
		p := filepath.Join(cwd, e.Name())
		if manifestExists(p) {
			candidates = append(candidates, p)
		}
	}
	switch len(candidates) {
	case 0:
		return "", fmt.Errorf("no space.manifest.json in %s and no space-*/ subdirectory — pass path", cwd)
	case 1:
		return candidates[0], nil
	default:
		return "", fmt.Errorf("multiple space directories found (%s) — pass path", strings.Join(candidates, ", "))
	}
}

func manifestExists(dir string) bool {
	_, err := os.Stat(filepath.Join(dir, "space.manifest.json"))
	return err == nil
}

// runConstructCLI shells `construct <args...>` in dir with a timeout. If
// the CLI exits non-zero, the combined stdout+stderr is included in the
// error so the model can see what went wrong.
func runConstructCLI(parent context.Context, args []string, dir string, timeoutSec int) (string, error) {
	if timeoutSec <= 0 {
		timeoutSec = 30
	}
	ctx, cancel := context.WithTimeout(parent, time.Duration(timeoutSec)*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "construct", args...)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		return string(out), fmt.Errorf("%s: %s", err, strings.TrimSpace(string(out)))
	}
	return string(out), nil
}

// ─── space_graph_init ────────────────────────────────────────────────

type GraphInit struct{}

func (GraphInit) Name() string { return "space_graph_init" }
func (GraphInit) Description() string {
	return "Initialize Graph in a space project — adds Graph configuration files and dependencies. Run this before generating models."
}
func (GraphInit) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"path": map[string]any{"type": "string", "description": "Path to space dir (contains space.manifest.json). Auto-detected when omitted."},
		},
	}
}
func (GraphInit) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		Path string `json:"path"`
	}
	_ = json.Unmarshal(raw, &in)
	dir, err := resolveSpaceDir(strings.TrimSpace(in.Path))
	if err != nil {
		return "", err
	}
	out, err := runConstructCLI(ctx, []string{"graph", "init"}, dir, 30)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("Graph initialized in %s.\n%s", dir, out), nil
}

// ─── space_graph_generate ───────────────────────────────────────────

type GraphGenerate struct{}

func (GraphGenerate) Name() string { return "space_graph_generate" }
func (GraphGenerate) Description() string {
	return "Generate a data model from field definitions. Fields use 'name:type[:modifier...]' format (e.g. 'email:string:required:unique', 'department:belongsTo:Department'). Types: string/number/boolean/date/json. Modifiers: required/unique/email/default(value). Relations: belongsTo/hasMany/hasOne."
}
func (GraphGenerate) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"model":  map[string]any{"type": "string", "description": "Model name in PascalCase"},
			"fields": map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Field definitions"},
			"path":   map[string]any{"type": "string"},
		},
		"required": []string{"model", "fields"},
	}
}
func (GraphGenerate) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		Model  string   `json:"model"`
		Fields []string `json:"fields"`
		Path   string   `json:"path"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fmt.Errorf("invalid input: %w", err)
	}
	in.Model = strings.TrimSpace(in.Model)
	if in.Model == "" {
		return "", fmt.Errorf("model is required")
	}
	if len(in.Fields) == 0 {
		return "", fmt.Errorf("fields is required (at least one)")
	}
	dir, err := resolveSpaceDir(strings.TrimSpace(in.Path))
	if err != nil {
		return "", err
	}
	args := append([]string{"graph", "g", in.Model}, in.Fields...)
	out, err := runConstructCLI(ctx, args, dir, 30)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("Model %q generated with %d fields in %s.\n%s", in.Model, len(in.Fields), dir, out), nil
}

// ─── space_graph_push ────────────────────────────────────────────────

type GraphPush struct{}

func (GraphPush) Name() string { return "space_graph_push" }
func (GraphPush) Description() string {
	return "Register all local Graph models with the Graph service. Pushes the schema to the server without applying migrations."
}
func (GraphPush) InputSchema() map[string]any {
	return map[string]any{
		"type":       "object",
		"properties": map[string]any{"path": map[string]any{"type": "string"}},
	}
}
func (GraphPush) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		Path string `json:"path"`
	}
	_ = json.Unmarshal(raw, &in)
	dir, err := resolveSpaceDir(strings.TrimSpace(in.Path))
	if err != nil {
		return "", err
	}
	out, err := runConstructCLI(ctx, []string{"graph", "push"}, dir, 60)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("Graph schema pushed from %s.\n%s", dir, out), nil
}

// ─── space_graph_migrate ────────────────────────────────────────────

type GraphMigrate struct{}

func (GraphMigrate) Name() string { return "space_graph_migrate" }
func (GraphMigrate) Description() string {
	return "Compare local Graph schema with the server and optionally apply changes. apply=false (default) shows the diff only; apply=true executes destructive schema changes."
}
func (GraphMigrate) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"apply": map[string]any{"type": "boolean", "description": "Apply (destructive). Default false."},
			"path":  map[string]any{"type": "string"},
		},
	}
}
func (GraphMigrate) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		Apply bool   `json:"apply"`
		Path  string `json:"path"`
	}
	_ = json.Unmarshal(raw, &in)
	dir, err := resolveSpaceDir(strings.TrimSpace(in.Path))
	if err != nil {
		return "", err
	}
	args := []string{"graph", "migrate"}
	if in.Apply {
		args = append(args, "--apply")
	}
	out, err := runConstructCLI(ctx, args, dir, 120)
	if err != nil {
		return "", err
	}
	if in.Apply {
		return "Migration applied.\n" + out, nil
	}
	return "Migration diff (dry-run):\n" + out, nil
}

// ─── space_graph_status ────────────────────────────────────────────

type GraphStatus struct{}

func (GraphStatus) Name() string { return "space_graph_status" }
func (GraphStatus) Description() string {
	return "Check Graph schema status — diff local models against the server schema. Non-destructive."
}
func (GraphStatus) InputSchema() map[string]any {
	return map[string]any{
		"type":       "object",
		"properties": map[string]any{"path": map[string]any{"type": "string"}},
	}
}
func (GraphStatus) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		Path string `json:"path"`
	}
	_ = json.Unmarshal(raw, &in)
	dir, err := resolveSpaceDir(strings.TrimSpace(in.Path))
	if err != nil {
		return "", err
	}
	out, err := runConstructCLI(ctx, []string{"graph", "migrate"}, dir, 60)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(out) == "" {
		return "Graph schema is up to date — no pending changes.", nil
	}
	return "Graph schema status:\n" + out, nil
}
