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
	"construct-operator/internal/appdir"
	"construct-operator/internal/chatsession"
	"construct-operator/internal/desktop"
	"construct-operator/internal/oauth"
	"construct-operator/internal/provider"
	"construct-operator/internal/runner"
	"construct-operator/internal/session"
	"construct-operator/internal/space"
	"construct-operator/internal/state"
	"construct-operator/internal/transport"
)

const Version = "0.6.7"

func providerFromSetting(settingKey, value string) provider.Provider {
	if value == "" {
		return nil
	}
	switch settingKey {
	case "provider_key:deepseek":
		return provider.NewOpenAICompat(provider.OpenAICompatConfig{
			Name:    "DeepSeek",
			Key:     "deepseek",
			BaseURL: "https://api.deepseek.com/v1",
			APIKey:  value,
			Models:  []string{"deepseek-chat", "deepseek-reasoner"},
		})
	case "provider_key:mimo":
		return provider.NewOpenAICompat(provider.OpenAICompatConfig{
			Name:    "MiMo",
			Key:     "mimo",
			BaseURL: "https://api.xiaomimimo.com/v1",
			APIKey:  value,
			Models:  []string{"mimo-v2-flash"},
		})
	case "provider_key:zai":
		return provider.NewOpenAICompat(provider.OpenAICompatConfig{
			Name:    "Z.ai",
			Key:     "zai",
			BaseURL: "https://api.z.ai/api/coding/paas/v4",
			APIKey:  value,
			Models:  []string{"glm-5"},
		})
	case "provider_key:xai":
		return provider.NewOpenAICompat(provider.OpenAICompatConfig{
			Name:    "xAI",
			Key:     "xai",
			BaseURL: "https://api.x.ai/v1",
			APIKey:  value,
			Models:  []string{"grok-3", "grok-3-mini"},
		})
	case "provider_key:openrouter":
		return provider.NewOpenRouter(value)
	default:
		return nil
	}
}

func providerEnvVarForSetting(settingKey string) string {
	switch settingKey {
	case "provider_key:deepseek":
		return "DEEPSEEK_API_KEY"
	case "provider_key:mimo":
		return "MIMO_API_KEY"
	case "provider_key:zai":
		return "ZAI_API_KEY"
	case "provider_key:xai":
		return "XAI_API_KEY"
	case "provider_key:openrouter":
		return "OPENROUTER_API_KEY"
	default:
		return ""
	}
}

func providerIDForSetting(settingKey string) string {
	switch settingKey {
	case "provider_key:deepseek":
		return "deepseek"
	case "provider_key:mimo":
		return "mimo"
	case "provider_key:zai":
		return "zai"
	case "provider_key:xai":
		return "xai"
	case "provider_key:openrouter":
		return "openrouter"
	default:
		return ""
	}
}

func providerStatus(settings map[string]string) map[string]bool {
	result := map[string]bool{
		"deepseek":   strings.TrimSpace(os.Getenv("DEEPSEEK_API_KEY")) != "",
		"mimo":       strings.TrimSpace(os.Getenv("MIMO_API_KEY")) != "",
		"xai":        strings.TrimSpace(os.Getenv("XAI_API_KEY")) != "",
		"zai":        strings.TrimSpace(os.Getenv("ZAI_API_KEY")) != "",
		"openrouter": strings.TrimSpace(os.Getenv("OPENROUTER_API_KEY")) != "",
		"kimi":       false,
	}
	for key, value := range settings {
		if !strings.HasPrefix(key, "provider_key:") {
			continue
		}
		id := strings.TrimPrefix(key, "provider_key:")
		result[id] = strings.TrimSpace(value) != "" || result[id]
	}
	return result
}

type clientContextState struct {
	Mode      string
	Component map[string]any
	Selection map[string]any
	Timestamp string
}

type requestProjectOverrideKey struct{}

func withProjectOverride(ctx context.Context, project *runner.ProjectContext) context.Context {
	if project == nil {
		return ctx
	}
	return context.WithValue(ctx, requestProjectOverrideKey{}, project)
}

func projectOverrideFromContext(ctx context.Context) *runner.ProjectContext {
	project, _ := ctx.Value(requestProjectOverrideKey{}).(*runner.ProjectContext)
	return project
}

