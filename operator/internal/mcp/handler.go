package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"construct-operator/internal/state"
	"construct-operator/internal/transport"
)

func (m *MCPModule) handleList(_ context.Context, req transport.Request) transport.Response {
	servers := m.listMCPServers()
	return transport.Response{
		ID: req.ID, Success: true,
		Data: map[string]any{"servers": servers, "count": len(servers)},
	}
}

func (m *MCPModule) handleEnable(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		ID string `json:"id"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	info, ok := m.client.Get(payload.ID)
	if !ok {
		return transport.Response{ID: req.ID, Success: false, Error: "mcp server not found"}
	}
	info.Config.Enabled = true
	m.client.Add(info.Config)
	if err := m.stateStore.SetMCPState(state.MCPRuntimeState{ID: payload.ID, Enabled: true}); err != nil {
		return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
	}
	if info.Config.Source == "user" {
		if err := m.persistUserMCPConfigs(m.configPath); err != nil {
			return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
		}
	}
	m.connectMCPServerInBackground(payload.ID)
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true, "status": "connecting"}}
}

func (m *MCPModule) handleDisable(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		ID string `json:"id"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	info, ok := m.client.Get(payload.ID)
	if !ok {
		return transport.Response{ID: req.ID, Success: false, Error: "mcp server not found"}
	}
	m.tools.RemoveBySource("mcp:" + payload.ID)
	m.client.Disconnect(payload.ID)
	info.Config.Enabled = false
	m.client.Add(info.Config)
	if err := m.stateStore.SetMCPState(state.MCPRuntimeState{ID: payload.ID, Enabled: false}); err != nil {
		return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
	}
	if info.Config.Source == "user" {
		if err := m.persistUserMCPConfigs(m.configPath); err != nil {
			return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
		}
	}
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}
}

func (m *MCPModule) handleAdd(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		Type      string `json:"type"`
		Name      string `json:"name"`
		URL       string `json:"url"`
		Transport string `json:"transport"`
		Package   string `json:"package"`
		Path      string `json:"path"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	cfg := ServerConfig{
		Name:      strings.TrimSpace(payload.Name),
		Kind:      strings.TrimSpace(payload.Type),
		Package:   strings.TrimSpace(payload.Package),
		Path:      strings.TrimSpace(payload.Path),
		URL:       strings.TrimSpace(payload.URL),
		Transport: strings.TrimSpace(payload.Transport),
		Enabled:   true,
		Source:    "user",
	}
	switch cfg.Kind {
	case "url":
		if cfg.URL == "" {
			return transport.Response{ID: req.ID, Success: false, Error: "url is required"}
		}
		if cfg.Transport == "" {
			cfg.Transport = "http"
		}
		if cfg.Name == "" {
			cfg.Name = cfg.URL
		}
	case "npm":
		if cfg.Package == "" {
			return transport.Response{ID: req.ID, Success: false, Error: "package is required"}
		}
		cfg.Command = "npx"
		cfg.Args = []string{"-y", cfg.Package}
		cfg.Transport = "stdio"
		if cfg.Name == "" {
			cfg.Name = cfg.Package
		}
	case "local":
		if cfg.Path == "" {
			return transport.Response{ID: req.ID, Success: false, Error: "path is required"}
		}
		cfg.Command = cfg.Path
		cfg.Transport = "stdio"
		if cfg.Name == "" {
			cfg.Name = filepath.Base(cfg.Path)
		}
	default:
		return transport.Response{ID: req.ID, Success: false, Error: "unsupported mcp server type"}
	}
	idBase := strings.ToLower(cfg.Name)
	idBase = strings.ReplaceAll(idBase, " ", "-")
	idBase = strings.ReplaceAll(idBase, "/", "-")
	idBase = strings.Trim(idBase, "-")
	if idBase == "" {
		idBase = "mcp-server"
	}
	cfg.ID = idBase
	for i := 2; ; i++ {
		if _, exists := m.client.Get(cfg.ID); !exists {
			break
		}
		cfg.ID = fmt.Sprintf("%s-%d", idBase, i)
	}
	m.client.Add(cfg)
	if err := m.stateStore.SetMCPState(state.MCPRuntimeState{ID: cfg.ID, Enabled: true}); err != nil {
		return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
	}
	if err := m.persistUserMCPConfigs(m.configPath); err != nil {
		return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
	}
	m.connectMCPServerInBackground(cfg.ID)
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"id": cfg.ID, "status": "connecting"}}
}

func (m *MCPModule) handleRemove(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		ID string `json:"id"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	info, ok := m.client.Get(payload.ID)
	if !ok {
		return transport.Response{ID: req.ID, Success: false, Error: "mcp server not found"}
	}
	if info.Config.Source != "user" {
		return transport.Response{ID: req.ID, Success: false, Error: "only user-managed MCP servers can be removed"}
	}
	m.tools.RemoveBySource("mcp:" + payload.ID)
	m.client.Remove(payload.ID)
	if err := m.stateStore.DeleteMCPState(payload.ID); err != nil {
		return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
	}
	if err := m.persistUserMCPConfigs(m.configPath); err != nil {
		return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
	}
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}
}

