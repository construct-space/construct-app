package tool

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/construct-space/brain/lsp"
)

// The LSP tools share a single Manager. Workspace+language servers are
// spawned lazily on first use and shut down after IdleTimeout — see
// brain/lsp/manager.go. All four tools take 1-indexed line/character in
// keeping with how humans (and grep) report positions; the client adjusts
// to LSP's 0-indexed positions internally.

// ── lsp_diagnostics ────────────────────────────────────────────────────

// LSPDiagnostics returns all errors/warnings the language server has
// published for the workspace. Optionally syncs a single file first so
// the model sees the effect of a recent edit.
type LSPDiagnostics struct {
	Mgr *lsp.Manager
}

func (LSPDiagnostics) Name() string { return "lsp_diagnostics" }

func (LSPDiagnostics) Description() string {
	return "Get all errors and warnings in the workspace from the language server. Shows type errors, lint issues, and other problems the compiler found. Pass a path to sync that file first (recommended after editing it)."
}

func (LSPDiagnostics) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"path": map[string]any{
				"type":        "string",
				"description": "Optional: file to sync before collecting diagnostics. Use after editing the file.",
			},
		},
	}
}

func (t LSPDiagnostics) Execute(_ context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		Path string `json:"path"`
	}
	_ = json.Unmarshal(raw, &in)

	root := ""
	if in.Path != "" {
		abs, err := filepath.Abs(in.Path)
		if err == nil {
			root = lsp.DetectWorkspaceRoot(filepath.Dir(abs), "")
		}
		// Sync is best-effort — server may not be up yet, or extension may
		// not be supported. Don't block the diagnostics call on this.
		_ = t.Mgr.SyncFile(in.Path)
	}

	diags := t.Mgr.CollectDiagnostics(root)
	if diags.TotalCount() == 0 {
		return "No errors or warnings found.", nil
	}
	return fmt.Sprintf("%d diagnostics (%d errors):\n\n%s",
		diags.TotalCount(), diags.ErrorCount(), diags.Render(root, 50)), nil
}

// ── lsp_definition ────────────────────────────────────────────────────

// LSPDefinition resolves the symbol at a position to its definition site.
type LSPDefinition struct {
	Mgr *lsp.Manager
}

func (LSPDefinition) Name() string { return "lsp_definition" }

func (LSPDefinition) Description() string {
	return "Go to the definition of a symbol. Returns the file and line where the function, class, type, or variable is defined."
}

func (LSPDefinition) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"path":      map[string]any{"type": "string", "description": "File path containing the symbol."},
			"line":      map[string]any{"type": "integer", "description": "Line number (1-indexed)."},
			"character": map[string]any{"type": "integer", "description": "Column number (1-indexed)."},
		},
		"required": []string{"path", "line", "character"},
	}
}

func (t LSPDefinition) Execute(_ context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		Path      string `json:"path"`
		Line      int    `json:"line"`
		Character int    `json:"character"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fmt.Errorf("invalid input: %w", err)
	}
	if in.Path == "" {
		return "", fmt.Errorf("path is required")
	}

	locs, err := t.Mgr.GoToDefinition(in.Path, in.Line-1, in.Character-1)
	if err != nil {
		return "", err
	}
	if len(locs) == 0 {
		return "No definition found.", nil
	}
	return renderLocations(in.Path, locs), nil
}

// ── lsp_references ────────────────────────────────────────────────────

// LSPReferences finds every reference to the symbol under the cursor.
type LSPReferences struct {
	Mgr *lsp.Manager
}

func (LSPReferences) Name() string { return "lsp_references" }

func (LSPReferences) Description() string {
	return "Find all references to a symbol across the workspace. Shows every file and line that uses the function, class, type, or variable."
}

func (LSPReferences) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"path":      map[string]any{"type": "string", "description": "File path containing the symbol."},
			"line":      map[string]any{"type": "integer", "description": "Line number (1-indexed)."},
			"character": map[string]any{"type": "integer", "description": "Column number (1-indexed)."},
			"include_declaration": map[string]any{
				"type":        "boolean",
				"description": "Include the declaration itself in results (default true).",
			},
		},
		"required": []string{"path", "line", "character"},
	}
}

func (t LSPReferences) Execute(_ context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		Path               string `json:"path"`
		Line               int    `json:"line"`
		Character          int    `json:"character"`
		IncludeDeclaration *bool  `json:"include_declaration"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fmt.Errorf("invalid input: %w", err)
	}
	if in.Path == "" {
		return "", fmt.Errorf("path is required")
	}
	includeDecl := true
	if in.IncludeDeclaration != nil {
		includeDecl = *in.IncludeDeclaration
	}

	locs, err := t.Mgr.FindReferences(in.Path, in.Line-1, in.Character-1, includeDecl)
	if err != nil {
		return "", err
	}
	if len(locs) == 0 {
		return "No references found.", nil
	}
	var sb strings.Builder
	fmt.Fprintf(&sb, "%d references:\n\n", len(locs))
	sb.WriteString(renderLocations(in.Path, locs))
	return sb.String(), nil
}

