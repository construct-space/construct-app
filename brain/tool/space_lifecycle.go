// Space lifecycle tools — thin wrappers around `@construct-space/cli`.
// Each tool here shells out to the exact CLI command a human would run
// from the space directory. Surfaces stay paired: every `construct <cmd>`
// the user can type, the agent can call via `space_<cmd>` from the same
// cwd, so behaviour is identical and bug reports translate cleanly.

package tool

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

// ─── space_scaffold ──────────────────────────────────────────────────
//
// Wraps `construct scaffold <id> [--name=...] [--description=...]`. The
// CLI creates a `space-<id>/` directory with manifest, root SKILL.md,
// agent config, src/, package.json, tools/, lib/, and the externals list
// pre-populated.

type SpaceScaffold struct{}

func (SpaceScaffold) Name() string { return "space_scaffold" }
func (SpaceScaffold) Description() string {
	return "Scaffold a new Construct Space. Calls `construct scaffold <id>` and creates a space-<id>/ directory with manifest, package.json, src/, root SKILL.md, agent/config.md, tools/, and lib/. Run from the project root (the dir that should contain space-<id>/). The id is kebab-case (e.g. \"crm\", \"my-notes\"); the directory name becomes \"space-<id>\"."
}
func (SpaceScaffold) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"id":          map[string]any{"type": "string", "description": "Kebab-case space id, e.g. 'crm' → space-crm/"},
			"name":        map[string]any{"type": "string", "description": "Optional display name; defaults to humanised id."},
			"description": map[string]any{"type": "string", "description": "Optional one-line description for space.manifest.json."},
			"path":        map[string]any{"type": "string", "description": "Project root to scaffold into. Defaults to cwd."},
		},
		"required": []string{"id"},
	}
}
func (SpaceScaffold) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		ID          string `json:"id"`
		Name        string `json:"name"`
		Description string `json:"description"`
		Path        string `json:"path"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fmt.Errorf("invalid input: %w", err)
	}
	in.ID = strings.TrimSpace(in.ID)
	if in.ID == "" {
		return "", fmt.Errorf("id is required")
	}
	dir := strings.TrimSpace(in.Path)
	if dir == "" {
		dir = Cwd(ctx)
	}
	args := []string{"scaffold", in.ID}
	if in.Name != "" {
		args = append(args, "--name", in.Name)
	}
	if in.Description != "" {
		args = append(args, "--description", in.Description)
	}
	out, err := runConstructCLI(ctx, args, dir, 60)
	if err != nil {
		return out, err
	}
	return fmt.Sprintf("Scaffolded space-%s/ in %s.\n%s", in.ID, dir, out), nil
}

// ─── space_validate ──────────────────────────────────────────────────
//
// Wraps `construct validate`. Lint pass against the space manifest, action
// schemas, and bundle config. Read-only; run before publish.

type SpaceValidate struct{}

func (SpaceValidate) Name() string { return "space_validate" }
func (SpaceValidate) Description() string {
	return "Validate a Construct Space against the manifest + action schemas. Calls `construct validate`. Read-only; returns parse errors, missing-field warnings, externals drift, and other issues that would block publish. Run from inside the space directory (the one with space.manifest.json)."
}
func (SpaceValidate) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"path": map[string]any{"type": "string", "description": "Space dir (contains space.manifest.json). Auto-detected when omitted."},
		},
	}
}
func (SpaceValidate) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		Path string `json:"path"`
	}
	_ = json.Unmarshal(raw, &in)
	dir, err := resolveSpaceDir(strings.TrimSpace(in.Path))
	if err != nil {
		return "", err
	}
	out, err := runConstructCLI(ctx, []string{"validate"}, dir, 30)
	if err != nil {
		return out, err
	}
	return fmt.Sprintf("Space validated at %s.\n%s", dir, out), nil
}

// ─── space_check ─────────────────────────────────────────────────────
//
// Wraps `construct check`. Static analysis — TypeScript types, ESLint,
// schema parity. Runs in seconds; safe to call before any build.

type SpaceCheck struct{}

func (SpaceCheck) Name() string { return "space_check" }
func (SpaceCheck) Description() string {
	return "Run the static analysis pass on a Space. Calls `construct check` — TypeScript types + lint + schema parity. Read-only; cheap; run before space_build to catch issues without paying the bundle cost."
}
func (SpaceCheck) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"path": map[string]any{"type": "string"},
		},
	}
}
func (SpaceCheck) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		Path string `json:"path"`
	}
	_ = json.Unmarshal(raw, &in)
	dir, err := resolveSpaceDir(strings.TrimSpace(in.Path))
	if err != nil {
		return "", err
	}
	out, err := runConstructCLI(ctx, []string{"check"}, dir, 60)
	if err != nil {
		return out, err
	}
	return out, nil
}

// ─── space_build ─────────────────────────────────────────────────────
//
// Wraps `construct build`. Produces `dist/<space-id>.space/`.
// Needed before space_install; space_publish runs this internally.

type SpaceBuild struct{}

func (SpaceBuild) Name() string { return "space_build" }
func (SpaceBuild) Description() string {
	return "Build a Construct Space to a deployable .space bundle. Calls `construct build` — produces dist/<space-id>.space/ with app.iife.js, style.css, manifest.json, SKILL.md, assets, agent files, tools/<platform>/, lib/<platform>/, and checksums. If root tools.go exists it is compiled into the bundle. Required before space_install or preview. Takes 5–30s depending on size."
}
func (SpaceBuild) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"path": map[string]any{"type": "string"},
		},
	}
}
func (SpaceBuild) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		Path string `json:"path"`
	}
	_ = json.Unmarshal(raw, &in)
	dir, err := resolveSpaceDir(strings.TrimSpace(in.Path))
	if err != nil {
		return "", err
	}
	out, err := runConstructCLI(ctx, []string{"build"}, dir, 180)
	if err != nil {
		return out, err
	}
	return fmt.Sprintf("Built space at %s.\n%s", dir, out), nil
}

// ─── space_install ───────────────────────────────────────────────────
//
// Wraps `construct install`. Installs the built bundle into the active
// profile so the Construct app can load it on next reload.

type SpaceInstall struct{}

func (SpaceInstall) Name() string { return "space_install" }
func (SpaceInstall) Description() string {
	return "Install the built Space into the active Construct profile. Calls `construct install`. Requires space_build to have run first — installs the existing dist/ output. After this completes, reload Construct (or call start_preview) to load the new bundle."
}
func (SpaceInstall) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"path": map[string]any{"type": "string"},
		},
	}
}
func (SpaceInstall) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		Path string `json:"path"`
	}
	_ = json.Unmarshal(raw, &in)
	dir, err := resolveSpaceDir(strings.TrimSpace(in.Path))
	if err != nil {
		return "", err
	}
	out, err := runConstructCLI(ctx, []string{"install"}, dir, 60)
	if err != nil {
		return out, err
	}
	return fmt.Sprintf("Installed space at %s.\n%s", dir, out), nil
}

// ─── space_publish ───────────────────────────────────────────────────
//
// Wraps `construct publish`. Validates → builds → uploads to the
// marketplace. Requires the user to be logged in (`construct login`)
// AND to be a registered publisher for the target space id.

type SpacePublish struct{}

func (SpacePublish) Name() string { return "space_publish" }
func (SpacePublish) Description() string {
	return "Publish a Space to the Construct marketplace. Calls `construct publish`. Internally runs validate + build + upload. The user must be logged in (`construct login` once) AND a registered publisher for this space id. Confirm with the user before invoking — this is a public-facing release."
}
func (SpacePublish) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"path":  map[string]any{"type": "string"},
			"draft": map[string]any{"type": "boolean", "description": "Publish as draft (visible only to publisher). Default false."},
		},
	}
}
func (SpacePublish) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		Path  string `json:"path"`
		Draft bool   `json:"draft"`
	}
	_ = json.Unmarshal(raw, &in)
	dir, err := resolveSpaceDir(strings.TrimSpace(in.Path))
	if err != nil {
		return "", err
	}
	args := []string{"publish"}
	if in.Draft {
		args = append(args, "--draft")
	}
	out, err := runConstructCLI(ctx, args, dir, 300)
	if err != nil {
		return out, err
	}
	return fmt.Sprintf("Published space from %s.\n%s", dir, out), nil
}

// ─── space_clean ─────────────────────────────────────────────────────
//
// Wraps `construct clean [--all]`. Removes build artifacts (dist/, .vite/);
// with all=true also drops node_modules/ and lockfiles. Safe — only deletes
// regenerable output.

type SpaceClean struct{}

func (SpaceClean) Name() string { return "space_clean" }
func (SpaceClean) Description() string {
	return "Remove a Space's build artifacts. Calls `construct clean` — deletes dist/ and .vite/. With all=true also removes node_modules/ and lockfiles (a full reset; the next build re-installs deps). Only touches regenerable output."
}
func (SpaceClean) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"all":  map[string]any{"type": "boolean", "description": "Also remove node_modules/ and lockfiles. Default false."},
			"path": map[string]any{"type": "string", "description": "Space dir (contains space.manifest.json). Auto-detected when omitted."},
		},
	}
}
func (SpaceClean) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		All  bool   `json:"all"`
		Path string `json:"path"`
	}
	_ = json.Unmarshal(raw, &in)
	dir, err := resolveSpaceDir(strings.TrimSpace(in.Path))
	if err != nil {
		return "", err
	}
	args := []string{"clean"}
	if in.All {
		args = append(args, "--all")
	}
	out, err := runConstructCLI(ctx, args, dir, 60)
	if err != nil {
		return out, err
	}
	return fmt.Sprintf("Cleaned space at %s.\n%s", dir, out), nil
}
