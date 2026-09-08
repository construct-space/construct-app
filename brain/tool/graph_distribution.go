// Graph distribution + publisher/tenant tools wrap the `construct graph ...`
// management subcommands so agents can run a space's full publish lifecycle
// — list/fork spaces, group them into bundles, install/uninstall as a tenant,
// and control distribution (public / org_allowlist / private) — exactly as a
// human would from the CLI. Surfaces stay paired with `@construct-space/cli`:
// every `construct graph <cmd>` maps to one `space_graph_*` tool, same argv,
// same behaviour.
//
// Unlike the schema tools in graph.go, most of these are auth-scoped rather
// than directory-scoped — they act on a space by id, not a local manifest —
// so they run from the brain's cwd and rely on the active CLI profile. Only
// `graph fork` rewrites a local manifest, so it resolves a space dir. Every
// command passes --json for parseable output where the CLI supports it.
package tool

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

// cliCwd returns the directory auth-scoped graph commands run in. They don't
// need a space manifest — the CLI reads credentials from the active profile —
// so the brain's cwd is fine; an empty string lets exec use the process cwd.
func cliCwd(ctx context.Context) string {
	return Cwd(ctx)
}

// ─── space_graph_fork ────────────────────────────────────────────────

type GraphFork struct{}

func (GraphFork) Name() string { return "space_graph_fork" }
func (GraphFork) Description() string {
	return "Fork a space to a new id — rewrites the local space.manifest.json to point at new_space_id, detaching it from the original's published lineage. Calls `construct graph fork <new-space-id>`. Operates on a local space directory."
}
func (GraphFork) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"new_space_id": map[string]any{"type": "string", "description": "New space id to fork to (kebab-case)."},
			"path":         map[string]any{"type": "string", "description": "Space dir (contains space.manifest.json). Auto-detected when omitted."},
		},
		"required": []string{"new_space_id"},
	}
}
func (GraphFork) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		NewSpaceID string `json:"new_space_id"`
		Path       string `json:"path"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fmt.Errorf("invalid input: %w", err)
	}
	in.NewSpaceID = strings.TrimSpace(in.NewSpaceID)
	if in.NewSpaceID == "" {
		return "", fmt.Errorf("new_space_id is required")
	}
	dir, err := resolveSpaceDir(strings.TrimSpace(in.Path))
	if err != nil {
		return "", err
	}
	out, err := runConstructCLI(ctx, []string{"graph", "fork", in.NewSpaceID}, dir, 30)
	if err != nil {
		return out, err
	}
	return fmt.Sprintf("Forked space to %q in %s.\n%s", in.NewSpaceID, dir, out), nil
}

// ─── space_graph_spaces ──────────────────────────────────────────────

type GraphSpaces struct{}

func (GraphSpaces) Name() string { return "space_graph_spaces" }
func (GraphSpaces) Description() string {
	return "List the spaces your org has published. Calls `construct graph spaces --json`. Read-only. Optionally filter by bundle. Uses the active CLI profile's org unless org is given."
}
func (GraphSpaces) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"org":    map[string]any{"type": "string", "description": "Override the org id (defaults to the active profile's org)."},
			"bundle": map[string]any{"type": "string", "description": "Filter to a single bundle id."},
		},
	}
}
func (GraphSpaces) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		Org    string `json:"org"`
		Bundle string `json:"bundle"`
	}
	_ = json.Unmarshal(raw, &in)
	args := []string{"graph", "spaces"}
	if b := strings.TrimSpace(in.Bundle); b != "" {
		args = append(args, "--bundle", b)
	}
	args = appendOrg(args, in.Org)
	args = append(args, "--json")
	out, err := runConstructCLI(ctx, args, cliCwd(ctx), 30)
	if err != nil {
		return out, err
	}
	return out, nil
}

// ─── space_graph_bundles ─────────────────────────────────────────────

type GraphBundles struct{}

func (GraphBundles) Name() string { return "space_graph_bundles" }
func (GraphBundles) Description() string {
	return "Manage space bundles (publisher groupings). Calls `construct graph bundles <action> --json`. action=list shows your org's bundles; action=show needs id; action=create needs id + name. list/show are read-only; create makes a new bundle."
}
func (GraphBundles) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"action": map[string]any{"type": "string", "enum": []string{"list", "create", "show"}, "description": "Which bundle operation to run."},
			"id":     map[string]any{"type": "string", "description": "Bundle id. Required for create and show."},
			"name":   map[string]any{"type": "string", "description": "Bundle display name. Required for create."},
			"org":    map[string]any{"type": "string", "description": "Override the org id (defaults to the active profile's org)."},
		},
		"required": []string{"action"},
	}
}
func (GraphBundles) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		Action string `json:"action"`
		ID     string `json:"id"`
		Name   string `json:"name"`
		Org    string `json:"org"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fmt.Errorf("invalid input: %w", err)
	}
	action := strings.TrimSpace(in.Action)
	id := strings.TrimSpace(in.ID)
	name := strings.TrimSpace(in.Name)
	var args []string
	switch action {
	case "list":
		args = []string{"graph", "bundles", "list"}
	case "show":
		if id == "" {
			return "", fmt.Errorf("id is required for action=show")
		}
		args = []string{"graph", "bundles", "show", id}
	case "create":
		if id == "" || name == "" {
			return "", fmt.Errorf("id and name are required for action=create")
		}
		args = []string{"graph", "bundles", "create", id, name}
	default:
		return "", fmt.Errorf("action must be one of list|create|show, got %q", in.Action)
	}
	args = appendOrg(args, in.Org)
	args = append(args, "--json")
	out, err := runConstructCLI(ctx, args, cliCwd(ctx), 30)
	if err != nil {
		return out, err
	}
	return out, nil
}

