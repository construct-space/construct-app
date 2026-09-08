// Package paths resolves CONSTRUCT_DATA_DIR and brain's storage layout.
//
// Brain is always profile-scoped — DataDir points at
// `<base>/profiles/<activeID>`, never at the base data dir. The desktop
// shell passes CONSTRUCT_DATA_DIR=<profile-dir> when spawning brain, but
// when brain is launched standalone (CLI / dev) we mirror the operator's
// appdir.go pattern: resolve a base dir, ensure a profile exists in
// profiles.json (auto-creating a Default one on fresh install), then
// return the profile dir.
package paths

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

type Paths struct {
	DataDir       string // <base>/profiles/<activeID> — always profile-scoped
	BaseDir       string // <base> — shared root (only profiles.json lives here)
	BrainDir      string // <DataDir>/brain
	SessionsDir   string // <BrainDir>/sessions
	StateDir      string // <BrainDir>/state
	LogsDir       string // <BrainDir>/logs
	AuthFile      string // <DataDir>/auth.json
	ProvidersFile string // <DataDir>/providers.json
	ProvidersAuth string // <DataDir>/providers/auth.json
	SettingsFile  string // <DataDir>/construct-settings.json
	SkillsDir     string // <DataDir>/skills
}

func nativeBaseDir() string {
	switch runtime.GOOS {
	case "darwin":
		home, _ := os.UserHomeDir()
		return filepath.Join(home, "Library", "Application Support", "Construct")
	case "windows":
		if appdata := os.Getenv("APPDATA"); appdata != "" {
			return filepath.Join(appdata, "Construct")
		}
		home, _ := os.UserHomeDir()
		return filepath.Join(home, "AppData", "Roaming", "Construct")
	default:
		if xdg := os.Getenv("XDG_DATA_HOME"); xdg != "" {
			return filepath.Join(xdg, "Construct")
		}
		home, _ := os.UserHomeDir()
		return filepath.Join(home, ".local", "share", "Construct")
	}
}

// Resolve returns brain's storage layout. DataDir is always a profile
// directory; brain never writes to the base data dir.
//
// Resolution order:
//  1. CONSTRUCT_DATA_DIR set → use as DataDir (the desktop shell points
//     this at the active profile dir).
//  2. Otherwise → resolve base, ensure profiles.json + active profile
//     (auto-create Default on fresh install), DataDir = <base>/profiles/<activeID>.
func Resolve() (Paths, error) {
	var dataDir, baseDir string

	if env := os.Getenv("CONSTRUCT_DATA_DIR"); env != "" {
		dataDir = env
		// Derive base if env points inside a profiles tree, otherwise
		// treat the env as both base and data — brain only writes inside
		// DataDir, so this only matters for ProfilesDir lookups.
		sep := string(filepath.Separator)
		if i := strings.LastIndex(env, sep+"profiles"+sep); i > 0 {
			baseDir = env[:i]
		} else {
			baseDir = env
		}
	} else {
		baseDir = nativeBaseDir()
		profileID, err := ensureActiveProfile(baseDir)
		if err != nil {
			return Paths{}, err
		}
		dataDir = filepath.Join(baseDir, "profiles", profileID)
	}

	p := Paths{
		DataDir:       dataDir,
		BaseDir:       baseDir,
		BrainDir:      filepath.Join(dataDir, "brain"),
		SessionsDir:   filepath.Join(dataDir, "brain", "sessions"),
		StateDir:      filepath.Join(dataDir, "brain", "state"),
		LogsDir:       filepath.Join(dataDir, "brain", "logs"),
		AuthFile:      filepath.Join(dataDir, "auth.json"),
		ProvidersFile: filepath.Join(dataDir, "providers.json"),
		ProvidersAuth: filepath.Join(dataDir, "providers", "auth.json"),
		SettingsFile:  filepath.Join(dataDir, "construct-settings.json"),
		SkillsDir:     filepath.Join(dataDir, "skills"),
	}
	for _, d := range []string{p.BrainDir, p.SessionsDir, p.StateDir, p.LogsDir} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			return p, err
		}
	}
	return p, nil
}

