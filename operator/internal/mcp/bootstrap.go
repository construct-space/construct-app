package mcp

import (
	"context"
	"fmt"
	"os"
	"time"

	"construct-operator/internal/state"
	"construct-operator/internal/tool"
)

// Bootstrap loads MCP configs, restores enabled states, and connects in background.
// Returns a ready-to-use *Client with all servers registered.
func Bootstrap(spaceDirs []string, appDir string, stateStore *state.Store, tools *tool.Registry) *Client {
	configs := LoadAllConfigs(spaceDirs, appDir)
	configs = restoreMCPEnabledStates(configs, stateStore.MCPStates())

	client := NewClient()
	for _, cfg := range configs {
		client.Add(cfg)
	}
	connectEnabledMCPServersInBackground(client, tools, configs)
	fmt.Fprintf(os.Stderr, "[operator] mcp configs: %d servers found (connecting in background)\n", len(configs))
	return client
}

func restoreMCPEnabledStates(configs []ServerConfig, states map[string]state.MCPRuntimeState) []ServerConfig {
	restored := append([]ServerConfig(nil), configs...)
	for id, saved := range states {
		for i := range restored {
			if restored[i].ID == id {
				restored[i].Enabled = saved.Enabled
			}
		}
	}
	return restored
}

func connectEnabledMCPServersInBackground(client *Client, registry *tool.Registry, configs []ServerConfig) {
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
				registry.RemoveBySource("mcp:" + cfg.ID)
				client.RegisterServerTools(registry, cfg.ID)
			}
			cancel()
		}
	}()
}