// ─── space_graph_install ─────────────────────────────────────────────

type GraphInstall struct{}

func (GraphInstall) Name() string { return "space_graph_install" }
func (GraphInstall) Description() string {
	return "Tenant: install a published space for your org. Calls `construct graph install <space-id> --json`. The space must be public or your org must be on its allowlist. Idempotent; data is preserved across re-installs."
}
func (GraphInstall) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"space_id": map[string]any{"type": "string", "description": "Id of the space to install."},
			"org":      map[string]any{"type": "string", "description": "Override the org id (defaults to the active profile's org)."},
		},
		"required": []string{"space_id"},
	}
}
func (GraphInstall) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	return runSpaceIDGraph(ctx, raw, "install", 60)
}

// ─── space_graph_uninstall ───────────────────────────────────────────

type GraphUninstall struct{}

func (GraphUninstall) Name() string { return "space_graph_uninstall" }
func (GraphUninstall) Description() string {
	return "Tenant: uninstall a space from your org. Calls `construct graph uninstall <space-id> --json`. Removes the install; the org's data for the space is preserved (re-install restores access). Confirm with the user before invoking."
}
func (GraphUninstall) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"space_id": map[string]any{"type": "string", "description": "Id of the space to uninstall."},
			"org":      map[string]any{"type": "string", "description": "Override the org id (defaults to the active profile's org)."},
		},
		"required": []string{"space_id"},
	}
}
func (GraphUninstall) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	return runSpaceIDGraph(ctx, raw, "uninstall", 60)
}

// ─── space_graph_installs ────────────────────────────────────────────

type GraphInstalls struct{}

func (GraphInstalls) Name() string { return "space_graph_installs" }
func (GraphInstalls) Description() string {
	return "Publisher: list the orgs that have installed a space. Calls `construct graph installs <space-id> --json`. Read-only; you must be the space's publisher."
}
func (GraphInstalls) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"space_id": map[string]any{"type": "string", "description": "Id of the space whose installs to list."},
			"org":      map[string]any{"type": "string", "description": "Override the org id (defaults to the active profile's org)."},
		},
		"required": []string{"space_id"},
	}
}
func (GraphInstalls) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	return runSpaceIDGraph(ctx, raw, "installs", 30)
}

// ─── space_graph_distribution ────────────────────────────────────────

type GraphDistribution struct{}

