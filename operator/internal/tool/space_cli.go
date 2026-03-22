// Space CLI tools — lifecycle operations for Construct spaces.
// These tools shell out to the `construct` CLI binary for scaffold, build,
// validate, check, install, and clean operations.
package tool

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"construct-operator/internal/appdir"
	"construct-operator/internal/provider"
)

// RegisterSpaceCLITools adds space lifecycle tools to the registry.
func RegisterSpaceCLITools(r *Registry, getWorkDir WorkDirFunc) {
	r.Register(spaceCreateTool(getWorkDir))
	r.Register(spaceBuildTool(getWorkDir))
	r.Register(spaceValidateTool(getWorkDir))
	r.Register(spaceCheckTool(getWorkDir))
	r.Register(spaceInstallTool(getWorkDir))
	r.Register(spaceCleanTool(getWorkDir))
	r.Register(spaceListInstalledTool())
	r.Register(spaceReadManifestTool(getWorkDir))
}

// devSpaceDataDir returns the Construct DEV data directory.
func devSpaceDataDir() string {
	// If operator knows its data dir (set by Tauri), use that
	if dir := os.Getenv("CONSTRUCT_DATA_DIR"); dir != "" {
		return dir
	}
	home, _ := os.UserHomeDir()
	switch runtime.GOOS {
	case "darwin":
		return filepath.Join(home, "Library", "Application Support", "Construct")
	case "windows":
		if appData := os.Getenv("APPDATA"); appData != "" {
			return filepath.Join(appData, "Construct")
		}
		return filepath.Join(home, "AppData", "Roaming", "Construct")
	default:
		if xdg := os.Getenv("XDG_DATA_HOME"); xdg != "" {
			return filepath.Join(xdg, "construct")
		}
		return filepath.Join(home, ".local", "share", "construct")
	}
}

// resolveBinary finds a binary by name.
// 1. exec.LookPath (operator's own PATH)
// 2. `which <name>` via login shell (user's full PATH — picks up ~/.bun/bin, nvm, etc.)
// 3. Optional extra candidate paths
func resolveBinary(name string, extraPaths ...string) (string, error) {
	if path, err := exec.LookPath(name); err == nil {
		return path, nil
	}

	// Try `which` via user's login shell
	if out, err := exec.Command("sh", "-lc", "which "+name).Output(); err == nil {
		path := strings.TrimSpace(string(out))
		if path != "" {
			return path, nil
		}
	}

	for _, c := range extraPaths {
		if _, err := os.Stat(c); err == nil {
			return c, nil
		}
	}
	return "", fmt.Errorf("%s not found in PATH", name)
}

// resolveConstructCLI finds the construct CLI binary.
func resolveConstructCLI() (string, error) {
	home, _ := os.UserHomeDir()
	path, err := resolveBinary("construct",
		filepath.Join(home, ".bun", "bin", "construct"),
		"/usr/local/bin/construct",
		"/opt/homebrew/bin/construct",
	)
	if err != nil {
		return "", fmt.Errorf("construct CLI not found. Install with: bun install -g @construct-space/cli")
	}
	return path, nil
}

// runCLI executes a construct CLI command and returns output.
func runCLI(ctx context.Context, args []string, workDir string, timeoutSec int) (string, error) {
	cliPath, err := resolveConstructCLI()
	if err != nil {
		return "", err
	}

	deadline := time.Duration(timeoutSec) * time.Second
	cmdCtx, cancel := context.WithTimeout(ctx, deadline)
	defer cancel()

	cmd := exec.CommandContext(cmdCtx, cliPath, args...)
	if workDir != "" {
		cmd.Dir = workDir
	}
	// Pass CONSTRUCT_DATA_DIR so CLI uses the same paths as the operator
	cmd.Env = append(os.Environ(), "CONSTRUCT_DATA_DIR="+appdir.Dir)

	var out, errBuf bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errBuf

	if err := cmd.Run(); err != nil {
		combined := out.String() + errBuf.String()
		if cmdCtx.Err() == context.DeadlineExceeded {
			return combined, fmt.Errorf("timed out after %ds", timeoutSec)
		}
		return combined, fmt.Errorf("%s", strings.TrimSpace(combined))
	}
	return out.String(), nil
}

// --- space_create ---

