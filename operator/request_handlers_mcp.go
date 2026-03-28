package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"construct-operator/internal/mcp"
	"construct-operator/internal/state"
	"construct-operator/internal/transport"
)

func isMCPRequestType(reqType string) bool {
	return strings.HasPrefix(reqType, "mcp.")
}

func (rt *operatorRuntime) handleMCPRequest(reqCtx context.Context, req transport.Request) (transport.Response, bool) {
	switch req.Type {
	case "mcp.list":
		servers := rt.listMCPServers()
		return transport.Response{
			ID: req.ID, Success: true,
			Data: map[string]any{"servers": servers, "count": len(servers)},
		}, true

	case "mcp.enable":
		var payload struct {
			ID string `json:"id"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		info, ok := rt.mcp.Get(payload.ID)
		if !ok {
			return transport.Response{ID: req.ID, Success: false, Error: "mcp server not found"}, true
		}
		info.Config.Enabled = true
		rt.mcp.Add(info.Config)
		if err := rt.stateStore.SetMCPState(state.MCPRuntimeState{ID: payload.ID, Enabled: true}); err != nil {
			return transport.Response{ID: req.ID, Success: false, Error: err.Error()}, true
		}
		if info.Config.Source == "user" {
			if err := rt.persistUserMCPConfigs(rt.userMCPConfigPath); err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}, true
			}
		}
		rt.connectMCPServerInBackground(payload.ID)
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true, "status": "connecting"}}, true

	case "mcp.disable":
		var payload struct {
			ID string `json:"id"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		info, ok := rt.mcp.Get(payload.ID)
		if !ok {
			return transport.Response{ID: req.ID, Success: false, Error: "mcp server not found"}, true
		}
		rt.tools.RemoveBySource("mcp:" + payload.ID)
		rt.mcp.Disconnect(payload.ID)
		info.Config.Enabled = false
		rt.mcp.Add(info.Config)
		if err := rt.stateStore.SetMCPState(state.MCPRuntimeState{ID: payload.ID, Enabled: false}); err != nil {
			return transport.Response{ID: req.ID, Success: false, Error: err.Error()}, true
		}
		if info.Config.Source == "user" {
			if err := rt.persistUserMCPConfigs(rt.userMCPConfigPath); err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}, true
			}
		}
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}, true

	case "mcp.add":
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
		cfg := mcp.ServerConfig{
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
				return transport.Response{ID: req.ID, Success: false, Error: "url is required"}, true
			}
			if cfg.Transport == "" {
				cfg.Transport = "http"
			}
			if cfg.Name == "" {
				cfg.Name = cfg.URL
			}
		case "npm":
			if cfg.Package == "" {
				return transport.Response{ID: req.ID, Success: false, Error: "package is required"}, true
			}
			cfg.Command = "npx"
			cfg.Args = []string{"-y", cfg.Package}
			cfg.Transport = "stdio"
			if cfg.Name == "" {
				cfg.Name = cfg.Package
			}
		case "local":
			if cfg.Path == "" {
				return transport.Response{ID: req.ID, Success: false, Error: "path is required"}, true
			}
			cfg.Command = cfg.Path
			cfg.Transport = "stdio"
			if cfg.Name == "" {
				cfg.Name = filepath.Base(cfg.Path)
			}
		default:
			return transport.Response{ID: req.ID, Success: false, Error: "unsupported mcp server type"}, true
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
			if _, exists := rt.mcp.Get(cfg.ID); !exists {
				break
			}
			cfg.ID = fmt.Sprintf("%s-%d", idBase, i)
		}
		rt.mcp.Add(cfg)
		if err := rt.stateStore.SetMCPState(state.MCPRuntimeState{ID: cfg.ID, Enabled: true}); err != nil {
			return transport.Response{ID: req.ID, Success: false, Error: err.Error()}, true
		}
		if err := rt.persistUserMCPConfigs(rt.userMCPConfigPath); err != nil {
			return transport.Response{ID: req.ID, Success: false, Error: err.Error()}, true
		}
		rt.connectMCPServerInBackground(cfg.ID)
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"id": cfg.ID, "status": "connecting"}}, true

	case "mcp.remove":
		var payload struct {
			ID string `json:"id"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		info, ok := rt.mcp.Get(payload.ID)
		if !ok {
			return transport.Response{ID: req.ID, Success: false, Error: "mcp server not found"}, true
		}
		if info.Config.Source != "user" {
			return transport.Response{ID: req.ID, Success: false, Error: "only user-managed MCP servers can be removed"}, true
		}
		rt.tools.RemoveBySource("mcp:" + payload.ID)
		rt.mcp.Remove(payload.ID)
		if err := rt.stateStore.DeleteMCPState(payload.ID); err != nil {
			return transport.Response{ID: req.ID, Success: false, Error: err.Error()}, true
		}
		if err := rt.persistUserMCPConfigs(rt.userMCPConfigPath); err != nil {
			return transport.Response{ID: req.ID, Success: false, Error: err.Error()}, true
		}
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}, true

	case "mcp.test":
		var payload struct {
			ID string `json:"id"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		info, ok := rt.mcp.Get(payload.ID)
		if !ok {
			return transport.Response{ID: req.ID, Success: false, Error: "mcp server not found"}, true
		}
		if info.Status != "running" {
			if err := rt.mcp.Connect(reqCtx, payload.ID); err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}, true
			}
			rt.mcp.Disconnect(payload.ID)
			rt.mcp.Add(info.Config)
		}
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}, true

	default:
		return transport.Response{}, false
	}
}

func (rt *operatorRuntime) connectMCPServerInBackground(serverID string) {
	go func() {
		connectCtx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		if err := rt.mcp.Connect(connectCtx, serverID); err != nil {
			fmt.Fprintf(os.Stderr, "[mcp] background connect %s failed: %v\n", serverID, err)
			return
		}
		rt.registerMCPServerTools(serverID)
		fmt.Fprintf(os.Stderr, "[mcp] %s connected and tools registered\n", serverID)
	}()
}
