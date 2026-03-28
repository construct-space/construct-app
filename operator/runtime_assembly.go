package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"construct-operator/internal/agent"
	"construct-operator/internal/appdir"
	"construct-operator/internal/chatsession"
	"construct-operator/internal/desktop"
	"construct-operator/internal/oauth"
	"construct-operator/internal/runner"
	"construct-operator/internal/session"
	"construct-operator/internal/space"
	"construct-operator/internal/state"
)

func assembleOperatorRuntime(rt *operatorRuntime, rootCtx context.Context, isDev bool) requestDispatchDeps {
	appdir.Init(isDev)

	if token := os.Getenv("CONSTRUCT_BRIDGE_TOKEN"); token != "" {
		rt.bridge = desktop.NewClient(token)
		space.Bridge = rt.bridge
		fmt.Fprintf(os.Stderr, "[operator] desktop bridge: enabled (token len=%d)\n", len(token))
	} else {
		fmt.Fprintf(os.Stderr, "[operator] desktop bridge: disabled (no CONSTRUCT_BRIDGE_TOKEN)\n")
	}

	rt.sessionStore = session.NewStore(appdir.SessionsDir())
	rt.stateStore = state.NewStore(appdir.StateDir())
	if savedRoot, ok := rt.stateStore.SettingGet("construct_projects_root"); ok && strings.TrimSpace(savedRoot) != "" {
		os.Setenv("CONSTRUCT_PROJECTS_ROOT", strings.TrimSpace(savedRoot))
		fmt.Fprintf(os.Stderr, "[operator] Projects root: %s\n", strings.TrimSpace(savedRoot))
	}
	rt.chatSessionStore = chatsession.NewStore(appdir.Dir)

	opts := []runner.Option{runner.WithSessionStore(rt.sessionStore)}
	rt.oauthRegistry = oauth.NewRegistry()
	rt.oauthStorage = oauth.NewStorageInDir(appdir.Dir)
	oauthData, _ := rt.oauthStorage.Load()

	providerBootstrap := bootstrapProviders(providerBootstrapConfig{
		settings:       rt.stateStore.Settings(),
		env:            currentProviderEnv(),
		oauthData:      oauthData,
		isDisconnected: rt.oauthStorage.IsDisconnected,
		logf:           operatorBootstrapLogger,
	})
	for _, prov := range providerBootstrap.providers {
		opts = append(opts, runner.WithProvider(prov))
	}

	toolsSpaces := bootstrapToolsSpaces(rt)
	rt.tools = toolsSpaces.tools
	rt.hooks = toolsSpaces.hooks
	rt.skills = toolsSpaces.skills
	rt.plugins = toolsSpaces.plugins
	rt.agents = toolsSpaces.agents

	rt.bootstrapMCP(toolsSpaces.spaceDirs)
	rt.userMCPConfigPath = filepath.Join(appdir.Dir, "mcp.json")
	rt.fallbackAgent = newFallbackAgent()

	opts = append(opts,
		runner.WithTools(rt.tools),
		runner.WithHooks(rt.hooks),
		runner.WithSkills(rt.skills),
		runner.WithAgentResolver(func(id string) *agent.Config {
			return rt.resolveAgent(id)
		}),
	)
	rt.runner = runner.New(opts...)
	runner.RegisterSpawnTool(rt.tools)

	return requestDispatchDeps{
		rootCtx: rootCtx,
		bridge:  rt.bridge,
	}
}
