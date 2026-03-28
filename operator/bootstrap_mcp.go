package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"construct-operator/internal/appdir"
	"construct-operator/internal/mcp"
	"construct-operator/internal/state"
	"construct-operator/internal/tool"
)

func restoreMCPEnabledStates(configs []mcp.ServerConfig, states map[string]state.MCPRuntimeState) []mcp.ServerConfig {
	restored := append([]mcp.ServerConfig(nil), configs...)
	for id, saved := range states {
		for i := range restored {
			if restored[i].ID == id {
				restored[i].Enabled = saved.Enabled
			}
		}
	}
	return restored
}

func connectEnabledMCPServersInBackground(client *mcp.Client, registry *tool.Registry, configs []mcp.ServerConfig) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				fmt.Fprintf(os.Stderr, "[mcp] background connect panic: %v\n", r)
			}
		}()
		for _, cfg := range configs {
			if !cfg.Enabled {
				continue
			}
			connectCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			if err := client.Connect(connectCtx, cfg.ID); err != nil {
				fmt.Fprintf(os.Stderr, "[mcp] %s: %v\n", cfg.ID, err)
			} else {
				fmt.Fprintf(os.Stderr, "[mcp] %s connected, registering tools\n", cfg.ID)
				registerMCPServerTools(registry, client, cfg.ID)
			}
			cancel()
		}
	}()
}

func (rt *operatorRuntime) bootstrapMCP(spaceDirs []string) {
	configs := mcp.LoadAllConfigs(spaceDirs, appdir.Dir)
	configs = restoreMCPEnabledStates(configs, rt.stateStore.MCPStates())

	rt.mcp = mcp.NewClient()
	for _, cfg := range configs {
		rt.mcp.Add(cfg)
	}
	connectEnabledMCPServersInBackground(rt.mcp, rt.tools, configs)
	fmt.Fprintf(os.Stderr, "[operator] mcp configs: %d servers found (connecting in background)\n", len(configs))
}

func listMCPServersFromInfos(infos []mcp.ServerInfo) []map[string]any {
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

func (rt *operatorRuntime) listMCPServers() []map[string]any {
	return listMCPServersFromInfos(rt.mcp.List())
}

func userMCPConfigs(infos []mcp.ServerInfo) []mcp.ServerConfig {
	configs := make([]mcp.ServerConfig, 0, len(infos))
	for _, info := range infos {
		if info.Config.Source != "user" {
			continue
		}
		configs = append(configs, info.Config)
	}
	return configs
}

func persistUserMCPConfigs(path string, infos []mcp.ServerInfo) error {
	return mcp.SaveConfig(path, userMCPConfigs(infos))
}

func (rt *operatorRuntime) persistUserMCPConfigs(path string) error {
	return persistUserMCPConfigs(path, rt.mcp.List())
}

func registerMCPServerTools(registry *tool.Registry, client *mcp.Client, serverID string) {
	registry.RemoveBySource("mcp:" + serverID)
	client.RegisterServerTools(registry, serverID)
}

func (rt *operatorRuntime) registerMCPServerTools(serverID string) {
	registerMCPServerTools(rt.tools, rt.mcp, serverID)
}