func spaceCreateTool(getWorkDir WorkDirFunc) *Tool {
	return &Tool{
		Def: provider.ToolDef{
			Name:        "space_create",
			Description: "Scaffold a new Construct space. Creates a directory with space.manifest.json, pages, components, and agent config. The directory name will be 'space-{name}' (e.g. space_create('tetris') creates space-tetris/).",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"name": map[string]any{
						"type":        "string",
						"description": "Space name without 'space-' prefix (e.g. 'tetris', 'analytics-dashboard'). Creates a 'space-{name}/' directory.",
					},
					"path": map[string]any{
						"type":        "string",
						"description": "Parent directory where space-{name}/ will be created. Defaults to current project directory.",
					},
				},
				"required": []string{"name"},
			},
		},
		Executor: &funcExecutor{fn: func(ctx context.Context, input string) (*Result, error) {
			var args struct {
				Name string `json:"name"`
				Path string `json:"path"`
			}
			if err := json.Unmarshal([]byte(input), &args); err != nil {
				return &Result{Content: err.Error(), IsError: true}, nil
			}

			// Ensure name has space- prefix for the directory
			dirName := args.Name
			if !strings.HasPrefix(dirName, "space-") {
				dirName = "space-" + dirName
			}

			// Run scaffold in the parent directory — CLI creates the subdirectory
			parentDir := args.Path
			if parentDir == "" {
				parentDir = getWorkDir(ctx)
			}

			output, err := runCLI(ctx, []string{"scaffold", dirName}, parentDir, 30)
			if err != nil {
				return &Result{Content: fmt.Sprintf("Failed to create space: %s", err), IsError: true}, nil
			}
			spacePath := filepath.Join(parentDir, dirName)
			return &Result{Content: fmt.Sprintf("Space created at %s\n\n%s\nNext steps:\n  cd %s\n  bun install\n  space_build, then space_install + construct_open_dev", spacePath, output, spacePath)}, nil
		}},
		Source: "builtin",
	}
}

// --- space_build ---

func spaceBuildTool(getWorkDir WorkDirFunc) *Tool {
	return &Tool{
		Def: provider.ToolDef{
			Name:        "space_build",
			Description: "Build a Construct space — generates entry.ts from manifest, runs Vite, produces the IIFE bundle in dist/.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"path": map[string]any{
						"type":        "string",
						"description": "Path to the space directory (must contain space.manifest.json). Defaults to current project.",
					},
					"entry_only": map[string]any{
						"type":        "boolean",
						"description": "Only regenerate src/entry.ts without running Vite build",
					},
				},
			},
		},
		Executor: &funcExecutor{fn: func(ctx context.Context, input string) (*Result, error) {
			var args struct {
				Path      string `json:"path"`
				EntryOnly bool   `json:"entry_only"`
			}
			json.Unmarshal([]byte(input), &args)
			dir := args.Path
			if dir == "" {
				dir = getWorkDir(ctx)
			}
			cliArgs := []string{"build"}
			if args.EntryOnly {
				cliArgs = append(cliArgs, "--entry-only")
			}
			output, err := runCLI(ctx, cliArgs, dir, 120)
			if err != nil {
				return &Result{Content: fmt.Sprintf("Build failed: %s", err), IsError: true}, nil
			}
			return &Result{Content: fmt.Sprintf("Build succeeded.\n%s", output)}, nil
		}},
		Source: "builtin",
	}
}

// --- space_validate ---

func spaceValidateTool(getWorkDir WorkDirFunc) *Tool {
	return &Tool{
		Def: provider.ToolDef{
			Name:        "space_validate",
			Description: "Validate a space's manifest file (space.manifest.json) — checks required fields, page references, and naming conventions.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"path": map[string]any{
						"type":        "string",
						"description": "Path to the space directory. Defaults to current project.",
					},
				},
			},
		},
		Executor: &funcExecutor{fn: func(ctx context.Context, input string) (*Result, error) {
			var args struct {
				Path string `json:"path"`
			}
			json.Unmarshal([]byte(input), &args)
			dir := args.Path
			if dir == "" {
				dir = getWorkDir(ctx)
			}
			output, err := runCLI(ctx, []string{"validate"}, dir, 15)
			if err != nil {
				return &Result{Content: fmt.Sprintf("Validation failed: %s", err), IsError: true}, nil
			}
			return &Result{Content: fmt.Sprintf("Validation passed.\n%s", output)}, nil
		}},
		Source: "builtin",
	}
}

// --- space_check ---

