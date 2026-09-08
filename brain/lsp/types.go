// Package lsp is a minimal Language Server Protocol client used by brain's
// code-intelligence tools. It implements JSON-RPC 2.0 over stdio against
// any LSP server binary (gopls, typescript-language-server, rust-analyzer,
// pyright/pylsp). Zero external Go deps — the protocol is hand-rolled.
package lsp

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
)

// ServerConfig describes how to launch an LSP server for a language.
type ServerConfig struct {
	Name          string            // logical id: "gopls", "typescript", ...
	Command       string            // executable on PATH
	Args          []string          // process args
	Env           []string          // extra env
	WorkspaceRoot string            // project root the server is rooted at
	Extensions    map[string]string // ".ts" -> "typescript"
	InitOptions   map[string]any    // initializationOptions for some servers
}

// LanguageID returns the LSP languageId for a file path, or "plaintext".
func (cfg *ServerConfig) LanguageID(path string) string {
	ext := strings.ToLower(filepath.Ext(path))
	if lang, ok := cfg.Extensions[ext]; ok {
		return lang
	}
	return "plaintext"
}

// Position is an LSP 0-indexed line/character pair.
type Position struct {
	Line      int `json:"line"`
	Character int `json:"character"`
}

// Range is a start/end position pair.
type Range struct {
	Start Position `json:"start"`
	End   Position `json:"end"`
}

// Location is a (file, range) pair returned by definition/references/etc.
type Location struct {
	URI   string `json:"uri"`
	Path  string `json:"path"` // resolved from URI for convenience
	Range Range  `json:"range"`
}

// Diagnostic is one error/warning the server published.
type Diagnostic struct {
	Range    Range  `json:"range"`
	Severity int    `json:"severity"` // 1=error 2=warning 3=info 4=hint
	Message  string `json:"message"`
	Source   string `json:"source,omitempty"`
	Code     any    `json:"code,omitempty"`
}

// SeverityLabel maps the numeric severity to a short label.
func (d Diagnostic) SeverityLabel() string {
	switch d.Severity {
	case 1:
		return "error"
	case 2:
		return "warning"
	case 3:
		return "info"
	case 4:
		return "hint"
	default:
		return "unknown"
	}
}

// String renders a diagnostic without file/line (used in tests).
func (d Diagnostic) String() string {
	return fmt.Sprintf("[%s] %s", d.SeverityLabel(), d.Message)
}

// FileDiagnostics groups diagnostics for one file.
type FileDiagnostics struct {
	Path        string       `json:"path"`
	URI         string       `json:"uri"`
	Diagnostics []Diagnostic `json:"diagnostics"`
}

// WorkspaceDiagnostics is the union across active servers.
type WorkspaceDiagnostics struct {
	Files []FileDiagnostics `json:"files"`
}

// TotalCount returns the sum of all diagnostics across files.
func (wd *WorkspaceDiagnostics) TotalCount() int {
	n := 0
	for _, f := range wd.Files {
		n += len(f.Diagnostics)
	}
	return n
}

// ErrorCount returns only severity=1 (error) diagnostics.
func (wd *WorkspaceDiagnostics) ErrorCount() int {
	n := 0
	for _, f := range wd.Files {
		for _, d := range f.Diagnostics {
			if d.Severity == 1 {
				n++
			}
		}
	}
	return n
}

// Render returns a human-formatted listing, capped at maxItems.
// Paths are written relative to root when possible.
func (wd *WorkspaceDiagnostics) Render(root string, maxItems int) string {
	if len(wd.Files) == 0 {
		return "No diagnostics."
	}
	var sb strings.Builder
	rendered := 0
	for _, f := range wd.Files {
		rel := relPath(root, f.Path)
		for _, d := range f.Diagnostics {
			if rendered >= maxItems {
				fmt.Fprintf(&sb, "... and %d more diagnostics\n", wd.TotalCount()-rendered)
				return sb.String()
			}
			fmt.Fprintf(&sb, "%s:%d:%d [%s] %s\n",
				rel, d.Range.Start.Line+1, d.Range.Start.Character+1,
				d.SeverityLabel(), d.Message)
			rendered++
		}
	}
	return sb.String()
}

// CallHierarchyItem is one entry in a call hierarchy result.
type CallHierarchyItem struct {
	Name           string `json:"name"`
	Kind           int    `json:"kind"`
	Detail         string `json:"detail,omitempty"`
	URI            string `json:"uri"`
	Range          Range  `json:"range"`
	SelectionRange Range  `json:"selectionRange"`
}

// CallHierarchyCall is one incoming or outgoing call.
type CallHierarchyCall struct {
	From       *CallHierarchyItem `json:"from,omitempty"` // incoming
	To         *CallHierarchyItem `json:"to,omitempty"`   // outgoing
	FromRanges []Range            `json:"fromRanges,omitempty"`
}

// parseLocations decodes a definition/references response that LSP encodes
// in three different shapes: a single Location, a Location array, or a
// LocationLink array. Returns nil on null.
func parseLocations(raw []byte) ([]Location, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}

	// Single Location
	var single struct {
		URI   string `json:"uri"`
		Range Range  `json:"range"`
	}
	if err := json.Unmarshal(raw, &single); err == nil && single.URI != "" {
		return []Location{{URI: single.URI, Path: uriToPath(single.URI), Range: single.Range}}, nil
	}

	// Location[]
	var locs []struct {
		URI   string `json:"uri"`
		Range Range  `json:"range"`
	}
	if err := json.Unmarshal(raw, &locs); err == nil && len(locs) > 0 && locs[0].URI != "" {
		out := make([]Location, len(locs))
		for i, l := range locs {
			out[i] = Location{URI: l.URI, Path: uriToPath(l.URI), Range: l.Range}
		}
		return out, nil
	}

	// LocationLink[]
	var links []struct {
		TargetURI            string `json:"targetUri"`
		TargetSelectionRange Range  `json:"targetSelectionRange"`
	}
	if err := json.Unmarshal(raw, &links); err == nil && len(links) > 0 && links[0].TargetURI != "" {
		out := make([]Location, len(links))
		for i, l := range links {
			out[i] = Location{URI: l.TargetURI, Path: uriToPath(l.TargetURI), Range: l.TargetSelectionRange}
		}
		return out, nil
	}

	return nil, nil
}

func uriToPath(uri string) string {
	if after, ok := strings.CutPrefix(uri, "file://"); ok {
		return after
	}
	return uri
}

func fileURI(path string) string {
	abs, err := filepath.Abs(path)
	if err != nil {
		abs = path
	}
	return "file://" + abs
}

func relPath(root, path string) string {
	if root == "" {
		return path
	}
	if rel, err := filepath.Rel(root, path); err == nil {
		return rel
	}
	return path
}
