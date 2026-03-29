// Built-in tools — the core tools that make agents useful.
// Same philosophy as Claude Code: Read, Write, Edit, Bash, Glob, Grep, Agent.
// These are the hands and eyes of the LLM.
package tool

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// WorkDirFunc returns the current working directory for tools.
// This is called on every tool execution so tools always use the active project root.
type WorkDirFunc func(context.Context) string

// RegisterBuiltins adds all built-in tools to the registry.
// getWorkDir is called on every tool invocation to resolve the current project directory.
func RegisterBuiltins(r *Registry, getWorkDir WorkDirFunc) {
	r.Register(readFileTool(getWorkDir))
	r.Register(writeFileTool(getWorkDir))
	r.Register(editFileTool(getWorkDir))
	r.Register(bashTool(getWorkDir))
	r.Register(globTool(getWorkDir))
	r.Register(grepTool(getWorkDir))
	r.Register(listDirTool(getWorkDir))
}

// --- Shared helpers ---

type funcExecutor struct {
	fn func(ctx context.Context, input string) (*Result, error)
}

func (f *funcExecutor) Execute(ctx context.Context, input string) (*Result, error) {
	return f.fn(ctx, input)
}

func resolvePath(workDir, path string) string {
	// Expand ~ to home directory
	if strings.HasPrefix(path, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			path = filepath.Join(home, path[2:])
		}
	}
	if filepath.IsAbs(path) {
		return path
	}
	return filepath.Join(workDir, path)
}

// constructProjectsRoot returns the configured projects directory.
// Reads CONSTRUCT_PROJECTS_ROOT env var (set by frontend), falls back to ~/ConstructProjects.
func constructProjectsRoot() string {
	if root := os.Getenv("CONSTRUCT_PROJECTS_ROOT"); root != "" {
		return root
	}
	if home, err := os.UserHomeDir(); err == nil {
		return filepath.Join(home, "ConstructProjects")
	}
	return ""
}

// isInsideProjectsRoot checks if a path is inside ~/ConstructProjects.
func isInsideProjectsRoot(path string) bool {
	root := constructProjectsRoot()
	if root == "" {
		return false
	}
	return strings.HasPrefix(path, root+string(filepath.Separator)) || path == root
}

// guardPath ensures the resolved path is within the project directory or ~/ConstructProjects.
func guardPath(workDir, path string) (string, error) {
	resolved := resolvePath(workDir, path)
	cleaned := filepath.Clean(resolved)
	if isInsideProjectsRoot(cleaned) {
		return cleaned, nil
	}
	root := filepath.Clean(workDir)
	if root == "" {
		return cleaned, nil
	}
	if !strings.HasPrefix(cleaned, root+string(filepath.Separator)) && cleaned != root {
		return "", fmt.Errorf("path %q is outside project directory %q", path, root)
	}
	return cleaned, nil
}

func existingCommandDir(workDir string) string {
	workDir = strings.TrimSpace(workDir)
	if workDir == "" {
		return ""
	}

	dir := filepath.Clean(workDir)
	for {
		info, err := os.Stat(dir)
		if err == nil && info.IsDir() {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}