func cloneMap(input map[string]any) map[string]any {
	if len(input) == 0 {
		return nil
	}
	result := make(map[string]any, len(input))
	for key, value := range input {
		result[key] = value
	}
	return result
}

func mapString(m map[string]any, key string) string {
	value, _ := m[key].(string)
	return value
}

// isDesktopOnlySpaceTool returns true for space tools that need the desktop
// bridge and should be excluded when running headless (TUI/CLI mode).
func isDesktopOnlySpaceTool(name string) bool {
	// Space tools that start long-running processes or need desktop UI
	suffixes := []string{"-dev", "-run-command", "-create_project"}
	for _, suffix := range suffixes {
		if strings.HasSuffix(name, suffix) {
			return true
		}
	}
	return false
}

func truncateLog(s string, max int) string {
	s = strings.TrimSpace(s)
	if len(s) <= max {
		return s
	}
	return s[:max] + "..."
}

func lastUserMessage(messages []provider.Message) string {
	for i := len(messages) - 1; i >= 0; i-- {
		if strings.EqualFold(messages[i].Role, "user") {
			if content := strings.TrimSpace(messages[i].Content); content != "" {
				return content
			}
		}
	}
	return ""
}

func main() {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Graceful shutdown
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sig
		fmt.Fprintf(os.Stderr, "\n[operator] shutting down...\n")
		cancel()
	}()

	// Watch parent process — self-terminate if Construct app dies without cleanup.
	// Prevents orphan operator processes holding ports after force-quit / crash.
	if ppidStr := os.Getenv("CONSTRUCT_PARENT_PID"); ppidStr != "" {
		if ppid, err := strconv.Atoi(ppidStr); err == nil && ppid > 0 {
			go func() {
				for {
					time.Sleep(2 * time.Second)
					proc, err := os.FindProcess(ppid)
					if err != nil {
						break
					}
					// On Unix, kill(pid, 0) checks if process exists
					if err := proc.Signal(syscall.Signal(0)); err != nil {
						fmt.Fprintf(os.Stderr, "[operator] parent (pid=%d) is gone, self-terminating\n", ppid)
						cancel()
						return
					}
				}
			}()
		}
	}

	// Parse flags
	port := "60100"
	workDir := ""
	isDev := false
	for i, arg := range os.Args[1:] {
		if arg == "--port" && i+1 < len(os.Args[1:]) {
			port = os.Args[i+2]
		}
		if arg == "--dir" && i+1 < len(os.Args[1:]) {
			workDir = os.Args[i+2]
		}
		if arg == "--dev" {
			isDev = true
		}
	}
	if workDir == "" {
		workDir, _ = os.Getwd()
	}
	opRuntime := newOperatorRuntime(workDir)

	// Initialize data directory (~/Library/Application Support/Construct/)
	appdir.Init(isDev)

	// Desktop bridge client (operator → Tauri reverse bridge)
	// Token is passed via env by Tauri when spawning operator.
	if token := os.Getenv("CONSTRUCT_BRIDGE_TOKEN"); token != "" {
		opRuntime.bridge = desktop.NewClient(token)
		space.Bridge = opRuntime.bridge // Make bridge available to space tools
		fmt.Fprintf(os.Stderr, "[operator] desktop bridge: enabled (token len=%d)\n", len(token))
	} else {
		fmt.Fprintf(os.Stderr, "[operator] desktop bridge: disabled (no CONSTRUCT_BRIDGE_TOKEN)\n")
	}

	// Initialize session store (persistent to disk)
	opRuntime.sessionStore = session.NewStore(appdir.SessionsDir())
	opRuntime.stateStore = state.NewStore(appdir.StateDir())

	// Restore projects root from settings (so hooks/agents use the user's configured path)
	if savedRoot, ok := opRuntime.stateStore.SettingGet("construct_projects_root"); ok && strings.TrimSpace(savedRoot) != "" {
		os.Setenv("CONSTRUCT_PROJECTS_ROOT", strings.TrimSpace(savedRoot))
		fmt.Fprintf(os.Stderr, "[operator] Projects root: %s\n", strings.TrimSpace(savedRoot))
	}

	opRuntime.chatSessionStore = chatsession.NewStore(appdir.Dir)

	// Initialize providers (LLM-agnostic — add as many as you want)
	opts := []runner.Option{runner.WithSessionStore(opRuntime.sessionStore)}
	opRuntime.oauthRegistry = oauth.NewRegistry()
	opRuntime.oauthStorage = oauth.NewStorageInDir(appdir.Dir)
	oauthData, _ := opRuntime.oauthStorage.Load()
	bridge := opRuntime.bridge
	stateStore := opRuntime.stateStore

	providerBootstrap := bootstrapProviders(providerBootstrapConfig{
		settings:       stateStore.Settings(),
		env:            currentProviderEnv(),
		oauthData:      oauthData,
		isDisconnected: opRuntime.oauthStorage.IsDisconnected,
		logf:           operatorBootstrapLogger,
	})
	for _, prov := range providerBootstrap.providers {
		opts = append(opts, runner.WithProvider(prov))
	}

	toolsSpaces := bootstrapToolsSpaces(opRuntime)
	opRuntime.tools = toolsSpaces.tools
	tools := opRuntime.tools
	opRuntime.hooks = toolsSpaces.hooks
	hookReg := opRuntime.hooks
	opRuntime.skills = toolsSpaces.skills
	skillReg := opRuntime.skills
	opRuntime.plugins = toolsSpaces.plugins
	allAgents := toolsSpaces.agents

	opRuntime.bootstrapMCP(toolsSpaces.spaceDirs)
	opRuntime.userMCPConfigPath = filepath.Join(appdir.Dir, "mcp.json")

	// Fallback agent — used when no spaces are loaded or agent not found.
	// This is the ONLY hardcoded agent. Everything else comes from spaces.
	fallbackAgent := &agent.Config{
		ID:          "general",
		Name:        "General",
		Description: "General-purpose Construct assistant with full tool access",
		Category:    "primary",
		System: `You are Construct, an AI coding assistant. Use get_project_context to learn about the active project. Use available tools to help the user. Read files before modifying them. Be concise.

## Construct Spaces

You have space lifecycle tools for managing Construct spaces (plugins/extensions that run inside the Construct):
- space_create: Scaffold a new space project
- space_build: Build a space (Vite IIFE bundle)
- space_validate: Validate a space manifest
- space_check: Type-check and lint a space
- space_install: Install a built space into Construct
- space_list_installed: List all installed spaces
- space_read_manifest: Read a space's manifest

When the user asks to create, build, or manage a Construct space, use these tools. A space is a Vue 3 project with a space.manifest.json — not a regular web app.`,
		Model:    "claude-sonnet-4-6",
		MaxTurns: 25,
		CanSpawn: true,
	}
	opRuntime.agents = allAgents
	opRuntime.fallbackAgent = fallbackAgent

	opts = append(opts, runner.WithTools(tools))
	opts = append(opts, runner.WithHooks(hookReg))
	opts = append(opts, runner.WithSkills(skillReg))

	// Resolve agent by ID — searches all loaded space agents, falls back to general
	// Wire agent resolver and spawn tool into runner
	opts = append(opts, runner.WithAgentResolver(func(id string) *agent.Config {
		return opRuntime.resolveAgent(id)
	}))
	opRuntime.runner = runner.New(opts...)
	// Register spawn_agent tool so agents with canSpawn can use it
	runner.RegisterSpawnTool(tools)

	// Start TCP transport
	srv := transport.NewTCPServer("127.0.0.1:" + port)
	srv.SetIdleShutdown(0, func() {
		fmt.Fprintf(os.Stderr, "[operator] idle timeout reached; no connected clients remain\n")
		cancel()
	})

	// Streaming handler — for *_stream request types
	srv.OnStream(func(reqCtx context.Context, req transport.Request, emit func(transport.StreamChunk)) {
		opRuntime.handleStream(reqCtx, req, emit)
	})

	requestDeps := requestDispatchDeps{
		server:  srv,
		rootCtx: ctx,
		bridge:  bridge,
	}
	srv.OnRequest(func(reqCtx context.Context, req transport.Request) transport.Response {
		return opRuntime.dispatchRequest(reqCtx, req, requestDeps)
	})

	fmt.Fprintf(os.Stderr, "[operator] v%s starting on :%s (workdir: %s)\n", Version, port, opRuntime.workDir)
	fmt.Fprintf(os.Stderr, "[operator] tools: %d registered\n", len(tools.All()))

	if err := srv.Serve(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "[operator] error: %v\n", err)
		os.Exit(1)
	}
}
