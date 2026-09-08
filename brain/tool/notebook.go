// Jupyter notebook tools — read + edit .ipynb cells. Same wire shape as
// operator's builtin_notebook.go so existing agent prompts that mention
// notebook_read / notebook_edit keep working unchanged.
package tool

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

type ipynb struct {
	Cells         []ipynbCell    `json:"cells"`
	Metadata      map[string]any `json:"metadata,omitempty"`
	NBFormatMajor int            `json:"nbformat,omitempty"`
	NBFormatMinor int            `json:"nbformat_minor,omitempty"`
}

type ipynbCell struct {
	CellType       string         `json:"cell_type"`
	Source         []string       `json:"source"`
	Outputs        []ipynbOutput  `json:"outputs,omitempty"`
	Metadata       map[string]any `json:"metadata,omitempty"`
	ExecutionCount *int           `json:"execution_count,omitempty"`
}

type ipynbOutput struct {
	OutputType string         `json:"output_type"`
	Text       []string       `json:"text,omitempty"`
	Data       map[string]any `json:"data,omitempty"`
	Name       string         `json:"name,omitempty"`
	EName      string         `json:"ename,omitempty"`
	EValue     string         `json:"evalue,omitempty"`
	Traceback  []string       `json:"traceback,omitempty"`
}

// NotebookRead returns formatted cells from an .ipynb file. Outputs
// render under each code cell so agents see what last ran. Truncated at
// 50K chars; pass cell_index to read just one cell of a huge notebook.
type NotebookRead struct{}

func (NotebookRead) Name() string { return "notebook_read" }

func (NotebookRead) Description() string {
	return "Read a Jupyter notebook. Returns cells with type, source, and outputs in a readable form. Pass cell_index for single-cell mode."
}

func (NotebookRead) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"path":       map[string]any{"type": "string"},
			"cell_index": map[string]any{"type": "integer", "description": "0-based; omit to read all"},
		},
		"required": []string{"path"},
	}
}

func (NotebookRead) Execute(_ context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		Path      string `json:"path"`
		CellIndex *int   `json:"cell_index"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fmt.Errorf("invalid input: %w", err)
	}
	if in.Path == "" {
		return "", fmt.Errorf("path is required")
	}
	data, err := os.ReadFile(in.Path)
	if err != nil {
		return "", err
	}
	var nb ipynb
	if err := json.Unmarshal(data, &nb); err != nil {
		return "", fmt.Errorf("invalid notebook: %w", err)
	}
	if in.CellIndex != nil {
		idx := *in.CellIndex
		if idx < 0 || idx >= len(nb.Cells) {
			return "", fmt.Errorf("cell index %d out of range (notebook has %d cells)", idx, len(nb.Cells))
		}
		return renderIpynbCell(idx, nb.Cells[idx]), nil
	}
	var b strings.Builder
	fmt.Fprintf(&b, "# Notebook: %s (%d cells)\n\n", in.Path, len(nb.Cells))
	for i, c := range nb.Cells {
		b.WriteString(renderIpynbCell(i, c))
		b.WriteByte('\n')
	}
	out := b.String()
	if len(out) > 50_000 {
		out = out[:50_000] + fmt.Sprintf("\n\n[truncated — %d chars total]", len(out))
	}
	return out, nil
}

// NotebookEdit mutates a single cell: replace source, insert before/
// after, or delete. Writes the notebook back atomically. Clears outputs
// on replace so stale results don't claim freshness.
type NotebookEdit struct{}

func (NotebookEdit) Name() string { return "notebook_edit" }

func (NotebookEdit) Description() string {
	return "Edit a Jupyter notebook cell. Actions: replace, insert_after, insert_before, delete. Outputs are cleared on replace."
}

func (NotebookEdit) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"path":       map[string]any{"type": "string"},
			"cell_index": map[string]any{"type": "integer"},
			"action":     map[string]any{"type": "string", "enum": []string{"replace", "insert_after", "insert_before", "delete"}},
			"source":     map[string]any{"type": "string", "description": "New cell source (for replace/insert)"},
			"cell_type":  map[string]any{"type": "string", "enum": []string{"code", "markdown", "raw"}, "description": "Default code"},
		},
		"required": []string{"path", "cell_index", "action"},
	}
}

func (NotebookEdit) Execute(_ context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		Path      string `json:"path"`
		CellIndex int    `json:"cell_index"`
		Action    string `json:"action"`
		Source    string `json:"source"`
		CellType  string `json:"cell_type"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fmt.Errorf("invalid input: %w", err)
	}
	data, err := os.ReadFile(in.Path)
	if err != nil {
		return "", err
	}
	var nb ipynb
	if err := json.Unmarshal(data, &nb); err != nil {
		return "", fmt.Errorf("invalid notebook: %w", err)
	}
	if in.CellIndex < 0 || in.CellIndex >= len(nb.Cells) {
		// Allow appending past the end.
		if !(in.Action == "insert_after" && in.CellIndex == len(nb.Cells)-1) {
			if !(in.Action == "insert_before" && in.CellIndex == len(nb.Cells)) {
				return "", fmt.Errorf("cell index %d out of range (0..%d)", in.CellIndex, len(nb.Cells)-1)
			}
		}
	}
	cellType := in.CellType
	if cellType == "" {
		cellType = "code"
	}
	srcLines := splitNotebookSource(in.Source)

	switch in.Action {
	case "replace":
		nb.Cells[in.CellIndex].Source = srcLines
		nb.Cells[in.CellIndex].Outputs = nil
	case "insert_after":
		newCell := ipynbCell{CellType: cellType, Source: srcLines, Metadata: map[string]any{}}
		idx := in.CellIndex + 1
		nb.Cells = append(nb.Cells[:idx], append([]ipynbCell{newCell}, nb.Cells[idx:]...)...)
	case "insert_before":
		newCell := ipynbCell{CellType: cellType, Source: srcLines, Metadata: map[string]any{}}
		nb.Cells = append(nb.Cells[:in.CellIndex], append([]ipynbCell{newCell}, nb.Cells[in.CellIndex:]...)...)
	case "delete":
		nb.Cells = append(nb.Cells[:in.CellIndex], nb.Cells[in.CellIndex+1:]...)
	default:
		return "", fmt.Errorf("unknown action: %s", in.Action)
	}
	out, err := json.MarshalIndent(nb, "", " ")
	if err != nil {
		return "", err
	}
	out = append(out, '\n')
	// Atomic write so a crash doesn't leave a half-written notebook.
	tmp := in.Path + ".tmp"
	if err := os.WriteFile(tmp, out, 0o644); err != nil {
		return "", err
	}
	if err := os.Rename(tmp, in.Path); err != nil {
		return "", err
	}
	return fmt.Sprintf("Notebook %s: %s cell %d (now %d cells)", in.Action, cellType, in.CellIndex, len(nb.Cells)), nil
}

