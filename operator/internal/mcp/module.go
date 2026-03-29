package mcp

import (
	"construct-operator/internal/module"
	"construct-operator/internal/state"
	"construct-operator/internal/tool"
)

// MCPModule is the self-contained module for MCP server management.
type MCPModule struct {
	module.DefaultModule
	client     *Client
	tools      *tool.Registry
	stateStore *state.Store
	configPath string
}

// NewModule creates the MCP module from shared dependencies.
func NewModule(deps module.Dependencies) module.Module {
	var client *Client
	if c, ok := deps.MCP.(*Client); ok {
		client = c
	}
	var tools *tool.Registry
	if t, ok := deps.Tools.(*tool.Registry); ok {
		tools = t
	}
	var ss *state.Store
	if s, ok := deps.StateStore.(*state.Store); ok {
		ss = s
	}
	return &MCPModule{
		client:     client,
		tools:      tools,
		stateStore: ss,
		configPath: deps.UserMCPConfigPath,
	}
}

func (m *MCPModule) ID() string { return "mcp" }

func (m *MCPModule) Routes(r *module.Router) {
	r.Handle("mcp.list", m.handleList)
	r.Handle("mcp.enable", m.handleEnable)
	r.Handle("mcp.disable", m.handleDisable)
	r.Handle("mcp.add", m.handleAdd)
	r.Handle("mcp.remove", m.handleRemove)
	r.Handle("mcp.test", m.handleTest)
}
