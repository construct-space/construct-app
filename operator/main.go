package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"construct-operator/internal/agent"
	"construct-operator/internal/ai"
	"construct-operator/internal/appdir"
	"construct-operator/internal/chatsession"
	"construct-operator/internal/ctxmod"
	"construct-operator/internal/desktop"
	"construct-operator/internal/hook"
	"construct-operator/internal/mcp"
	"construct-operator/internal/module"
	"construct-operator/internal/oauth"
	appagents "construct-operator/internal/agent/builtin"
	appproviders "construct-operator/internal/provider/bootstrap"
	"construct-operator/internal/plugin"
	"construct-operator/internal/runner"
	"construct-operator/internal/session"
	"construct-operator/internal/sessions"
	"construct-operator/internal/skill"
	"construct-operator/internal/space"
	"construct-operator/internal/state"
	"construct-operator/internal/tool"
	"construct-operator/internal/transport"
)

const Version = "0.7.0"

func main() {
	os.Exit(run(os.Args[1:]))
}

func run(args []string) int {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// ── 1. Config & lifecycle ────────────────────────────────────────────
	cfg := parseConfig(args)
	setupLifecycle(cancel)

	// ── 2. Infrastructure ────────────────────────────────────────────────
	appdir.Init(cfg.isDev)
	appState := module.NewAppState()

	stateStore := state.NewStore(appdir.StateDir())
	if savedRoot, ok := stateStore.SettingGet("construct_projects_root"); ok && strings.TrimSpace(savedRoot) != "" {
		os.Setenv("CONSTRUCT_PROJECTS_ROOT", strings.TrimSpace(savedRoot))
		fmt.Fprintf(os.Stderr, "[operator] Projects root: %s\n", strings.TrimSpace(savedRoot))
	}

	sessionStore := session.NewStore(appdir.SessionsDir())
	chatSessionStore := chatsession.NewStore(appdir.Dir)
	oauthReg := oauth.NewRegistry()
	oauthStore := oauth.NewStorageInDir(appdir.Dir)

	var bridge *desktop.Client
	if token := os.Getenv("CONSTRUCT_BRIDGE_TOKEN"); token != "" {
		bridge = desktop.NewClient(token)
		space.Bridge = bridge
		fmt.Fprintf(os.Stderr, "[operator] desktop bridge: enabled\n")
	}

	// ── 3. Bootstrap tools, spaces, hooks, skills, agents ────────────────
	projectDirFunc := func(reqCtx context.Context) string {
		clientID := transport.ClientIDFromContext(reqCtx)
		if p, ok := appState.Project(clientID).(*runner.ProjectContext); ok && p != nil && p.RootPath != "" {
			return p.RootPath
		}
		return cfg.workDir
	}

	toolReg := tool.NewRegistry()
	tool.RegisterBuiltins(toolReg, projectDirFunc)
	tool.RegisterBridgeTools(toolReg, bridge)
	tool.RegisterSpaceCLITools(toolReg, projectDirFunc)

	allAgents := appagents.Core()
	hookReg := hook.NewRegistry()
	hook.RegisterSafetyHooks(hookReg, hook.ProjectRootFunc(projectDirFunc))
	skillReg := skill.NewRegistry()
	pluginMgr := plugin.NewManager()

	spaceDirs := appdir.AllSpacesDirs()
	var spaceIDs []string
	for _, dir := range spaceDirs {
		fmt.Fprintf(os.Stderr, "[operator] loading spaces from: %s\n", dir)
		results, err := space.LoadAll(dir, space.WorkDirFunc(projectDirFunc))
		if err != nil {
			fmt.Fprintf(os.Stderr, "[operator] warning: %s: %v\n", dir, err)
			continue
		}
		for _, sr := range results {
			for _, t := range sr.Tools {
				if bridge == nil && isDesktopOnlySpaceTool(t.Def.Name) {
					continue
				}
				toolReg.Register(t)
			}
			for _, h := range sr.Hooks {
				hookReg.Register(h)
			}
			for _, s := range sr.Skills {
				skillReg.Register(s)
			}
			for _, p := range sr.Plugins {
				if err := pluginMgr.RegisterPlugin(p, toolReg, hookReg); err != nil {
					fmt.Fprintf(os.Stderr, "[operator] warning: plugin %s: %v\n", p.ID, err)
				}
			}
			spaceIDs = append(spaceIDs, sr.SpaceID)
			if sr.Agent != nil {
				allAgents = append(allAgents, sr.Agent)
			}
		}
	}

	if bridge != nil && len(spaceIDs) > 0 {
		go func() {
			time.Sleep(3 * time.Second)
			tool.RegisterSpaceActionTools(toolReg, bridge, spaceIDs)
		}()
	}

	// User hooks & skills
	if hooks, err := hook.LoadConfig(filepath.Join(appdir.Dir, "hooks.json")); err == nil {
		for _, h := range hooks {
			hookReg.Register(h)
		}
	}
	if userSkills, err := skill.LoadFromDir(appdir.SkillsDir(), "user"); err == nil {
		for _, s := range userSkills {
			skillReg.Register(s)
		}
	}

	// Builtin skills + restore states
	skill.RegisterBuiltins(skillReg)
	for _, id := range skill.BuiltinIDs() {
		if saved, ok := stateStore.SkillStates()[id]; ok {
			skillReg.SetState(id, skill.State{Loaded: saved.Loaded, Enabled: saved.Enabled, LoadedAt: saved.LoadedAt, UpdatedAt: saved.UpdatedAt})
			continue
		}
		skillReg.Unload(id)
	}
	for id, saved := range stateStore.SkillStates() {
		skillReg.SetState(id, skill.State{Loaded: saved.Loaded, Enabled: saved.Enabled, LoadedAt: saved.LoadedAt, UpdatedAt: saved.UpdatedAt})
	}
	for id, saved := range stateStore.HookStates() {
		hookReg.SetEnabled(id, saved.Enabled)
	}
	fmt.Fprintf(os.Stderr, "[operator] agents: %d, tools: %d, hooks: %d, skills: %d, plugins: %d\n",
		len(allAgents), len(toolReg.All()), len(hookReg.List()), len(skillReg.All()), len(pluginMgr.List()))

	// ── 4. Bootstrap providers ───────────────────────────────────────────
	oauthData, _ := oauthStore.Load()
	provResult := appproviders.Bootstrap(appproviders.BootstrapConfig{
		Settings:       stateStore.Settings(),
		Env:            appproviders.CurrentEnv(),
		OAuthData:      oauthData,
		IsDisconnected: oauthStore.IsDisconnected,
		Logf:           func(format string, args ...any) { fmt.Fprintf(os.Stderr, format, args...) },
	})

	// ── 5. Bootstrap MCP ─────────────────────────────────────────────────
	mcpClient := mcp.Bootstrap(spaceDirs, appdir.Dir, stateStore, toolReg)
	userMCPConfigPath := filepath.Join(appdir.Dir, "mcp.json")

	// ── 6. Create runner ─────────────────────────────────────────────────
	fallbackAgent := appagents.Fallback()
	opts := []runner.Option{
		runner.WithSessionStore(sessionStore),
		runner.WithTools(toolReg),
		runner.WithHooks(hookReg),
		runner.WithSkills(skillReg),
		runner.WithAgentResolver(func(id string) *agent.Config {
			return resolveAgentFromList(allAgents, fallbackAgent, id)
		}),
	}
	for _, prov := range provResult.Providers {
		opts = append(opts, runner.WithProvider(prov))
	}
	rn := runner.New(opts...)
	runner.RegisterSpawnTool(toolReg)

	// Register get_project_context tool
	toolReg.Register(tool.Func("get_project_context",
		"Get information about the currently active project.",
		map[string]any{"type": "object", "properties": map[string]any{}},
		func(ctx context.Context, input string) (*tool.Result, error) {
			clientID := transport.ClientIDFromContext(ctx)
			proj, _ := appState.Project(clientID).(*runner.ProjectContext)
			if proj == nil {
				return &tool.Result{Content: "No project is currently active."}, nil
			}
			return &tool.Result{Content: fmt.Sprintf("Active Project:\n  Name: %s\n  Root: %s\n  Framework: %s", proj.Name, proj.RootPath, proj.Framework)}, nil
		},
	))

	// ── 7. Build dependencies & initialize modules ───────────────────────
	deps := module.Dependencies{
		Runner:            rn,
		StateStore:        stateStore,
		SessionStore:      sessionStore,
		ChatSessionStore:  chatSessionStore,
		Tools:             toolReg,
		Skills:            skillReg,
		Hooks:             hookReg,
		Plugins:           pluginMgr,
		MCP:               mcpClient,
		OAuthRegistry:     oauthReg,
		OAuthStorage:      oauthStore,
		Bridge:            bridge,
		Agents:            allAgents,
		FallbackAgent:     fallbackAgent,
		WorkDir:           cfg.workDir,
		UserMCPConfigPath: userMCPConfigPath,
		AppState:          appState,
	}

	router := module.NewRouter()

	// Standard modules — each registers its own routes
	standardModules := map[string]module.ModuleFactory{
		"ai":       ai.NewModule,
		"mcp":      mcp.NewModule,
		"skills":   skill.NewModule,
		"hooks":    hook.NewModule,
		"tools":    tool.NewModule,
		"sessions": sessions.NewModule,
		"context":  ctxmod.NewModule,
	}

	for name, factory := range standardModules {
		mod := factory(deps)
		if err := mod.Init(); err != nil {
			fmt.Fprintf(os.Stderr, "[operator] module %s init failed: %v\n", name, err)
			continue
		}
		mod.Routes(router)
		fmt.Fprintf(os.Stderr, "[operator] module loaded: %s\n", name)
	}

	// OAuth module — needs ProviderFuncs to avoid import cycles
	oauthMod := oauth.NewModuleWithFuncs(deps, oauth.ProviderFuncs{
		AddOAuthProvider:         func(providerID string, creds *oauth.Credentials) { rn.AddProvider(appproviders.FromOAuthCredentials(providerID, creds)) },
		RuntimeProviderID:        appproviders.RuntimeProviderID,
		ConnectedProviderEntries: appproviders.ConnectedProviderEntries,
		ListProviders:            rn.ListProviders,
		RemoveProvider:           rn.RemoveProvider,
	})
	oauthMod.Init()
	oauthMod.Routes(router)
	fmt.Fprintf(os.Stderr, "[operator] module loaded: oauth\n")

	// State module — uses RouteFunc pattern to avoid import cycles
	settingsHook := &settingsHookImpl{stateStore: stateStore, runner: rn}
	stateMod := state.NewModule(stateStore, settingsHook)
	stateMod.Routes(func(reqType string, handler func(context.Context, transport.Request) transport.Response) {
		router.Handle(reqType, handler)
	})
	fmt.Fprintf(os.Stderr, "[operator] module loaded: state\n")

	// ── 8. Start TCP server ──────────────────────────────────────────────
	srv := transport.NewTCPServer("127.0.0.1:" + cfg.port)
	srv.SetIdleShutdown(0, func() {
		fmt.Fprintf(os.Stderr, "[operator] idle timeout; shutting down\n")
		cancel()
	})

	// Give AI module access to the server for stream.cancel
	if aiMod, ok := findModuleByType[*ai.AIModule](standardModules, deps); ok {
		aiMod.SetServer(srv)
		aiMod.SetBuildVersion(Version)
	}

	srv.OnRequest(func(reqCtx context.Context, req transport.Request) transport.Response {
		return router.Dispatch(reqCtx, req)
	})
	srv.OnStream(func(reqCtx context.Context, req transport.Request, emit func(transport.StreamChunk)) {
		router.DispatchStream(reqCtx, req, emit)
	})

	fmt.Fprintf(os.Stderr, "[operator] v%s starting on :%s (workdir: %s)\n", Version, cfg.port, cfg.workDir)
	if err := srv.Serve(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "[operator] error: %v\n", err)
		return 1
	}
	return 0
}