func spaceCheckTool(getWorkDir WorkDirFunc) *Tool {
	return &Tool{
		Def: provider.ToolDef{
			Name:        "space_check",
			Description: "Type-check and lint a space — runs vue-tsc and eslint.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"path": map[string]any{
						"type":        "string",
						"description": "Path to the space directory. Defaults to current project.",
					},
				},
			},
		},
		Executor: &funcExecutor{fn: func(ctx context.Context, input string) (*Result, error) {
			var args struct {
				Path string `json:"path"`
			}
			json.Unmarshal([]byte(input), &args)
			dir := args.Path
			if dir == "" {
				dir = getWorkDir(ctx)
			}
			output, err := runCLI(ctx, []string{"check"}, dir, 60)
			if err != nil {
				return &Result{Content: fmt.Sprintf("Check failed: %s", err), IsError: true}, nil
			}
			return &Result{Content: fmt.Sprintf("Type-check and lint passed.\n%s", output)}, nil
		}},
		Source: "builtin",
	}
}

// --- space_install ---

func spaceInstallTool(getWorkDir WorkDirFunc) *Tool {
	return &Tool{
		Def: provider.ToolDef{
			Name:        "space_install",
			Description: "Install a built space. By default installs to Construct DEV (for testing). Use production=true to install to the main Construct app.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"path": map[string]any{
						"type":        "string",
						"description": "Path to the space directory (must have been built first with space_build). Defaults to current project.",
					},
					"production": map[string]any{
						"type":        "boolean",
						"description": "Install to production Construct instead of Construct DEV (default: false)",
					},
				},
			},
		},
		Executor: &funcExecutor{fn: func(ctx context.Context, input string) (*Result, error) {
			var args struct {
				Path       string `json:"path"`
				Production bool   `json:"production"`
			}
			json.Unmarshal([]byte(input), &args)
			dir := args.Path
			if dir == "" {
				dir = getWorkDir(ctx)
			}

			if args.Production {
				// Production install via CLI
				output, err := runCLI(ctx, []string{"run"}, dir, 30)
				if err != nil {
					return &Result{Content: fmt.Sprintf("Install failed: %s", err), IsError: true}, nil
				}
				return &Result{Content: fmt.Sprintf("Space installed to production Construct.\n%s", output)}, nil
			}

			// Dev install — copy dist/ directly to the dev spaces dir
			// Read manifest to get space ID
			manifestData, err := os.ReadFile(filepath.Join(dir, "space.manifest.json"))
			if err != nil {
				return &Result{Content: fmt.Sprintf("Cannot read space.manifest.json: %s", err), IsError: true}, nil
			}
			var manifest struct {
				ID string `json:"id"`
			}
			if err := json.Unmarshal(manifestData, &manifest); err != nil || manifest.ID == "" {
				return &Result{Content: "Cannot parse space ID from manifest", IsError: true}, nil
			}

			distDir := filepath.Join(dir, "dist")
			if _, err := os.Stat(distDir); os.IsNotExist(err) {
				return &Result{Content: "No dist/ directory. Run space_build first.", IsError: true}, nil
			}

			// Resolve dev spaces dir
			devDataDir := devSpaceDataDir()
			devSpacesDir := filepath.Join(devDataDir, "spaces", manifest.ID)
			os.MkdirAll(devSpacesDir, 0755)

			// Copy dist contents to dev spaces dir
			entries, err := os.ReadDir(distDir)
			if err != nil {
				return &Result{Content: fmt.Sprintf("Cannot read dist/: %s", err), IsError: true}, nil
			}
			for _, entry := range entries {
				src := filepath.Join(distDir, entry.Name())
				dst := filepath.Join(devSpacesDir, entry.Name())
				data, err := os.ReadFile(src)
				if err != nil {
					continue
				}
				os.WriteFile(dst, data, 0644)
			}

			return &Result{Content: fmt.Sprintf("Space '%s' installed to Construct DEV at %s\nRestart or reload Construct DEV to see it.", manifest.ID, devSpacesDir)}, nil
		}},
		Source: "builtin",
	}
}

// --- space_clean ---

