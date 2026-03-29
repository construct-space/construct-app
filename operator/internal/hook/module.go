package hook

import (
	"construct-operator/internal/module"
	"construct-operator/internal/state"
)

// HookModule is the self-contained module for hook management.
type HookModule struct {
	module.DefaultModule
	registry   *Registry
	stateStore *state.Store
}

// NewModule creates the hooks module from shared dependencies.
func NewModule(deps module.Dependencies) module.Module {
	var reg *Registry
	if r, ok := deps.Hooks.(*Registry); ok {
		reg = r
	}
	var ss *state.Store
	if s, ok := deps.StateStore.(*state.Store); ok {
		ss = s
	}
	return &HookModule{
		registry:   reg,
		stateStore: ss,
	}
}

func (m *HookModule) ID() string { return "hooks" }

func (m *HookModule) Routes(r *module.Router) {
	r.Handle("hooks.list", m.handleList)
	r.Handle("hooks.by_type", m.handleByType)
	r.Handle("hooks.enable", m.handleEnable)
	r.Handle("hooks.disable", m.handleDisable)
	r.Handle("hooks.metrics", m.handleMetrics)
}
