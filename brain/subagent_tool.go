// Subagent registration. Lives in its own file because the closure has
// to capture skills + hooks + every provider builder, which means it
// can only run AFTER buildToolRegistry + skill loading + hook loading.
// Keeping it here makes that ordering visible.
package main

import (
	"context"
	"fmt"

	"github.com/construct-space/brain/agent"
	"github.com/construct-space/brain/agents"
	"github.com/construct-space/brain/bridge"
	"github.com/construct-space/brain/catalog"
	"github.com/construct-space/brain/hook"
	"github.com/construct-space/brain/identity"
	"github.com/construct-space/brain/paths"
	"github.com/construct-space/brain/provider"
	"github.com/construct-space/brain/skill"
	"github.com/construct-space/brain/state"
	"github.com/construct-space/brain/tool"
)

// subagentDeps groups the references the subagent runner closure pulls
// from main.go's scope. All immutable across the brain process lifetime.
type subagentDeps struct {
	Tools            *tool.Registry
	Skills           []skill.Skill
	Hooks            *hook.Set
	AgentReg         *agents.Registry
	Reg              *catalog.Registry
	AnthropicOAuth   provider.TokenSource
	OpenAICodexOAuth *codexAuth
	OrgKeys          *provider.OrgKeyStore
	StateStore       *state.Store
	Paths            paths.Paths
	Frontend         *bridge.Frontend
	PermissionMemory *permissionMemory
	IdLoader         *identity.Loader
}

// registerSubagentTool builds the dispatch_subagent runner closure and
// registers it as a hidden tool. Hidden because the top-level agent
// discovers it via list_tools when it needs parallel investigation or
// role-switched verification — the rest of the time it stays out of
// the per-turn schema array.
func registerSubagentTool(d *subagentDeps) {
	sa := tool.Subagent{}
	sa.Runner = func(ctx context.Context, in tool.SubagentInput) (string, error) {
		if d.AgentReg == nil {
			return "", fmt.Errorf("agent registry not loaded")
		}
		a, ok := d.AgentReg.Get(in.AgentID)
		if !ok {
			return "", fmt.Errorf("unknown agent: %s", in.AgentID)
		}
		providerSlug := in.Provider
		codexLinked := codexHasCredentials(d.OpenAICodexOAuth)
		if providerSlug == "" {
			providerSlug = inferProviderFromModel(in.Model, d.Reg, codexLinked)
		}
		// Same credential-aware fallback as handlePrompt — subagents
		// must not silently bind to a provider the user can't satisfy.
		if providerSlug == "" || !providerHasCredentials(providerSlug, d.AnthropicOAuth, d.OpenAICodexOAuth, d.OrgKeys, d.Reg, d.StateStore, d.IdLoader) {
			fallback := selectFallbackProvider(d.Reg, d.AnthropicOAuth, d.OpenAICodexOAuth, d.OrgKeys, d.StateStore, d.IdLoader)
			if fallback == "" {
				return "", fmt.Errorf("no AI provider configured for subagent — sign in via Settings → Providers or set an API key")
			}
			providerSlug = fallback
		}
		model := in.Model
		if model == "" {
			if def := d.Reg.DefaultModel(providerSlug); def != "" {
				model = def
			} else {
				model = defaultModel
			}
		}
		prov, err := buildProvider(providerSlug, d.AnthropicOAuth, d.OpenAICodexOAuth, d.OrgKeys, d.Reg, d.StateStore, d.IdLoader)
		if err != nil {
			return "", err
		}
		prov = provider.BuildDebugLogger(prov, d.Paths.LogsDir)
		innerCtx := tool.WithDepth(ctx, in.Depth)
		sub := agent.New(prov, d.Tools).
			WithHooks(d.Hooks).
			WithSummarizer(buildSummarizer(providerSlug, model, d.Reg, d.AnthropicOAuth, d.OpenAICodexOAuth, d.OrgKeys, d.StateStore, d.IdLoader)).
			WithPermissionGate(buildPermissionGate(d.Paths.DataDir, d.Frontend, d.PermissionMemory))
		system := skill.BuildSystemPrompt(a.SystemPrompt, skill.Merge(d.Skills, a.Skills))
		// Match handlePrompt: prepend the current-user block so delegated
		// subagents (Architect, Vibe, Editor, custom space agents) see the
		// same identity context the top-level agent does.
		if block := identity.CurrentUserBlock(d.IdLoader); block != "" {
			system = block + "\n" + system
		}
		var capFlags []string
		if resolved, ok := d.Reg.Lookup(providerSlug, model); ok {
			capFlags = resolved.Caps.Flags
		}
		h := &tool.SilentHandler{}
		sub.Run(innerCtx, agent.Options{
			Model:    model,
			System:   system,
			Prompt:   in.Task,
			CapFlags: capFlags,
		}, h)
		// Surface nested-run failures instead of returning "(no output)"
		// as success — the parent model must know the delegated task
		// died, not conclude the investigation found nothing.
		if err := h.Err(); err != nil {
			return "", fmt.Errorf("subagent failed: %w", err)
		}
		return h.Result(), nil
	}
	d.Tools.RegisterHidden(sa)
}
