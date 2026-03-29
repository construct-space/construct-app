package mcp

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"construct-operator/internal/provider"
)

// ServerType is how the MCP server is connected.
type ServerType string

const (
	TypeStdio ServerType = "stdio" // Local process via stdin/stdout
	TypeHTTP  ServerType = "http"  // HTTP+SSE transport
	TypeURL   ServerType = "url"   // Streamable HTTP (new spec)
)

// ServerConfig describes an MCP server to connect to.
type ServerConfig struct {
	ID        string            `json:"id"`
	Name      string            `json:"name"`
	Type      ServerType        `json:"type"`
	Command   string            `json:"command,omitempty"` // For stdio
	Args      []string          `json:"args,omitempty"`    // For stdio
	URL       string            `json:"url,omitempty"`     // For http/url
	Env       map[string]string `json:"env,omitempty"`     // Environment vars
	Enabled   bool              `json:"enabled"`
	Kind      string            `json:"kind,omitempty"`      // url, npm, local, builtin
	Package   string            `json:"package,omitempty"`   // npm package name
	Path      string            `json:"path,omitempty"`      // local executable path
	Transport string            `json:"transport,omitempty"` // ui-facing transport: http, sse, stdio
	Source    string            `json:"-"`                   // user or space:<id>
}

// ServerInfo is the runtime state of a connected MCP server.
type ServerInfo struct {
	Config ServerConfig       `json:"config"`
	Status string             `json:"status"` // disconnected, connecting, running, error
	Tools  []provider.ToolDef `json:"tools,omitempty"`
	Error  string             `json:"error,omitempty"`
	conn   mcpConn            // transport connection (stdio or HTTP)
}

// MCPConfig is the format of mcp.json files.
type MCPConfig struct {
	Servers map[string]rawServerConfig `json:"mcpServers"`
}

type rawServerConfig struct {
	ID        string            `json:"id"`
	Name      string            `json:"name"`
	Type      ServerType        `json:"type"`
	Command   string            `json:"command,omitempty"`
	Args      []string          `json:"args,omitempty"`
	URL       string            `json:"url,omitempty"`
	Env       map[string]string `json:"env,omitempty"`
	Enabled   *bool             `json:"enabled,omitempty"`
	Kind      string            `json:"kind,omitempty"`
	Package   string            `json:"package,omitempty"`
	Path      string            `json:"path,omitempty"`
	Transport string            `json:"transport,omitempty"`
}

// LoadConfig reads an mcp.json file and returns server configs.
func LoadConfig(path string) ([]ServerConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	var cfg MCPConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}

	var configs []ServerConfig
	for id, sc := range cfg.Servers {
		enabled := true
		if sc.Enabled != nil {
			enabled = *sc.Enabled
		}
		configs = append(configs, normalizeConfig(ServerConfig{
			ID:        firstNonEmpty(sc.ID, id),
			Name:      firstNonEmpty(sc.Name, id),
			Type:      sc.Type,
			Command:   sc.Command,
			Args:      sc.Args,
			URL:       sc.URL,
			Env:       sc.Env,
			Enabled:   enabled,
			Kind:      sc.Kind,
			Package:   sc.Package,
			Path:      sc.Path,
			Transport: sc.Transport,
		}))
	}
	sort.Slice(configs, func(i, j int) bool { return configs[i].ID < configs[j].ID })
	return configs, nil
}

// SaveConfig writes user-managed MCP servers back to mcp.json.
func SaveConfig(path string, configs []ServerConfig) error {
	if path == "" {
		return fmt.Errorf("path is required")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}

	cfg := MCPConfig{Servers: make(map[string]rawServerConfig, len(configs))}
	sort.Slice(configs, func(i, j int) bool { return configs[i].ID < configs[j].ID })
	for _, sc := range configs {
		sc = normalizeConfig(sc)
		enabled := sc.Enabled
		cfg.Servers[sc.ID] = rawServerConfig{
			ID:        sc.ID,
			Name:      sc.Name,
			Type:      sc.Type,
			Command:   sc.Command,
			Args:      sc.Args,
			URL:       sc.URL,
			Env:       sc.Env,
			Enabled:   &enabled,
			Kind:      sc.Kind,
			Package:   sc.Package,
			Path:      sc.Path,
			Transport: sc.Transport,
		}
	}

	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// LoadAllConfigs loads MCP configs from all space directories and user config.
// spacesDirs should include all directories from appdir.AllSpacesDirs() so that
// spaces provided via CONSTRUCT_SPACES_PATH are not silently ignored.
func LoadAllConfigs(spacesDirs []string, userConfigDir string) []ServerConfig {
	var all []ServerConfig

	// Load from all space directories
	for _, spacesDir := range spacesDirs {
		if entries, err := os.ReadDir(spacesDir); err == nil {
			for _, e := range entries {
				if !e.IsDir() {
					continue
				}
				cfgPath := filepath.Join(spacesDir, e.Name(), "mcp.json")
				if configs, err := LoadConfig(cfgPath); err == nil {
					for i := range configs {
						configs[i].Source = "space:" + e.Name()
						configs[i] = normalizeConfig(configs[i])
					}
					all = append(all, configs...)
				}
			}
		}
	}

	// Load from user config
	if userConfigDir != "" {
		cfgPath := filepath.Join(userConfigDir, "mcp.json")
		if configs, err := LoadConfig(cfgPath); err == nil {
			for i := range configs {
				configs[i].Source = "user"
				configs[i] = normalizeConfig(configs[i])
			}
			all = append(all, configs...)
		}
	}

	sort.Slice(all, func(i, j int) bool { return all[i].ID < all[j].ID })
	return all
}

func normalizeConfig(cfg ServerConfig) ServerConfig {
	if cfg.ID != "" && cfg.Name == "" {
		cfg.Name = cfg.ID
	}
	if cfg.Kind == "" {
		switch {
		case cfg.Package != "":
			cfg.Kind = "npm"
		case cfg.Path != "":
			cfg.Kind = "local"
		case cfg.URL != "":
			cfg.Kind = "url"
		case cfg.Source != "" && cfg.Source != "user":
			cfg.Kind = "builtin"
		case strings.EqualFold(filepath.Base(cfg.Command), "npx"):
			cfg.Kind = "npm"
		case cfg.Command != "":
			cfg.Kind = "local"
		}
	}
	if cfg.Package == "" && cfg.Kind == "npm" {
		for i := len(cfg.Args) - 1; i >= 0; i-- {
			arg := strings.TrimSpace(cfg.Args[i])
			if arg == "" || strings.HasPrefix(arg, "-") {
				continue
			}
			cfg.Package = arg
			break
		}
	}
	if cfg.Path == "" && cfg.Kind == "local" {
		cfg.Path = cfg.Command
	}
	if cfg.Transport == "" {
		switch cfg.Type {
		case TypeHTTP:
			cfg.Transport = "sse"
		case TypeURL:
			cfg.Transport = "http"
		default:
			cfg.Transport = "stdio"
		}
	}
	if cfg.Type == "" {
		switch cfg.Transport {
		case "http":
			cfg.Type = TypeURL
		case "sse":
			cfg.Type = TypeHTTP
		default:
			cfg.Type = TypeStdio
		}
	}
	return cfg
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
