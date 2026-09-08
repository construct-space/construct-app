package tool

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"path/filepath"
	"sort"
	"strings"
)

// Glob walks the filesystem from a base directory and returns paths that
// match a doublestar-style pattern. Native version of `find -name`: no
// shell startup, structured output, deterministic ordering.
//
// Pattern supports filepath.Match semantics plus `**` to mean "any number
// of path segments". `**/*.go` finds every Go file recursively.
type Glob struct{}

func (Glob) Name() string { return "glob" }

func (Glob) Description() string {
	return "Find files matching a glob pattern. Supports `*`, `?`, `[abc]`, and `**` for any-depth recursion. Returns up to 500 matched paths, deepest matches sorted last. Cheap — runs without spawning a shell."
}

func (Glob) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"pattern": map[string]any{
				"type":        "string",
				"description": "Pattern like `**/*.ts` or `src/**/index.*`. Anchored at `base`.",
			},
			"base": map[string]any{
				"type":        "string",
				"description": "Directory to walk. Defaults to current working directory.",
			},
			"limit": map[string]any{
				"type":        "integer",
				"description": "Cap on returned paths. Default 500.",
			},
		},
		"required": []string{"pattern"},
	}
}

func (Glob) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		Pattern string `json:"pattern"`
		Base    string `json:"base"`
		Limit   int    `json:"limit"`
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
	if in.Limit <= 0 || in.Limit > 5000 {
		in.Limit = 500
	}

	matcher := compileDoublestar(in.Pattern)
	var matches []string
	err := filepath.WalkDir(in.Base, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // tolerate permission errors
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		// Skip the heavy hitters that bloat every walk.
		if d.IsDir() {
			name := d.Name()
			if name == "node_modules" || name == ".git" || name == "target" ||
				name == "dist" || name == ".next" || name == "vendor" ||
				name == ".venv" || name == "__pycache__" {
				return fs.SkipDir
			}
			return nil
		}
		rel, err := filepath.Rel(in.Base, path)
		if err != nil {
			rel = path
		}
		if matcher(rel) {
			matches = append(matches, rel)
			if len(matches) >= in.Limit {
				return fs.SkipAll
			}
		}
		return nil
	})
	if err != nil && err != fs.SkipAll {
		return "", err
	}
	sort.Strings(matches)
	if len(matches) == 0 {
		return "no matches", nil
	}
	return strings.Join(matches, "\n"), nil
}

// compileDoublestar returns a matcher fn for a filepath.Match-style pattern
// extended with `**` segments meaning "any number of path components".
// Split the pattern on `/`, match segment-by-segment; `**` consumes greedily.
func compileDoublestar(pat string) func(string) bool {
	segs := strings.Split(filepath.ToSlash(pat), "/")
	return func(path string) bool {
		parts := strings.Split(filepath.ToSlash(path), "/")
		return matchSegs(segs, parts)
	}
}

func matchSegs(pat, parts []string) bool {
	for i := 0; i < len(pat); i++ {
		if pat[i] == "**" {
			// Try every possible consumption of trailing parts.
			rest := pat[i+1:]
			if len(rest) == 0 {
				return true
			}
			for j := 0; j <= len(parts); j++ {
				if matchSegs(rest, parts[j:]) {
					return true
				}
			}
			return false
		}
		if len(parts) == 0 {
			return false
		}
		ok, _ := filepath.Match(pat[i], parts[0])
		if !ok {
			return false
		}
		parts = parts[1:]
	}
	return len(parts) == 0
}
