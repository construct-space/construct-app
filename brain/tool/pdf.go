package tool

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
)

const (
	pdfMaxPages    = 50
	pdfMaxFileSize = 10 * 1024 * 1024 // 10MB
)

// PDFRead extracts text from a PDF via pdftotext (poppler-utils). No
// in-process PDF parser — operator made the same call, and a stdlib
// PDF library would be 10KB of brittle byte-twiddling we don't need.
// If pdftotext is missing, the tool returns an install hint and the
// model can route around (e.g. ask the user to install).
type PDFRead struct{}

func (PDFRead) Name() string { return "read_pdf" }

func (PDFRead) Description() string {
	return "Extract text content from a PDF. Returns page-separated text. Requires pdftotext (poppler-utils) on PATH — install with `brew install poppler` on macOS or `apt install poppler-utils` on Linux."
}

func (PDFRead) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"path":  map[string]any{"type": "string", "description": "Absolute or CWD-relative path to the PDF"},
			"pages": map[string]any{"type": "string", "description": `Page range e.g. "1-5", "3". Defaults to all. Max 50 per call.`},
		},
		"required": []string{"path"},
	}
}

func (PDFRead) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		Path  string `json:"path"`
		Pages string `json:"pages"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fmt.Errorf("invalid input: %w", err)
	}
	if in.Path == "" {
		return "", fmt.Errorf("path is required")
	}
	info, err := os.Stat(in.Path)
	if err != nil {
		return "", fmt.Errorf("cannot access file: %w", err)
	}
	if info.IsDir() {
		return "", fmt.Errorf("path is a directory, not a PDF")
	}
	if info.Size() > pdfMaxFileSize {
		return "", fmt.Errorf("file too large: %d bytes (max %d)", info.Size(), pdfMaxFileSize)
	}
	first, last, err := parsePDFRange(in.Pages)
	if err != nil {
		return "", err
	}
	pdftotext, err := exec.LookPath("pdftotext")
	if err != nil {
		return "", fmt.Errorf("pdftotext not found. Install poppler-utils:\n  macOS: brew install poppler\n  Ubuntu/Debian: apt install poppler-utils")
	}

	args := []string{}
	if first > 0 {
		args = append(args, "-f", strconv.Itoa(first))
	}
	if last > 0 {
		args = append(args, "-l", strconv.Itoa(last))
	}
	args = append(args, "-layout", in.Path, "-")
	cmd := exec.CommandContext(ctx, pdftotext, args...)
	out, err := cmd.Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok && len(exitErr.Stderr) > 0 {
			return "", fmt.Errorf("pdftotext failed: %s", string(exitErr.Stderr))
		}
		return "", fmt.Errorf("pdftotext failed: %w", err)
	}
	text := string(out)
	if strings.TrimSpace(text) == "" {
		return "PDF contains no extractable text (image-only/scanned).", nil
	}
	pages := strings.Split(text, "\f")
	startPage := 1
	if first > 0 {
		startPage = first
	}
	var b strings.Builder
	for i, page := range pages {
		body := strings.TrimRight(page, "\n\r ")
		if body == "" && i == len(pages)-1 {
			// pdftotext often emits a trailing form-feed → empty tail page.
			continue
		}
		fmt.Fprintf(&b, "--- Page %d ---\n%s\n\n", startPage+i, body)
	}
	return b.String(), nil
}

func parsePDFRange(s string) (first, last int, err error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, 0, nil
	}
	if !strings.Contains(s, "-") {
		p, err := strconv.Atoi(s)
		if err != nil || p < 1 {
			return 0, 0, fmt.Errorf("invalid page number: %q", s)
		}
		return p, p, nil
	}
	parts := strings.SplitN(s, "-", 2)
	if len(parts) != 2 {
		return 0, 0, fmt.Errorf("invalid page range: %q", s)
	}
	first, err1 := strconv.Atoi(strings.TrimSpace(parts[0]))
	last, err2 := strconv.Atoi(strings.TrimSpace(parts[1]))
	if err1 != nil || err2 != nil || first < 1 || last < 1 {
		return 0, 0, fmt.Errorf("invalid page range: %q", s)
	}
	if last < first {
		return 0, 0, fmt.Errorf("end page (%d) must be >= start (%d)", last, first)
	}
	if last-first+1 > pdfMaxPages {
		return 0, 0, fmt.Errorf("requested %d pages, max %d per request", last-first+1, pdfMaxPages)
	}
	return first, last, nil
}
