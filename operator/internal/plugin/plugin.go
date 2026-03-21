// Package plugin provides a third-party plugin system.
// Plugins are external executables that communicate via stdin/stdout JSON-RPC,
// following the same pattern as MCP servers.
package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sync"

	"construct-operator/internal/hook"
	"construct-operator/internal/provider"
	"construct-operator/internal/tool"
)

// PluginType describes the kind of plugin.
type PluginType string

const (
	TypeTool     PluginType = "tool"
	TypeProvider PluginType = "provider"
	TypeHook     PluginType = "hook"
)

// PluginManifest describes a plugin loaded from plugin.json.
type PluginManifest struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	Version    string     `json:"version"`
	Type       PluginType `json:"type"`
	EntryPoint string     `json:"entry_point"`

	// Optional fields
	Description string            `json:"description,omitempty"`
	Tools       []PluginToolDef   `json:"tools,omitempty"`  // For type=tool
	Hooks       []PluginHookDef   `json:"hooks,omitempty"`  // For type=hook
	Config      map[string]string `json:"config,omitempty"` // Plugin-specific configuration
}

// PluginToolDef describes a tool provided by a plugin.
type PluginToolDef struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	InputSchema any    `json:"input_schema"`
}

// PluginHookDef describes a hook provided by a plugin.
type PluginHookDef struct {
	ID       string    `json:"id"`
	Type     hook.Type `json:"type"`
	Tools    []string  `json:"tools,omitempty"`
	Patterns []string  `json:"patterns,omitempty"`
}

// Manager manages loaded plugins.
type Manager struct {
	mu      sync.RWMutex
	plugins map[string]*PluginManifest
}

// NewManager creates a new plugin manager.
func NewManager() *Manager {
	return &Manager{
		plugins: make(map[string]*PluginManifest),
	}
}

// LoadManifest reads a plugin.json manifest from the given path.
func LoadManifest(path string) (*PluginManifest, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read manifest %s: %w", path, err)
	}

	var manifest PluginManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return nil, fmt.Errorf("parse manifest %s: %w", path, err)
	}

	if manifest.ID == "" {
		return nil, fmt.Errorf("manifest %s: missing required field 'id'", path)
	}
	if manifest.Name == "" {
		return nil, fmt.Errorf("manifest %s: missing required field 'name'", path)
	}
	if manifest.Version == "" {
		return nil, fmt.Errorf("manifest %s: missing required field 'version'", path)
	}
	if manifest.Type == "" {
		return nil, fmt.Errorf("manifest %s: missing required field 'type'", path)
	}
	if manifest.EntryPoint == "" {
		return nil, fmt.Errorf("manifest %s: missing required field 'entry_point'", path)
	}

	return &manifest, nil
}

// ScanDir finds all plugins in a directory by looking for plugin.json files
// in immediate subdirectories.
func ScanDir(dir string) ([]*PluginManifest, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("scan plugin dir %s: %w", dir, err)
	}

	var manifests []*PluginManifest
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		manifestPath := filepath.Join(dir, entry.Name(), "plugin.json")
		if _, err := os.Stat(manifestPath); err != nil {
			continue // No plugin.json in this subdirectory
		}

		manifest, err := LoadManifest(manifestPath)
		if err != nil {
			// Log but don't fail on individual bad manifests
			fmt.Fprintf(os.Stderr, "[plugin] skipping %s: %v\n", entry.Name(), err)
			continue
		}

		// Resolve entry point relative to plugin directory
		if !filepath.IsAbs(manifest.EntryPoint) {
			manifest.EntryPoint = filepath.Join(dir, entry.Name(), manifest.EntryPoint)
		}

		manifests = append(manifests, manifest)
	}

	return manifests, nil
}