func (m *MCPModule) handleTest(ctx context.Context, req transport.Request) transport.Response {
	var payload struct {
		ID string `json:"id"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	info, ok := m.client.Get(payload.ID)
	if !ok {
		return transport.Response{ID: req.ID, Success: false, Error: "mcp server not found"}
	}
	if info.Status != "running" {
		if err := m.client.Connect(ctx, payload.ID); err != nil {
			return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
		}
		m.client.Disconnect(payload.ID)
		m.client.Add(info.Config)
	}
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}
}

// ---------------------------------------------------------------------------
// Helper functions used only by MCP handlers
// ---------------------------------------------------------------------------

func (m *MCPModule) connectMCPServerInBackground(serverID string) {
	go func() {
		connectCtx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		if err := m.client.Connect(connectCtx, serverID); err != nil {
			fmt.Fprintf(os.Stderr, "[mcp] background connect %s failed: %v\n", serverID, err)
			return
		}
		m.registerMCPServerTools(serverID)
		fmt.Fprintf(os.Stderr, "[mcp] %s connected and tools registered\n", serverID)
	}()
}

func (m *MCPModule) listMCPServers() []map[string]any {
	return listMCPServersFromInfos(m.client.List())
}

func listMCPServersFromInfos(infos []ServerInfo) []map[string]any {
	servers := make([]map[string]any, 0, len(infos))
	for _, info := range infos {
		status := "stopped"
		switch info.Status {
		case "running":
			status = "running"
		case "error":
			status = "error"
		}
		toolsList := make([]map[string]any, 0, len(info.Tools))
		for _, toolDef := range info.Tools {
			toolsList = append(toolsList, map[string]any{
				"name":        toolDef.Name,
				"description": toolDef.Description,
			})
		}
		serverType := info.Config.Kind
		if serverType == "" {
			serverType = "builtin"
		}
		servers = append(servers, map[string]any{
			"id":        info.Config.ID,
			"name":      info.Config.Name,
			"type":      serverType,
			"transport": info.Config.Transport,
			"package":   info.Config.Package,
			"path":      info.Config.Path,
			"url":       info.Config.URL,
			"enabled":   info.Config.Enabled,
			"status":    status,
			"tools":     toolsList,
			"error":     info.Error,
			"source":    info.Config.Source,
		})
	}
	return servers
}

func userMCPConfigs(infos []ServerInfo) []ServerConfig {
	configs := make([]ServerConfig, 0, len(infos))
	for _, info := range infos {
		if info.Config.Source != "user" {
			continue
		}
		configs = append(configs, info.Config)
	}
	return configs
}

func (m *MCPModule) persistUserMCPConfigs(path string) error {
	return SaveConfig(path, userMCPConfigs(m.client.List()))
}

func (m *MCPModule) registerMCPServerTools(serverID string) {
	m.tools.RemoveBySource("mcp:" + serverID)
	m.client.RegisterServerTools(m.tools, serverID)
}
