package tool

import (
	"construct-operator/internal/hook"
	"construct-operator/internal/module"
)

// ToolModule is a self-contained module for all tools.* request handling.
type ToolModule struct {
	module.DefaultModule
	registry *Registry
	hooks    *hook.Registry
}

// NewModule creates a tool module from dependencies.
func NewModule(deps module.Dependencies) module.Module {
	var reg *Registry
	if r, ok := deps.Tools.(*Registry); ok {
		reg = r
	}
	var hooks *hook.Registry
	if h, ok := deps.Hooks.(*hook.Registry); ok {
		hooks = h
	}
	return &ToolModule{
		registry: reg,
		hooks:    hooks,
	}
}

// ID returns the module identifier.
func (m *ToolModule) ID() string { return "tools" }

// Routes registers all tool request handlers.
func (m *ToolModule) Routes(r *module.Router) {
	r.Handle("tools.list", m.handleList)
	r.Handle("tools.call", m.handleCall)
	r.Handle("tool.execute", m.handleCall)
}
