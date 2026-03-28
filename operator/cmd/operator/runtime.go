package main

import (
	"context"
	"sync"
	"time"

	"construct-operator/internal/agent"
	"construct-operator/internal/chatsession"
	"construct-operator/internal/desktop"
	"construct-operator/internal/hook"
	"construct-operator/internal/mcp"
	"construct-operator/internal/oauth"
	"construct-operator/internal/plugin"
	"construct-operator/internal/runner"
	"construct-operator/internal/session"
	"construct-operator/internal/skill"
	"construct-operator/internal/state"
	"construct-operator/internal/tool"
	"construct-operator/internal/transport"
)

type pendingOAuthResult struct {
	Creds *oauth.Credentials
	Err   error
	URL   string
}

type operatorRuntime struct {
	runner           *runner.Runner
	sessionStore     *session.Store
	stateStore       *state.Store
	chatSessionStore *chatsession.Store
	oauthRegistry    *oauth.Registry
	oauthStorage     *oauth.Storage

	bridge  *desktop.Client
	tools   *tool.Registry
	hooks   *hook.Registry
	skills  *skill.Registry
	plugins *plugin.Manager
	mcp     *mcp.Client

	agents        []*agent.Config
	fallbackAgent *agent.Config
	workDir       string
	userMCPConfigPath string

	projectMu      sync.RWMutex
	activeProjects map[string]*runner.ProjectContext
	clientContexts map[string]*clientContextState

	pendingDeviceFlowsMu sync.Mutex
	pendingDeviceFlows   map[string]*oauth.DeviceFlowState

	pendingOAuthMu    sync.Mutex
	pendingOAuthFlows map[string]chan pendingOAuthResult
}

func newOperatorRuntime(workDir string) *operatorRuntime {
	return &operatorRuntime{
		workDir:            workDir,
		activeProjects:     make(map[string]*runner.ProjectContext),
		clientContexts:     make(map[string]*clientContextState),
		pendingDeviceFlows: make(map[string]*oauth.DeviceFlowState),
		pendingOAuthFlows:  make(map[string]chan pendingOAuthResult),
	}
}

func (rt *operatorRuntime) projectDir(reqCtx context.Context) string {
	if override := projectOverrideFromContext(reqCtx); override != nil && override.RootPath != "" {
		return override.RootPath
	}
	clientID := clientKey(transport.ClientIDFromContext(reqCtx))
	rt.projectMu.RLock()
	defer rt.projectMu.RUnlock()
	if proj := rt.activeProjects[clientID]; proj != nil && proj.RootPath != "" {
		return proj.RootPath
	}
	return rt.workDir
}

func (rt *operatorRuntime) projectContext(reqCtx context.Context) *runner.ProjectContext {
	if override := projectOverrideFromContext(reqCtx); override != nil {
		return override
	}
	clientID := clientKey(transport.ClientIDFromContext(reqCtx))
	rt.projectMu.RLock()
	defer rt.projectMu.RUnlock()
	return rt.activeProjects[clientID]
}

func (rt *operatorRuntime) clientContext(reqCtx context.Context) *clientContextState {
	clientID := clientKey(transport.ClientIDFromContext(reqCtx))
	rt.projectMu.RLock()
	defer rt.projectMu.RUnlock()
	return rt.clientContexts[clientID]
}

func (rt *operatorRuntime) runnerContext(reqCtx context.Context) map[string]any {
	return runnerContextFromClientState(rt.clientContext(reqCtx))
}

func (rt *operatorRuntime) resolveAgent(id string) *agent.Config {
	return resolveAgent(rt.agents, rt.fallbackAgent, id)
}

func (rt *operatorRuntime) setProject(clientID string, project *runner.ProjectContext) {
	rt.projectMu.Lock()
	defer rt.projectMu.Unlock()
	rt.activeProjects[clientKey(clientID)] = project
}

func (rt *operatorRuntime) clearProject(clientID string) {
	rt.projectMu.Lock()
	defer rt.projectMu.Unlock()
	delete(rt.activeProjects, clientKey(clientID))
}

func (rt *operatorRuntime) setClientMode(clientID, mode string) {
	rt.updateClientContext(clientID, func(state *clientContextState) {
		state.Mode = mode
	})
}

func (rt *operatorRuntime) setClientComponent(clientID string, component map[string]any) {
	rt.updateClientContext(clientID, func(state *clientContextState) {
		state.Component = cloneMap(component)
	})
}

func (rt *operatorRuntime) setClientSelection(clientID string, selection map[string]any) {
	rt.updateClientContext(clientID, func(state *clientContextState) {
		state.Selection = cloneMap(selection)
	})
}

func (rt *operatorRuntime) contextData(reqCtx context.Context) map[string]any {
	data := map[string]any{
		"workDir":   rt.projectDir(reqCtx),
		"mode":      "code",
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	}
	if project := rt.projectContext(reqCtx); project != nil {
		data["project"] = project
	}
	if clientCtx := rt.clientContext(reqCtx); clientCtx != nil {
		for key, value := range rt.runnerContext(reqCtx) {
			data[key] = value
		}
		if clientCtx.Timestamp != "" {
			data["timestamp"] = clientCtx.Timestamp
		}
	}
	return data
}

func (rt *operatorRuntime) setPendingDeviceFlow(providerID string, state *oauth.DeviceFlowState) {
	rt.pendingDeviceFlowsMu.Lock()
	defer rt.pendingDeviceFlowsMu.Unlock()
	rt.pendingDeviceFlows[providerID] = state
}

func (rt *operatorRuntime) pendingDeviceFlow(providerID string) (*oauth.DeviceFlowState, bool) {
	rt.pendingDeviceFlowsMu.Lock()
	defer rt.pendingDeviceFlowsMu.Unlock()
	state, ok := rt.pendingDeviceFlows[providerID]
	return state, ok
}

func (rt *operatorRuntime) clearPendingDeviceFlow(providerID string) {
	rt.pendingDeviceFlowsMu.Lock()
	defer rt.pendingDeviceFlowsMu.Unlock()
	delete(rt.pendingDeviceFlows, providerID)
}

func (rt *operatorRuntime) setPendingOAuthFlow(providerID string, resultCh chan pendingOAuthResult) {
	rt.pendingOAuthMu.Lock()
	defer rt.pendingOAuthMu.Unlock()
	rt.pendingOAuthFlows[providerID] = resultCh
}

func (rt *operatorRuntime) pendingOAuthFlow(providerID string) (chan pendingOAuthResult, bool) {
	rt.pendingOAuthMu.Lock()
	defer rt.pendingOAuthMu.Unlock()
	resultCh, ok := rt.pendingOAuthFlows[providerID]
	return resultCh, ok
}

func (rt *operatorRuntime) clearPendingOAuthFlow(providerID string) {
	rt.pendingOAuthMu.Lock()
	defer rt.pendingOAuthMu.Unlock()
	delete(rt.pendingOAuthFlows, providerID)
}

func (rt *operatorRuntime) updateClientContext(clientID string, update func(*clientContextState)) {
	rt.projectMu.Lock()
	defer rt.projectMu.Unlock()
	key := clientKey(clientID)
	state := rt.clientContexts[key]
	if state == nil {
		state = &clientContextState{}
		rt.clientContexts[key] = state
	}
	update(state)
	state.Timestamp = time.Now().UTC().Format(time.RFC3339)
}
