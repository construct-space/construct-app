// Package appdir provides the OS-native data directory for Operator.
//
//	macOS:   ~/Library/Application Support/Construct/
//	Windows: %APPDATA%\Construct\
//	Linux:   $XDG_DATA_HOME/construct/
package appdir

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

// Dir is the resolved data directory, set once at startup by Init().
// Falls back to nativeDir() so logs never write to cwd.
var Dir = nativeDir()

// Init resolves the data directory and ensures structure exists.
func Init(_ bool) {
	Dir = nativeDir()

	// Export as env var so child processes (space tools, hooks) can find the data dir
	os.Setenv("CONSTRUCT_DATA_DIR", Dir)

	// Ensure directory structure
	for _, sub := range []string{"", "bin", "logs", "spaces", "skills", "memory", "sessions", "state"} {
		os.MkdirAll(filepath.Join(Dir, sub), 0755)
	}

	fmt.Fprintf(os.Stderr, "[operator] data dir: %s\n", Dir)
}

// SpacesDir returns the path to the installed spaces directory.
func SpacesDir() string { return filepath.Join(Dir, "spaces") }

// AllSpacesDirs returns all directories where spaces can be found.
// This includes: installed spaces, and any extra dirs from CONSTRUCT_SPACES_PATH env var.
// The operator loads agents/tools from ALL these directories uniformly.
func AllSpacesDirs() []string {
	dirs := []string{SpacesDir()}
	// Extra space directories (e.g. built-in spaces from the construct repo during dev)
	if extra := os.Getenv("CONSTRUCT_SPACES_PATH"); extra != "" {
		for _, d := range filepath.SplitList(extra) {
			if d != "" {
				dirs = append(dirs, d)
			}
		}
	}
	return dirs
}

// SkillsDir returns the path to custom skills.
func SkillsDir() string { return filepath.Join(Dir, "skills") }

// MemoryDir returns the path to the memory store.
func MemoryDir() string { return filepath.Join(Dir, "memory") }

// LogsDir returns the path to log files.
func LogsDir() string { return filepath.Join(Dir, "logs") }

// SessionsDir returns the path to persisted sessions.
func SessionsDir() string { return filepath.Join(Dir, "sessions") }

// StateDir returns the path to persisted Construct-facing local state.
func StateDir() string { return filepath.Join(Dir, "state") }

func nativeDir() string {
	// Allow override via env
	if dir := os.Getenv("CONSTRUCT_DATA_DIR"); dir != "" {
		return dir
	}

	switch runtime.GOOS {
	case "darwin":
		home, _ := os.UserHomeDir()
		return filepath.Join(home, "Library", "Application Support", "Construct")

	case "windows":
		appData := os.Getenv("APPDATA")
		if appData == "" {
			home, _ := os.UserHomeDir()
			appData = filepath.Join(home, "AppData", "Roaming")
		}
		return filepath.Join(appData, "Construct")

	default: // linux
		dataHome := os.Getenv("XDG_DATA_HOME")
		if dataHome == "" {
			home, _ := os.UserHomeDir()
			dataHome = filepath.Join(home, ".local", "share")
		}
		return filepath.Join(dataHome, "construct")
	}
}
