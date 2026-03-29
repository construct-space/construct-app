package skill

import (
	"construct-operator/internal/hook"
	"construct-operator/internal/module"
	"construct-operator/internal/state"
	"construct-operator/internal/tool"
)

// SkillModule is a self-contained module for all skills.* request handling.
type SkillModule struct {
	module.DefaultModule
	registry   *Registry
	hooks      *hook.Registry
	tools      *tool.Registry
	stateStore *state.Store
}

// NewModule creates a skill module from dependencies.
func NewModule(deps module.Dependencies) module.Module {
	var reg *Registry
	if r, ok := deps.Skills.(*Registry); ok {
		reg = r
	}
	var hooks *hook.Registry
	if h, ok := deps.Hooks.(*hook.Registry); ok {
		hooks = h
	}
	var tools *tool.Registry
	if t, ok := deps.Tools.(*tool.Registry); ok {
		tools = t
	}
	var ss *state.Store
	if s, ok := deps.StateStore.(*state.Store); ok {
		ss = s
	}
	return &SkillModule{
		registry:   reg,
		hooks:      hooks,
		tools:      tools,
		stateStore: ss,
	}
}

// ID returns the module identifier.
func (m *SkillModule) ID() string { return "skills" }

// Routes registers all skills.* request handlers.
func (m *SkillModule) Routes(r *module.Router) {
	r.Handle("skills.list", m.handleList)
	r.Handle("skills.get", m.handleGet)
	r.Handle("skills.load", m.handleLoad)
	r.Handle("skills.unload", m.handleUnload)
	r.Handle("skills.enable", m.handleEnable)
	r.Handle("skills.disable", m.handleDisable)
	r.Handle("skills.load_builtins", m.handleLoadBuiltins)
	r.Handle("skills.metrics", m.handleMetrics)
	r.Handle("skills.summaries", m.handleSummaries)
	r.Handle("skills.content", m.handleContent)
	r.Handle("skills.search", m.handleSearch)
	r.Handle("skills.instructions", m.handleInstructions)
	r.Handle("skills.format_for_ai", m.handleFormatForAI)
}