func spaceCleanTool(getWorkDir WorkDirFunc) *Tool {
	return &Tool{
		Def: provider.ToolDef{
			Name:        "space_clean",
			Description: "Remove build artifacts (dist/, .vite/) from a space. Optionally remove node_modules too.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"path": map[string]any{
						"type":        "string",
						"description": "Path to the space directory. Defaults to current project.",
					},
					"all": map[string]any{
						"type":        "boolean",
						"description": "Also remove node_modules and lockfiles",
					},
				},
			},
		},
		Executor: &funcExecutor{fn: func(ctx context.Context, input string) (*Result, error) {
			var args struct {
				Path string `json:"path"`
				All  bool   `json:"all"`
			}
			json.Unmarshal([]byte(input), &args)
			dir := args.Path
			if dir == "" {
				dir = getWorkDir(ctx)
			}
			cliArgs := []string{"clean"}
			if args.All {
				cliArgs = append(cliArgs, "--all")
			}
			output, err := runCLI(ctx, cliArgs, dir, 30)
			if err != nil {
				return &Result{Content: fmt.Sprintf("Clean failed: %s", err), IsError: true}, nil
			}
			return &Result{Content: fmt.Sprintf("Clean complete.\n%s", output)}, nil
		}},
		Source: "builtin",
	}
}

// --- space_list_installed ---

func spaceListInstalledTool() *Tool {
	return &Tool{
		Def: provider.ToolDef{
			Name:        "space_list_installed",
			Description: "List all spaces currently installed in the Construct app.",
			InputSchema: map[string]any{
				"type":       "object",
				"properties": map[string]any{},
			},
		},
		Executor: &funcExecutor{fn: func(ctx context.Context, input string) (*Result, error) {
			spacesDir := appdir.SpacesDir()
			entries, err := os.ReadDir(spacesDir)
			if err != nil {
				if os.IsNotExist(err) {
					return &Result{Content: "No spaces installed yet."}, nil
				}
				return &Result{Content: fmt.Sprintf("Error reading spaces: %v", err), IsError: true}, nil
			}

			type spaceInfo struct {
				ID          string `json:"id"`
				Name        string `json:"name,omitempty"`
				Version     string `json:"version,omitempty"`
				Description string `json:"description,omitempty"`
			}
			var spaces []spaceInfo
			for _, entry := range entries {
				if !entry.IsDir() {
					continue
				}
				info := spaceInfo{ID: entry.Name()}
				manifestPath := filepath.Join(spacesDir, entry.Name(), "manifest.json")
				if data, err := os.ReadFile(manifestPath); err == nil {
					var m map[string]any
					if json.Unmarshal(data, &m) == nil {
						if v, ok := m["name"].(string); ok {
							info.Name = v
						}
						if v, ok := m["version"].(string); ok {
							info.Version = v
						}
						if v, ok := m["description"].(string); ok {
							info.Description = v
						}
					}
				}
				spaces = append(spaces, info)
			}

			if len(spaces) == 0 {
				return &Result{Content: "No spaces installed."}, nil
			}

			out, _ := json.MarshalIndent(map[string]any{
				"spaces_dir": spacesDir,
				"count":      len(spaces),
				"spaces":     spaces,
			}, "", "  ")
			return &Result{Content: string(out)}, nil
		}},
		Source: "builtin",
	}
}

// --- space_read_manifest ---

func spaceReadManifestTool(getWorkDir WorkDirFunc) *Tool {
	return &Tool{
		Def: provider.ToolDef{
			Name:        "space_read_manifest",
			Description: "Read a space's manifest. Accepts a directory path or an installed space ID.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"path": map[string]any{
						"type":        "string",
						"description": "Path to a space directory, or a space ID (e.g. 'code') to read from installed spaces",
					},
				},
				"required": []string{"path"},
			},
		},
		Executor: &funcExecutor{fn: func(ctx context.Context, input string) (*Result, error) {
			var args struct {
				Path string `json:"path"`
			}
			if err := json.Unmarshal([]byte(input), &args); err != nil {
				return &Result{Content: err.Error(), IsError: true}, nil
			}

			// If path looks like a space ID (no slashes), try installed spaces
			if !strings.Contains(args.Path, "/") && !strings.Contains(args.Path, "\\") {
				installed := filepath.Join(appdir.SpacesDir(), args.Path, "manifest.json")
				if data, err := os.ReadFile(installed); err == nil {
					return &Result{Content: string(data)}, nil
				}
			}

			// Try as directory path
			dir := args.Path
			if !filepath.IsAbs(dir) {
				dir = filepath.Join(getWorkDir(ctx), dir)
			}
			for _, name := range []string{"space.manifest.json", "manifest.json"} {
				if data, err := os.ReadFile(filepath.Join(dir, name)); err == nil {
					return &Result{Content: string(data)}, nil
				}
			}
			return &Result{Content: fmt.Sprintf("Manifest not found in %s", args.Path), IsError: true}, nil
		}},
		Source: "builtin",
	}
}