func renderIpynbCell(idx int, c ipynbCell) string {
	var b strings.Builder
	src := strings.Join(c.Source, "")
	switch c.CellType {
	case "markdown":
		fmt.Fprintf(&b, "## Cell %d [markdown]\n%s\n", idx, src)
	case "code":
		exec := ""
		if c.ExecutionCount != nil {
			exec = fmt.Sprintf(" [%d]", *c.ExecutionCount)
		}
		fmt.Fprintf(&b, "## Cell %d [code]%s\n```python\n%s\n```\n", idx, exec, src)
		for _, o := range c.Outputs {
			switch o.OutputType {
			case "stream":
				t := strings.Join(o.Text, "")
				if len(t) > 2000 {
					t = t[:2000] + "..."
				}
				fmt.Fprintf(&b, "**Output (%s):**\n```\n%s\n```\n", o.Name, t)
			case "execute_result", "display_data":
				if v, ok := o.Data["text/plain"]; ok {
					switch t := v.(type) {
					case string:
						fmt.Fprintf(&b, "**Result:**\n```\n%s\n```\n", t)
					case []any:
						var lines []string
						for _, l := range t {
							if s, ok := l.(string); ok {
								lines = append(lines, s)
							}
						}
						fmt.Fprintf(&b, "**Result:**\n```\n%s\n```\n", strings.Join(lines, ""))
					}
				}
			case "error":
				fmt.Fprintf(&b, "**Error: %s**\n%s\n", o.EName, o.EValue)
			}
		}
	case "raw":
		fmt.Fprintf(&b, "## Cell %d [raw]\n%s\n", idx, src)
	}
	return b.String()
}

// splitNotebookSource produces the array-of-lines shape Jupyter expects
// (every line except the last keeps its trailing newline).
func splitNotebookSource(s string) []string {
	if s == "" {
		return []string{}
	}
	lines := strings.Split(s, "\n")
	out := make([]string, len(lines))
	for i, l := range lines {
		if i < len(lines)-1 {
			out[i] = l + "\n"
		} else {
			out[i] = l
		}
	}
	return out
}