// ── Profile registry (mirrors desktop/src/config.rs ProfileRegistry) ──

type profileEntry struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email,omitempty"`
}

type profileRegistry struct {
	Version       int            `json:"version"`
	ActiveProfile string         `json:"active_profile"`
	Profiles      []profileEntry `json:"profiles"`
}

func registryPath(base string) string {
	return filepath.Join(base, "profiles.json")
}

// ensureActiveProfile reads/creates profiles.json and returns the active
// profile ID. Mirrors the Rust `ensure_profile_registry` so brain and the
// desktop shell agree on layout when brain runs standalone.
func ensureActiveProfile(base string) (string, error) {
	if err := os.MkdirAll(filepath.Join(base, "profiles"), 0o755); err != nil {
		return "", fmt.Errorf("create profiles dir: %w", err)
	}

	if data, err := os.ReadFile(registryPath(base)); err == nil {
		var reg profileRegistry
		if jsonErr := json.Unmarshal(data, &reg); jsonErr == nil && len(reg.Profiles) > 0 {
			changed := false
			if reg.ActiveProfile == "" || !hasProfile(reg, reg.ActiveProfile) {
				reg.ActiveProfile = reg.Profiles[0].ID
				changed = true
			}
			activeDir := filepath.Join(base, "profiles", reg.ActiveProfile)
			_ = os.MkdirAll(activeDir, 0o755)
			// Sweep leftover root-level legacy files into the active
			// profile. Runs on every boot until root is clean.
			migrateLegacyRootInto(base, activeDir)
			if changed {
				_ = writeRegistry(base, &reg)
			}
			return reg.ActiveProfile, nil
		}
	}

	// No usable registry: create a new profile and absorb any legacy
	// root-level files into it. The profile ID will be swapped to the
	// accounts UUID on first login.
	id, err := newProfileID()
	if err != nil {
		return "", err
	}
	profileDir := filepath.Join(base, "profiles", id)
	if err := os.MkdirAll(profileDir, 0o755); err != nil {
		return "", err
	}
	migrateLegacyRootInto(base, profileDir)
	reg := profileRegistry{
		Version:       1,
		ActiveProfile: id,
		Profiles:      []profileEntry{{ID: id, Name: "Default"}},
	}
	if err := writeRegistry(base, &reg); err != nil {
		return "", err
	}
	return id, nil
}

func migrateLegacyRootInto(base, profileDir string) {
	for _, name := range legacyRootFiles {
		_ = moveIfExists(filepath.Join(base, name), filepath.Join(profileDir, name))
	}
}

func hasProfile(reg profileRegistry, id string) bool {
	for _, p := range reg.Profiles {
		if p.ID == id {
			return true
		}
	}
	return false
}

func writeRegistry(base string, reg *profileRegistry) error {
	data, err := json.MarshalIndent(reg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(registryPath(base), data, 0o644)
}

// legacyRootFiles is the set of names that older builds wrote to the
// base data dir and that belong inside a profile. Kept in sync with
// desktop/src/config.rs.
var legacyRootFiles = []string{
	"auth.json", "credentials.json", "providers", "providers.json",
	"sessions", "chat-sessions", "memory", "state", "coder", "insights",
	"teams", "spaces", "skills", "hooks.json", "mcp.json", "permission_mode",
	"context.db", "session-memories", "construct-settings.json",
	"bin", "logs", "brain",
	"telemetry.db", "telemetry.db-shm", "telemetry.db-wal",
}

func moveIfExists(src, dst string) error {
	if _, err := os.Stat(src); err != nil {
		return nil
	}
	if _, err := os.Stat(dst); err == nil {
		return nil
	}
	return os.Rename(src, dst)
}

// newProfileID returns a UUID v4 string matching the format the Rust
// layer emits, so brain-created and desktop-created IDs share a shape.
func newProfileID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf(
		"%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
		b[0], b[1], b[2], b[3],
		b[4], b[5],
		b[6], b[7],
		b[8], b[9],
		b[10], b[11], b[12], b[13], b[14], b[15],
	), nil
}
