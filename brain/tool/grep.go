package tool

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// Grep walks the tree and searches file contents for a regex. Returns
// `path:line:body` lines, capped at a sensible default so a wide pattern
// doesn't flood the model's context. Native version of `rg`: no subprocess.
type Grep struct{}

func (Grep) Name() string { return "grep" }

func (Grep) Description() string {
	return "Search file contents for a regex pattern. Returns matches as `path:line:text`, capped at 200 lines by default. Use `file_pattern` to scope (e.g. `**/*.ts`). Skips node_modules, .git, dist, vendor automatically. Much cheaper than bash grep — no shell, no fork."
}

func (Grep) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"pattern": map[string]any{
				"type":        "string",
				"description": "Go RE2 regex. Use `(?i)` for case-insensitive.",
			},
			"base": map[string]any{
				"type":        "string",
				"description": "Directory to walk. Defaults to current working directory.",
			},
			"file_pattern": map[string]any{
				"type":        "string",
				"description": "Optional glob to restrict files searched, e.g. `**/*.go`.",
			},
			"limit": map[string]any{
				"type":        "integer",
				"description": "Cap on returned match lines. Default 200.",
			},
		},
		"required": []string{"pattern"},
	}
}

func (Grep) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		Pattern     string `json:"pattern"`
		Base        string `json:"base"`
		FilePattern string `json:"file_pattern"`
		Limit       int    `json:"limit"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fmt.Errorf("invalid input: %w", err)
	}
	if in.Pattern == "" {
		return "", fmt.Errorf("pattern is required")
	}
	if in.Base == "" {
		in.Base = Cwd(ctx)
	}
	if in.Limit <= 0 || in.Limit > 2000 {
		in.Limit = 200
	}
	re, err := regexp.Compile(in.Pattern)
	if err != nil {
		return "", fmt.Errorf("invalid regex: %w", err)
	}
	var fileMatch func(string) bool
	if in.FilePattern != "" {
		fileMatch = compileDoublestar(in.FilePattern)
	}

	var out []string
	err = filepath.WalkDir(in.Base, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if d.IsDir() {
			name := d.Name()
			if name == "node_modules" || name == ".git" || name == "target" ||
				name == "dist" || name == ".next" || name == "vendor" ||
				name == ".venv" || name == "__pycache__" {
				return fs.SkipDir
			}
			return nil
		}
		rel, _ := filepath.Rel(in.Base, path)
		if fileMatch != nil && !fileMatch(rel) {
			return nil
		}
		// Skip likely-binary files by extension to avoid garbage matches.
		switch strings.ToLower(filepath.Ext(path)) {
		case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf",
			".zip", ".tar", ".gz", ".bz2", ".xz", ".7z",
			".so", ".dylib", ".dll", ".exe", ".bin", ".o", ".a",
			".woff", ".woff2", ".ttf", ".otf", ".eot",
			".mp3", ".mp4", ".mov", ".wav", ".ogg", ".webm",
			".sqlite", ".db":
			return nil
		}
		f, err := os.Open(path)
		if err != nil {
			return nil
		}
		defer f.Close()
		scanner := bufio.NewScanner(f)
		scanner.Buffer(make([]byte, 64*1024), 1024*1024)
		lineNo := 0
		for scanner.Scan() {
			lineNo++
			line := scanner.Text()
			if re.MatchString(line) {
				if len(line) > 400 {
					line = line[:400] + "…"
				}
				out = append(out, fmt.Sprintf("%s:%d:%s", rel, lineNo, line))
				if len(out) >= in.Limit {
					return fs.SkipAll
				}
			}
		}
		return nil
	})
	if err != nil && err != fs.SkipAll {
		return "", err
	}
	if len(out) == 0 {
		return "no matches", nil
	}
	return strings.Join(out, "\n"), nil
}