// ── lsp_call_hierarchy ─────────────────────────────────────────────────

// LSPCallHierarchy reports who calls a function ("incoming") or what a
// function calls ("outgoing"). Defaults to incoming — that's what agents
// usually want when asking "where is this used".
type LSPCallHierarchy struct {
	Mgr *lsp.Manager
}

func (LSPCallHierarchy) Name() string { return "lsp_call_hierarchy" }

func (LSPCallHierarchy) Description() string {
	return "Show the call hierarchy for a function at a given position. direction=incoming lists callers (who invokes this), direction=outgoing lists callees (what this invokes). Defaults to incoming."
}

func (LSPCallHierarchy) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"path":      map[string]any{"type": "string", "description": "File path containing the function."},
			"line":      map[string]any{"type": "integer", "description": "Line number (1-indexed)."},
			"character": map[string]any{"type": "integer", "description": "Column number (1-indexed)."},
			"direction": map[string]any{
				"type":        "string",
				"enum":        []string{"incoming", "outgoing"},
				"description": "incoming = callers, outgoing = callees. Default: incoming.",
			},
		},
		"required": []string{"path", "line", "character"},
	}
}

func (t LSPCallHierarchy) Execute(_ context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		Path      string `json:"path"`
		Line      int    `json:"line"`
		Character int    `json:"character"`
		Direction string `json:"direction"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fmt.Errorf("invalid input: %w", err)
	}
	if in.Path == "" {
		return "", fmt.Errorf("path is required")
	}
	direction := in.Direction
	if direction == "" {
		direction = "incoming"
	}
	if direction != "incoming" && direction != "outgoing" {
		return "", fmt.Errorf("direction must be 'incoming' or 'outgoing'")
	}

	client, items, err := t.Mgr.PrepareCallHierarchy(in.Path, in.Line-1, in.Character-1)
	if err != nil {
		return "", err
	}
	if len(items) == 0 {
		return "No call hierarchy at that position (cursor must be on a function or method).", nil
	}

	root := lsp.DetectWorkspaceRoot(filepath.Dir(mustAbs(in.Path)), "")

	var sb strings.Builder
	for _, item := range items {
		fmt.Fprintf(&sb, "%s (%s)\n", item.Name, relFromURI(root, item.URI))
		var calls []lsp.CallHierarchyCall
		if direction == "incoming" {
			calls, err = client.IncomingCalls(item)
		} else {
			calls, err = client.OutgoingCalls(item)
		}
		if err != nil {
			fmt.Fprintf(&sb, "  error: %v\n", err)
			continue
		}
		if len(calls) == 0 {
			fmt.Fprintf(&sb, "  (no %s calls)\n", direction)
			continue
		}
		fmt.Fprintf(&sb, "  %s calls (%d):\n", direction, len(calls))
		for _, call := range calls {
			peer := call.From
			if direction == "outgoing" {
				peer = call.To
			}
			if peer == nil {
				continue
			}
			fmt.Fprintf(&sb, "    %s  %s:%d:%d\n",
				peer.Name,
				relFromURI(root, peer.URI),
				peer.SelectionRange.Start.Line+1,
				peer.SelectionRange.Start.Character+1,
			)
		}
	}
	return sb.String(), nil
}

// ── helpers ────────────────────────────────────────────────────────────

func renderLocations(refPath string, locs []lsp.Location) string {
	root := lsp.DetectWorkspaceRoot(filepath.Dir(mustAbs(refPath)), "")
	var sb strings.Builder
	for _, loc := range locs {
		path := loc.Path
		if rel, err := filepath.Rel(root, path); err == nil {
			path = rel
		}
		fmt.Fprintf(&sb, "%s:%d:%d\n", path, loc.Range.Start.Line+1, loc.Range.Start.Character+1)
	}
	return sb.String()
}

func relFromURI(root, uri string) string {
	path := strings.TrimPrefix(uri, "file://")
	if root != "" {
		if rel, err := filepath.Rel(root, path); err == nil {
			return rel
		}
	}
	return path
}

func mustAbs(p string) string {
	if abs, err := filepath.Abs(p); err == nil {
		return abs
	}
	return p
}
