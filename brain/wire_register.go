// registerBuiltins is the fan-out that wires every wire op onto the
// sidecar. Each register* function lives in its own wire_*.go file by
// domain; this just calls them in a stable order so the wire surface
// stays scannable in one place.
package main

import (
	"os"

	"github.com/construct-space/brain/agents"
	"github.com/construct-space/brain/bridge"
	"github.com/construct-space/brain/catalog"
	"github.com/construct-space/brain/hook"
	"github.com/construct-space/brain/identity"
	"github.com/construct-space/brain/oauth"
	"github.com/construct-space/brain/paths"
	"github.com/construct-space/brain/provider"
	"github.com/construct-space/brain/session"
	"github.com/construct-space/brain/sidecar"
	"github.com/construct-space/brain/skill"
	"github.com/construct-space/brain/state"
	"github.com/construct-space/brain/telemetry"
	"github.com/construct-space/brain/tool"
)

func registerBuiltins(
	s *sidecar.Server,
	p paths.Paths,
	tools *tool.Registry,
	skills []skill.Skill,
	reg *catalog.Registry,
	idLoader *identity.Loader,
	anthropicOAuth provider.TokenSource,
	openaiCodexOAuth *codexAuth,
	orgKeys *provider.OrgKeyStore,
	cancels *cancelTracker,
	sessions *session.Store,
	hooks *hook.Set,
	tele *telemetry.Sink,
	logins *loginRegistry,
	oauthStore *oauth.Storage,
	agentReg *agents.Registry,
	frontend *bridge.Frontend,
	stateStore *state.Store,
	taskStore *tool.TaskStore,
	httpBridge *bridge.Client,
	permMem *permissionMemory,
) {
	registerSystemHandlers(s, p, httpBridge, idLoader, sessions, stateStore, oauthStore, reg)
	registerCoderHandlers(s, p.DataDir, permMem)
	registerInsightsHandlers(s, insightsDeps{BrainDir: p.BrainDir})
	registerLiveModelsHandler(s, liveModelsDeps{State: stateStore})
	registerToolsCallHandler(s, toolsCallDeps{Tools: tools, DataDir: p.DataDir, Frontend: frontend, PermMem: permMem})
	registerCatalogHandlers(s, reg, tools, skills)
	registerIdentityHandlers(s, idLoader)
	registerOAuthHandlers(s, logins, oauthStore, idLoader, reg)
	registerAIProvidersHandler(s, reg, oauthStore, stateStore, orgKeys)
	registerAICompleteHandler(s, aiCompleteDeps{
		Reg:              reg,
		AnthropicOAuth:   anthropicOAuth,
		OpenAICodexOAuth: openaiCodexOAuth,
		OrgKeys:          orgKeys,
		StateStore:       stateStore,
		IdLoader:         idLoader,
		OauthStore:       oauthStore,
	})
	registerAgentHandlers(s, agentReg)
	registerCancelHandler(s, cancels)
	registerKVHandlers(s, stateStore)
	registerSettingsHandlers(s, stateStore)
	registerRuntimeHandlers(s, stateStore, getwd)
	registerSessionHandlers(s, sessions)
	registerAIConversationHandlers(s, sessions)
	registerStubs(s)
	registerPromptHandlers(s, &promptDeps{
		Tools:            tools,
		Skills:           skills,
		Reg:              reg,
		AnthropicOAuth:   anthropicOAuth,
		OpenAICodexOAuth: openaiCodexOAuth,
		OrgKeys:          orgKeys,
		Sessions:         sessions,
		Hooks:            hooks,
		Telemetry:        tele,
		IdLoader:         idLoader,
		AgentReg:         agentReg,
		Paths:            p,
		Frontend:         frontend,
		HTTPBridge:       httpBridge,
		TaskStore:        taskStore,
		StateStore:       stateStore,
		Cancels:          cancels,
		PermissionMemory: permMem,
	})
}

// getwd is a tiny wrapper that gives registerRuntimeHandlers a
// "current working directory" lookup without that file needing to import
// os directly. Returns "" on error so callers can fall back gracefully.
func getwd() string {
	cwd, err := os.Getwd()
	if err != nil {
		return ""
	}
	return cwd
}