// findModuleByType creates a module via factory to get a typed reference.
// This is a workaround because Initialize returns Module interface.
func findModuleByType[T any](factories map[string]module.ModuleFactory, deps module.Dependencies) (T, bool) {
	for _, factory := range factories {
		mod := factory(deps)
		if typed, ok := any(mod).(T); ok {
			return typed, true
		}
	}
	var zero T
	return zero, false
}

// ─── Config ──────────────────────────────────────────────────────────────────

type config struct {
	port    string
	workDir string
	isDev   bool
}

func parseConfig(args []string) config {
	cfg := config{port: "60100"}
	for i, arg := range args {
		if arg == "--port" && i+1 < len(args) {
			cfg.port = args[i+1]
		}
		if arg == "--dir" && i+1 < len(args) {
			cfg.workDir = args[i+1]
		}
		if arg == "--dev" {
			cfg.isDev = true
		}
	}
	if cfg.workDir == "" {
		cfg.workDir, _ = os.Getwd()
	}
	return cfg
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

func setupLifecycle(cancel context.CancelFunc) {
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sig
		fmt.Fprintf(os.Stderr, "\n[operator] shutting down...\n")
		cancel()
	}()
	if ppidStr := os.Getenv("CONSTRUCT_PARENT_PID"); ppidStr != "" {
		if ppid, err := strconv.Atoi(ppidStr); err == nil && ppid > 0 {
			go func() {
				for {
					time.Sleep(2 * time.Second)
					proc, err := os.FindProcess(ppid)
					if err != nil {
						break
					}
					if err := proc.Signal(syscall.Signal(0)); err != nil {
						fmt.Fprintf(os.Stderr, "[operator] parent gone, self-terminating\n")
						cancel()
						return
					}
				}
			}()
		}
	}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

func resolveAgentFromList(agents []*agent.Config, fallback *agent.Config, id string) *agent.Config {
	if id == "" {
		for i := len(agents) - 1; i >= 0; i-- {
			if agents[i].ID == "vibe" || agents[i].ID == "space:vibe" {
				return agents[i]
			}
		}
		return fallback
	}
	for i := len(agents) - 1; i >= 0; i-- {
		if agents[i].ID == id || agents[i].ID == "space:"+id {
			return agents[i]
		}
	}
	if id == "general" {
		return fallback
	}
	return nil
}

func isDesktopOnlySpaceTool(name string) bool {
	for _, suffix := range []string{"-dev", "-run-command", "-create_project"} {
		if strings.HasSuffix(name, suffix) {
			return true
		}
	}
	return false
}

// settingsHookImpl bridges state module settings with provider management.
type settingsHookImpl struct {
	stateStore *state.Store
	runner     *runner.Runner
}

func (h *settingsHookImpl) OnSettingSet(key, value string) {
	if envVar := appproviders.EnvVarForSetting(key); envVar != "" {
		if value != "" {
			os.Setenv(envVar, value)
		} else {
			os.Unsetenv(envVar)
		}
	}
	if providerID := appproviders.IDForSetting(key); providerID != "" {
		if value != "" {
			if p := appproviders.FromSetting(key, value); p != nil {
				h.runner.AddProvider(p)
			}
		} else {
			h.runner.RemoveProvider(providerID)
		}
	}
}

func (h *settingsHookImpl) ProviderStatus(settings map[string]string) map[string]bool {
	return appproviders.Status(settings)
}