func (GraphDistribution) Name() string { return "space_graph_distribution" }
func (GraphDistribution) Description() string {
	return "Set a space's distribution mode. Calls `construct graph distribution <space-id> <mode> --json`. mode is public (anyone can install), org_allowlist (only allowlisted orgs — manage with space_graph_allowlist), or private (publisher only). Changes who can install; confirm with the user before widening to public."
}
func (GraphDistribution) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"space_id": map[string]any{"type": "string", "description": "Id of the space to configure."},
			"mode":     map[string]any{"type": "string", "enum": []string{"public", "org_allowlist", "private"}, "description": "Distribution mode."},
			"org":      map[string]any{"type": "string", "description": "Override the org id (defaults to the active profile's org)."},
		},
		"required": []string{"space_id", "mode"},
	}
}
func (GraphDistribution) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		SpaceID string `json:"space_id"`
		Mode    string `json:"mode"`
		Org     string `json:"org"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fmt.Errorf("invalid input: %w", err)
	}
	spaceID := strings.TrimSpace(in.SpaceID)
	mode := strings.TrimSpace(in.Mode)
	if spaceID == "" {
		return "", fmt.Errorf("space_id is required")
	}
	switch mode {
	case "public", "org_allowlist", "private":
	default:
		return "", fmt.Errorf("mode must be one of public|org_allowlist|private, got %q", in.Mode)
	}
	args := []string{"graph", "distribution", spaceID, mode}
	args = appendOrg(args, in.Org)
	args = append(args, "--json")
	out, err := runConstructCLI(ctx, args, cliCwd(ctx), 30)
	if err != nil {
		return out, err
	}
	return fmt.Sprintf("Distribution for %q set to %q.\n%s", spaceID, mode, out), nil
}

// ─── space_graph_allowlist ───────────────────────────────────────────

type GraphAllowlist struct{}

func (GraphAllowlist) Name() string { return "space_graph_allowlist" }
func (GraphAllowlist) Description() string {
	return "Manage which orgs may install an org_allowlist-mode space. Calls `construct graph allowlist <add|rm> <space-id> <org-id> --json`. action=add grants an org install access; action=rm revokes it. Set the space to org_allowlist mode first via space_graph_distribution."
}
func (GraphAllowlist) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"action":   map[string]any{"type": "string", "enum": []string{"add", "rm"}, "description": "Grant (add) or revoke (rm) install access."},
			"space_id": map[string]any{"type": "string", "description": "Id of the org_allowlist-mode space."},
			"org_id":   map[string]any{"type": "string", "description": "Id of the org to grant/revoke."},
			"org":      map[string]any{"type": "string", "description": "Override the acting org id (defaults to the active profile's org)."},
		},
		"required": []string{"action", "space_id", "org_id"},
	}
}
func (GraphAllowlist) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		Action  string `json:"action"`
		SpaceID string `json:"space_id"`
		OrgID   string `json:"org_id"`
		Org     string `json:"org"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fmt.Errorf("invalid input: %w", err)
	}
	action := strings.TrimSpace(in.Action)
	spaceID := strings.TrimSpace(in.SpaceID)
	orgID := strings.TrimSpace(in.OrgID)
	if action != "add" && action != "rm" {
		return "", fmt.Errorf("action must be one of add|rm, got %q", in.Action)
	}
	if spaceID == "" || orgID == "" {
		return "", fmt.Errorf("space_id and org_id are required")
	}
	args := []string{"graph", "allowlist", action, spaceID, orgID}
	args = appendOrg(args, in.Org)
	args = append(args, "--json")
	out, err := runConstructCLI(ctx, args, cliCwd(ctx), 30)
	if err != nil {
		return out, err
	}
	verb := "added to"
	if action == "rm" {
		verb = "removed from"
	}
	return fmt.Sprintf("Org %q %s %q's allowlist.\n%s", orgID, verb, spaceID, out), nil
}

// ─── shared helpers ──────────────────────────────────────────────────

// appendOrg adds `--org <id>` when a non-empty override is supplied.
func appendOrg(args []string, org string) []string {
	if o := strings.TrimSpace(org); o != "" {
		return append(args, "--org", o)
	}
	return args
}

// runSpaceIDGraph runs `construct graph <sub> <space-id> [--org ...] --json`
// for the tenant/publisher ops whose only required positional is a space id.
func runSpaceIDGraph(ctx context.Context, raw json.RawMessage, sub string, timeoutSec int) (string, error) {
	var in struct {
		SpaceID string `json:"space_id"`
		Org     string `json:"org"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fmt.Errorf("invalid input: %w", err)
	}
	spaceID := strings.TrimSpace(in.SpaceID)
	if spaceID == "" {
		return "", fmt.Errorf("space_id is required")
	}
	args := []string{"graph", sub, spaceID}
	args = appendOrg(args, in.Org)
	args = append(args, "--json")
	out, err := runConstructCLI(ctx, args, cliCwd(ctx), timeoutSec)
	if err != nil {
		return out, err
	}
	return out, nil
}