// RegisterPlugin adds a plugin to the manager and registers its tools/hooks
// into the provided registries.
func (m *Manager) RegisterPlugin(manifest *PluginManifest, toolReg *tool.Registry, hookReg *hook.Registry) error {
	if manifest == nil {
		return fmt.Errorf("nil manifest")
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	if _, exists := m.plugins[manifest.ID]; exists {
		return fmt.Errorf("plugin %q already registered", manifest.ID)
	}

	// Register tools if this is a tool plugin
	// Namespace tool names as {plugin.id}:{tool.name} to avoid conflicts
	if manifest.Type == TypeTool && toolReg != nil {
		for _, td := range manifest.Tools {
			toolReg.Register(&tool.Tool{
				Def: provider.ToolDef{
					Name:        manifest.ID + ":" + td.Name,
					Description: td.Description,
					InputSchema: td.InputSchema,
				},
				Executor: &pluginExecutor{
					entryPoint: manifest.EntryPoint,
					pluginID:   manifest.ID,
					toolName:   td.Name,
				},
				Source: "plugin:" + manifest.ID,
			})
		}
	}

	// Register hooks if this is a hook plugin
	// Hook plugins use JSON-RPC via the HOOK_RPC_REQUEST env var.
	// The hook registry serializes the JSON-RPC payload in Go (safe for all
	// inputs) and sets it as an env var. The command just pipes it to the
	// entry point. This avoids shell quoting issues and works on all platforms.
	if manifest.Type == TypeHook && hookReg != nil {
		for _, hd := range manifest.Hooks {
			hookReg.Register(hook.Hook{
				ID:       manifest.ID + ":" + hd.ID,
				Type:     hd.Type,
				Tools:    hd.Tools,
				Patterns: hd.Patterns,
				Command:  fmt.Sprintf(`printf '%%s' "$HOOK_RPC_REQUEST" | %s`, manifest.EntryPoint),
				RpcHookID: hd.ID,
				Source:   "plugin:" + manifest.ID,
			})
		}
	}

	m.plugins[manifest.ID] = manifest
	return nil
}

// Get returns a loaded plugin by ID.
func (m *Manager) Get(id string) (*PluginManifest, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	p, ok := m.plugins[id]
	return p, ok
}

// List returns all loaded plugins.
func (m *Manager) List() []*PluginManifest {
	m.mu.RLock()
	defer m.mu.RUnlock()

	result := make([]*PluginManifest, 0, len(m.plugins))
	for _, p := range m.plugins {
		result = append(result, p)
	}
	return result
}

// pluginExecutor invokes a plugin's entry point via stdin/stdout JSON-RPC.
type pluginExecutor struct {
	entryPoint string
	pluginID   string
	toolName   string
}

// jsonRPCRequest is a JSON-RPC 2.0 request sent to the plugin process.
type jsonRPCRequest struct {
	JSONRPC string `json:"jsonrpc"`
	Method  string `json:"method"`
	Params  any    `json:"params"`
	ID      int    `json:"id"`
}

// jsonRPCResponse is a JSON-RPC 2.0 response from the plugin process.
type jsonRPCResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *jsonRPCError   `json:"error,omitempty"`
	ID      int             `json:"id"`
}

type jsonRPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (e *pluginExecutor) Execute(ctx context.Context, input string) (*tool.Result, error) {
	rpcReq := jsonRPCRequest{
		JSONRPC: "2.0",
		Method:  e.toolName,
		Params:  json.RawMessage(input),
		ID:      1,
	}
	reqData, err := json.Marshal(rpcReq)
	if err != nil {
		return nil, fmt.Errorf("marshal rpc request: %w", err)
	}

	cmd := exec.CommandContext(ctx, e.entryPoint)
	cmd.Stdin = bytes.NewReader(reqData)

	output, err := cmd.Output()
	if err != nil {
		return &tool.Result{
			Content: fmt.Sprintf("plugin %s execution failed: %v", e.pluginID, err),
			IsError: true,
		}, nil
	}

	var rpcResp jsonRPCResponse
	if err := json.Unmarshal(output, &rpcResp); err != nil {
		// If the output isn't valid JSON-RPC, return it as plain text
		return &tool.Result{Content: string(output)}, nil
	}

	if rpcResp.Error != nil {
		return &tool.Result{
			Content: rpcResp.Error.Message,
			IsError: true,
		}, nil
	}

	return &tool.Result{Content: string(rpcResp.Result)}, nil
}
