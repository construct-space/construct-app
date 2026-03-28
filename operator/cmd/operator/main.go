package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	"os/exec"
	"runtime"

	"construct-operator/internal/agent"
	"construct-operator/internal/appdir"
	"construct-operator/internal/chatsession"
	"construct-operator/internal/desktop"
	"construct-operator/internal/hook"
	"construct-operator/internal/mcp"
	"construct-operator/internal/oauth"
	"construct-operator/internal/provider"
	"construct-operator/internal/runner"
	"construct-operator/internal/session"
	"construct-operator/internal/skill"
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

func hookTypeLabel(hookType hook.Type) string {
	switch hookType {
	case hook.PreTool:
		return "tool.pre"
	case hook.PostTool:
		return "tool.post"
	default:
		return string(hookType)
	}
}

func skillKeywords(s *skill.Skill) []string {
	set := map[string]bool{}
	add := func(values ...string) {
		for _, value := range values {
			value = strings.TrimSpace(strings.ToLower(value))
			if value == "" {
				continue
			}
			set[value] = true
		}
	}

	add(s.Category, s.ID, s.Name)
	for _, part := range strings.Split(s.Trigger, ",") {
		add(part)
	}

	keywords := make([]string, 0, len(set))
	for keyword := range set {
		keywords = append(keywords, keyword)
	}
	return keywords
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
	chatSessStore := opRuntime.chatSessionStore
	oauthRegistry := opRuntime.oauthRegistry
	oauthStorage := opRuntime.oauthStorage
	setPendingDeviceFlow := opRuntime.setPendingDeviceFlow
	getPendingDeviceFlow := opRuntime.pendingDeviceFlow
	clearPendingDeviceFlow := opRuntime.clearPendingDeviceFlow
	setPendingOAuthFlow := opRuntime.setPendingOAuthFlow
	getPendingOAuthFlow := opRuntime.pendingOAuthFlow
	clearPendingOAuthFlow := opRuntime.clearPendingOAuthFlow

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
	mcpClient := opRuntime.mcp
	userMCPConfigPath := filepath.Join(appdir.Dir, "mcp.json")
	listMCPServers := opRuntime.listMCPServers
	persistUserMCPConfigs := func() error {
		return opRuntime.persistUserMCPConfigs(userMCPConfigPath)
	}
	registerMCPServerTools := opRuntime.registerMCPServerTools

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
	run := opRuntime.runner
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
		if resp, handled := opRuntime.dispatchFrontRequests(reqCtx, req, requestDeps); handled {
			return resp
		}

		switch {
		case req.Type == "oauth.login":
			var payload struct {
				Provider string `json:"provider"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if payload.Provider == "" {
				return transport.Response{ID: req.ID, Success: false, Error: "provider is required"}
			}

			provider, ok := oauthRegistry.Get(payload.Provider)
			if !ok {
				return transport.Response{ID: req.ID, Success: false, Error: fmt.Sprintf("unknown OAuth provider: %s", payload.Provider)}
			}

			// Device code flow (GitHub Copilot) — return user_code immediately, poll separately
			if payload.Provider == "github-copilot" {
				state, err := oauth.StartCopilotDeviceFlow("")
				if err != nil {
					return transport.Response{ID: req.ID, Success: false, Error: fmt.Sprintf("OAuth login failed: %v", err)}
				}
				// Open browser to verification page
				switch runtime.GOOS {
				case "darwin":
					exec.Command("open", state.VerificationURI).Start()
				case "linux":
					exec.Command("xdg-open", state.VerificationURI).Start()
				case "windows":
					exec.Command("rundll32", "url.dll,FileProtocolHandler", state.VerificationURI).Start()
				}
				// Store state for polling
				setPendingDeviceFlow(payload.Provider, state)

				fmt.Fprintf(os.Stderr, "[oauth] %s: device flow started, code: %s\n", payload.Provider, state.UserCode)
				return transport.Response{
					ID: req.ID, Success: true,
					Data: map[string]any{
						"provider":    payload.Provider,
						"device_code": true,
						"user_code":   state.UserCode,
						"url":         state.VerificationURI,
					},
				}
			}

			// Standard OAuth flow — launch in background, return immediately
			resultCh := make(chan pendingOAuthResult, 1)
			setPendingOAuthFlow(payload.Provider, resultCh)

			providerID := payload.Provider
			var authURL string

			go func() {
				creds, err := provider.Login(oauth.LoginCallbacks{
					OnAuth: func(info oauth.AuthInfo) {
						authURL = info.URL
						switch runtime.GOOS {
						case "darwin":
							exec.Command("open", info.URL).Start()
						case "linux":
							exec.Command("xdg-open", info.URL).Start()
						case "windows":
							exec.Command("rundll32", "url.dll,FileProtocolHandler", info.URL).Start()
						}
						fmt.Fprintf(os.Stderr, "[oauth] %s: browser opened for login\n", providerID)
						if info.Instructions != "" {
							fmt.Fprintf(os.Stderr, "[oauth] %s: %s\n", providerID, info.Instructions)
						}
					},
					OnPrompt: func(prompt oauth.Prompt) (string, error) {
						if prompt.AllowEmpty {
							return "", nil
						}
						return "", fmt.Errorf("interactive prompt %q is not supported in desktop mode yet", prompt.Message)
					},
					OnProgress: func(message string) {
						fmt.Fprintf(os.Stderr, "[oauth] %s: %s\n", providerID, message)
					},
				})
				resultCh <- pendingOAuthResult{Creds: creds, Err: err, URL: authURL}
			}()

			fmt.Fprintf(os.Stderr, "[oauth] %s: login flow started (non-blocking)\n", providerID)
			return transport.Response{
				ID: req.ID, Success: true,
				Data: map[string]any{
					"provider": providerID,
					"pending":  true,
				},
			}

		case req.Type == "oauth.device-poll":
			var payload struct {
				Provider string `json:"provider"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}

			state, ok := getPendingDeviceFlow(payload.Provider)

			if !ok || state == nil {
				return transport.Response{ID: req.ID, Success: false, Error: "no pending device flow for " + payload.Provider}
			}

			// Non-blocking: poll GitHub once and return status
			status, creds, err := oauth.PollCopilotDeviceFlowOnce(state)
			if status == "pending" {
				return transport.Response{
					ID: req.ID, Success: true,
					Data: map[string]any{"status": "pending"},
				}
			}

			// Flow finished (success or error) — clean up
			clearPendingDeviceFlow(payload.Provider)

			if err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: fmt.Sprintf("OAuth login failed: %v", err)}
			}

			// Save credentials
			if err := oauthStorage.SetOAuth(payload.Provider, creds); err != nil {
				fmt.Fprintf(os.Stderr, "[oauth] warning: failed to save credentials: %v\n", err)
			}
			if runtimeProv := providerFromOAuthCredentials(payload.Provider, creds); runtimeProv != nil {
				run.AddProvider(runtimeProv)
			}

			fmt.Fprintf(os.Stderr, "[oauth] %s: login successful (expires: %d)\n", payload.Provider, creds.Expires)
			return transport.Response{
				ID: req.ID, Success: true,
				Data: map[string]any{
					"provider": payload.Provider,
					"status":   "success",
					"success":  true,
				},
			}

		case req.Type == "oauth.poll":
			// Non-blocking poll for callback-based OAuth flows (Anthropic, OpenAI, Gemini)
			var payload struct {
				Provider string `json:"provider"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}

			ch, ok := getPendingOAuthFlow(payload.Provider)

			if !ok || ch == nil {
				return transport.Response{ID: req.ID, Success: false, Error: "no pending OAuth flow for " + payload.Provider}
			}

			// Non-blocking check
			select {
			case result := <-ch:
				// Flow finished — clean up
				clearPendingOAuthFlow(payload.Provider)

				if result.Err != nil {
					return transport.Response{ID: req.ID, Success: false, Error: fmt.Sprintf("OAuth login failed: %v", result.Err)}
				}

				// Save credentials
				if err := oauthStorage.SetOAuth(payload.Provider, result.Creds); err != nil {
					fmt.Fprintf(os.Stderr, "[oauth] warning: failed to save credentials: %v\n", err)
				}
				if runtimeProv := providerFromOAuthCredentials(payload.Provider, result.Creds); runtimeProv != nil {
					run.AddProvider(runtimeProv)
				}

				fmt.Fprintf(os.Stderr, "[oauth] %s: login successful (expires: %d)\n", payload.Provider, result.Creds.Expires)
				return transport.Response{
					ID: req.ID, Success: true,
					Data: map[string]any{
						"provider": payload.Provider,
						"status":   "success",
						"success":  true,
					},
				}
			default:
				// Still waiting
				return transport.Response{
					ID: req.ID, Success: true,
					Data: map[string]any{"status": "pending"},
				}
			}

		case req.Type == "oauth.gh-check":
			// Check if gh CLI is authenticated by reading config files + keychain directly
			username, token := oauth.DetectGitHubCLIAuth()
			return transport.Response{
				ID: req.ID, Success: true,
				Data: map[string]any{
					"logged_in": username != "",
					"username":  username,
					"token":     token,
				},
			}

		case req.Type == "oauth.gh-use-token":
			// Use an existing gh CLI token for GitHub Copilot
			var payload struct {
				Token string `json:"token"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if payload.Token == "" {
				return transport.Response{ID: req.ID, Success: false, Error: "token is required"}
			}
			creds, err := oauth.RefreshGitHubCopilotToken(payload.Token, "github.com")
			if err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: fmt.Sprintf("Failed to get Copilot token: %v", err)}
			}
			if err := oauthStorage.SetOAuth("github-copilot", creds); err != nil {
				fmt.Fprintf(os.Stderr, "[oauth] warning: failed to save credentials: %v\n", err)
			}
			if runtimeProv := providerFromOAuthCredentials("github-copilot", creds); runtimeProv != nil {
				run.AddProvider(runtimeProv)
			}
			fmt.Fprintf(os.Stderr, "[oauth] github-copilot: connected via gh CLI token\n")
			return transport.Response{
				ID: req.ID, Success: true,
				Data: map[string]any{
					"provider": "github-copilot",
					"success":  true,
				},
			}

		case req.Type == "oauth.providers":
			authData, err := oauthStorage.Load()
			if err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
			}
			return transport.Response{
				ID: req.ID, Success: true,
				Data: map[string]any{
					"providers": oauthConnectedProviderEntries(authData, run.ListProviders()),
				},
			}

		case req.Type == "oauth.logout":
			var payload struct {
				Provider string `json:"provider"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if payload.Provider == "" {
				return transport.Response{ID: req.ID, Success: false, Error: "provider is required"}
			}
			if err := oauthStorage.Delete(payload.Provider); err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
			}
			if runtimeID := oauthRuntimeProviderID(payload.Provider); runtimeID != "" {
				run.RemoveProvider(runtimeID)
			}
			return transport.Response{
				ID: req.ID, Success: true,
				Data: map[string]any{"cleared": true},
			}

		case req.Type == "auth.oauth.status" || req.Type == "auth.anthropic.status":
			// Check if an Anthropic OAuth provider is loaded
			hasOAuth := false
			if authData, err := oauthStorage.Load(); err == nil {
				if cred := authData["anthropic"]; cred != nil && cred.Type == "oauth" && cred.Credentials != nil {
					hasOAuth = true
				}
			}
			if !hasOAuth {
				for _, p := range run.ListProviders() {
					if p["id"] == "anthropic-oauth" {
						hasOAuth = true
						break
					}
				}
			}
			return transport.Response{
				ID: req.ID, Success: true,
				Data: map[string]any{"authenticated": hasOAuth},
			}

		case req.Type == "auth.oauth.start" || req.Type == "auth.anthropic.start":
			var payload struct {
				ClientID    string `json:"client_id"`
				RedirectURI string `json:"redirect_uri"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if payload.ClientID == "" {
				payload.ClientID = provider.OpenCodeClientID
			}
			if payload.RedirectURI == "" {
				payload.RedirectURI = "http://localhost:14293/oauth/callback"
			}

			pkce, err := provider.GeneratePKCE()
			if err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
			}
			url := provider.GetAuthorizationURL(payload.ClientID, payload.RedirectURI, pkce)
			return transport.Response{
				ID: req.ID, Success: true,
				Data: map[string]any{
					"url":       url,
					"state":     pkce.Verifier,
					"verifier":  pkce.Verifier,
					"challenge": pkce.Challenge,
				},
			}

		case req.Type == "auth.oauth.exchange" || req.Type == "auth.anthropic.exchange":
			var payload struct {
				Code         string `json:"code"`
				State        string `json:"state"`
				ClientID     string `json:"client_id"`
				RedirectURI  string `json:"redirect_uri"`
				CodeVerifier string `json:"code_verifier"`
				Verifier     string `json:"verifier"` // frontend sends this name
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if payload.Code == "" {
				return transport.Response{ID: req.ID, Success: false, Error: "code is required"}
			}
			// Default client_id and redirect_uri
			if payload.ClientID == "" {
				payload.ClientID = provider.OpenCodeClientID
			}
			if payload.RedirectURI == "" {
				payload.RedirectURI = "http://localhost:14293/oauth/callback"
			}
			// Frontend sends "verifier", operator expects "code_verifier"
			if payload.CodeVerifier == "" && payload.Verifier != "" {
				payload.CodeVerifier = payload.Verifier
			}

			access, refresh, expiresIn, err := provider.ExchangeCode(
				payload.Code, payload.State, payload.ClientID,
				payload.RedirectURI, payload.CodeVerifier,
			)
			if err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
			}

			// Register the new OAuth provider
			oauthProv := provider.NewAnthropicOAuth(provider.OAuthConfig{
				AccessToken:  access,
				RefreshToken: refresh,
			})
			run.AddProvider(oauthProv)

			return transport.Response{
				ID: req.ID, Success: true,
				Data: map[string]any{
					"access_token":  access,
					"refresh_token": refresh,
					"expires_in":    expiresIn,
				},
			}

		case req.Type == "sessions.list":
			sessions := run.ListSessions()
			return transport.Response{
				ID: req.ID, Success: true,
				Data: map[string]any{"sessions": sessions, "count": len(sessions)},
			}

		case req.Type == "sessions.get":
			var payload struct {
				SessionID string `json:"session_id"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			sess, ok := run.GetSession(payload.SessionID)
			if !ok {
				return transport.Response{ID: req.ID, Success: false, Error: "session not found"}
			}
			return transport.Response{
				ID: req.ID, Success: true,
				Data: map[string]any{"session": sess},
			}

		case req.Type == "auth.anthropic.set_tokens":
			// Accept pre-exchanged tokens (from Tauri's oauth_exchange which has Cloudflare fallbacks)
			var payload struct {
				AccessToken  string `json:"access_token"`
				RefreshToken string `json:"refresh_token"`
				ExpiresIn    int    `json:"expires_in"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if payload.AccessToken == "" {
				return transport.Response{ID: req.ID, Success: false, Error: "access_token is required"}
			}
			oauthProv := provider.NewAnthropicOAuth(provider.OAuthConfig{
				AccessToken:  payload.AccessToken,
				RefreshToken: payload.RefreshToken,
			})
			if payload.ExpiresIn > 0 {
				oauthProv.SetTokens(payload.AccessToken, payload.RefreshToken, payload.ExpiresIn)
			}
			run.AddProvider(oauthProv)
			fmt.Fprintf(os.Stderr, "[operator] provider registered: anthropic-oauth (from frontend)\n")
			return transport.Response{
				ID: req.ID, Success: true,
				Data: map[string]any{"authenticated": true},
			}

		case req.Type == "auth.oauth.clear" || req.Type == "auth.anthropic.clear":
			// Remove the OAuth provider
			_ = oauthStorage.Delete("anthropic")
			run.RemoveProvider("anthropic-oauth")
			return transport.Response{
				ID: req.ID, Success: true,
				Data: map[string]any{"cleared": true},
			}

		case req.Type == "auth.openai.status":
			hasOpenAI := false
			if authData, err := oauthStorage.Load(); err == nil {
				if cred := authData["openai-codex"]; cred != nil && cred.Type == "oauth" && cred.Credentials != nil {
					hasOpenAI = true
				}
			}
			for _, p := range run.ListProviders() {
				if id, _ := p["id"].(string); id == "openai-oauth" || id == "openai" {
					hasOpenAI = true
					break
				}
			}
			return transport.Response{
				ID: req.ID, Success: true,
				Data: map[string]any{"authenticated": hasOpenAI},
			}

		case req.Type == "auth.openai.set_tokens":
			var payload struct {
				AccessToken  string `json:"access_token"`
				RefreshToken string `json:"refresh_token"`
				AccountID    string `json:"account_id"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if payload.AccessToken == "" {
				return transport.Response{ID: req.ID, Success: false, Error: "access_token is required"}
			}
			// Use Codex OAuth provider (routes through chatgpt.com/backend-api/codex)
			codexProv := provider.NewCodexOAuth(provider.CodexOAuthConfig{
				AccessToken:  payload.AccessToken,
				AccountID:    payload.AccountID,
				RefreshToken: payload.RefreshToken,
			})
			run.AddProvider(codexProv)
			fmt.Fprintf(os.Stderr, "[operator] provider registered: openai-oauth (Codex via chatgpt.com)\n")
			return transport.Response{
				ID: req.ID, Success: true,
				Data: map[string]any{"authenticated": true},
			}

		case req.Type == "auth.openai.start":
			return transport.Response{ID: req.ID, Success: false, Error: "Use 'Use Codex' button instead"}

		case req.Type == "auth.openai.exchange":
			return transport.Response{ID: req.ID, Success: false, Error: "Use 'Use Codex' button instead"}

		case req.Type == "auth.openai.clear":
			_ = oauthStorage.Delete("openai-codex")
			run.RemoveProvider("openai-oauth")
			run.RemoveProvider("openai")
			return transport.Response{
				ID: req.ID, Success: true,
				Data: map[string]any{"cleared": true},
			}

		// --- Tools ---

		case strings.HasPrefix(req.Type, "tool.") || req.Type == "tools.call":
			var payload struct {
				Name     string          `json:"name"`
				Input    string          `json:"input"`
				ToolCall json.RawMessage `json:"toolCall"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			// Support both direct tool.execute and tools.call (with nested toolCall)
			if payload.Name == "" && payload.ToolCall != nil {
				var tc struct {
					Function struct {
						Name      string `json:"name"`
						Arguments string `json:"arguments"`
					} `json:"function"`
				}
				json.Unmarshal(payload.ToolCall, &tc)
				payload.Name = tc.Function.Name
				payload.Input = tc.Function.Arguments
			}
			t, ok := tools.Get(payload.Name)
			if !ok {
				return transport.Response{ID: req.ID, Success: false, Error: "unknown tool: " + payload.Name}
			}
			// Pre-hooks (same safety checks as LLM-driven tool calls)
			if hookResult, err := hookReg.RunPre(reqCtx, payload.Name, payload.Input); err == nil && hookResult != nil && hookResult.Block {
				return transport.Response{ID: req.ID, Success: false, Error: fmt.Sprintf("blocked by hook: %s", hookResult.Message)}
			}
			result, err := t.Executor.Execute(reqCtx, payload.Input)
			if err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
			}
			// Post-hooks
			hookReg.RunPost(reqCtx, payload.Name, result.Content)
			return transport.Response{
				ID: req.ID, Success: true,
				Data: map[string]any{"content": result.Content, "is_error": result.IsError},
			}

		// --- MCP handlers ---
		case req.Type == "mcp.list":
			servers := listMCPServers()
			return transport.Response{
				ID: req.ID, Success: true,
				Data: map[string]any{"servers": servers, "count": len(servers)},
			}

		case req.Type == "mcp.enable":
			var payload struct {
				ID string `json:"id"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			info, ok := mcpClient.Get(payload.ID)
			if !ok {
				return transport.Response{ID: req.ID, Success: false, Error: "mcp server not found"}
			}
			info.Config.Enabled = true
			mcpClient.Add(info.Config)
			if err := stateStore.SetMCPState(state.MCPRuntimeState{ID: payload.ID, Enabled: true}); err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
			}
			if info.Config.Source == "user" {
				if err := persistUserMCPConfigs(); err != nil {
					return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
				}
			}
			serverID := payload.ID
			go func() {
				connectCtx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
				defer cancel()
				if err := mcpClient.Connect(connectCtx, serverID); err != nil {
					fmt.Fprintf(os.Stderr, "[mcp] background connect %s failed: %v\n", serverID, err)
					return
				}
				registerMCPServerTools(serverID)
				fmt.Fprintf(os.Stderr, "[mcp] %s connected and tools registered\n", serverID)
			}()
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true, "status": "connecting"}}

		case req.Type == "mcp.disable":
			var payload struct {
				ID string `json:"id"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			info, ok := mcpClient.Get(payload.ID)
			if !ok {
				return transport.Response{ID: req.ID, Success: false, Error: "mcp server not found"}
			}
			tools.RemoveBySource("mcp:" + payload.ID)
			mcpClient.Disconnect(payload.ID)
			info.Config.Enabled = false
			mcpClient.Add(info.Config)
			if err := stateStore.SetMCPState(state.MCPRuntimeState{ID: payload.ID, Enabled: false}); err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
			}
			if info.Config.Source == "user" {
				if err := persistUserMCPConfigs(); err != nil {
					return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
				}
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}

		case req.Type == "mcp.add":
			var payload struct {
				Type      string `json:"type"`
				Name      string `json:"name"`
				URL       string `json:"url"`
				Transport string `json:"transport"`
				Package   string `json:"package"`
				Path      string `json:"path"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			cfg := mcp.ServerConfig{
				Name:      strings.TrimSpace(payload.Name),
				Kind:      strings.TrimSpace(payload.Type),
				Package:   strings.TrimSpace(payload.Package),
				Path:      strings.TrimSpace(payload.Path),
				URL:       strings.TrimSpace(payload.URL),
				Transport: strings.TrimSpace(payload.Transport),
				Enabled:   true,
				Source:    "user",
			}
			switch cfg.Kind {
			case "url":
				if cfg.URL == "" {
					return transport.Response{ID: req.ID, Success: false, Error: "url is required"}
				}
				if cfg.Transport == "" {
					cfg.Transport = "http"
				}
				if cfg.Name == "" {
					cfg.Name = cfg.URL
				}
			case "npm":
				if cfg.Package == "" {
					return transport.Response{ID: req.ID, Success: false, Error: "package is required"}
				}
				cfg.Command = "npx"
				cfg.Args = []string{"-y", cfg.Package}
				cfg.Transport = "stdio"
				if cfg.Name == "" {
					cfg.Name = cfg.Package
				}
			case "local":
				if cfg.Path == "" {
					return transport.Response{ID: req.ID, Success: false, Error: "path is required"}
				}
				cfg.Command = cfg.Path
				cfg.Transport = "stdio"
				if cfg.Name == "" {
					cfg.Name = filepath.Base(cfg.Path)
				}
			default:
				return transport.Response{ID: req.ID, Success: false, Error: "unsupported mcp server type"}
			}
			idBase := strings.ToLower(cfg.Name)
			idBase = strings.ReplaceAll(idBase, " ", "-")
			idBase = strings.ReplaceAll(idBase, "/", "-")
			idBase = strings.Trim(idBase, "-")
			if idBase == "" {
				idBase = "mcp-server"
			}
			cfg.ID = idBase
			for i := 2; ; i++ {
				if _, exists := mcpClient.Get(cfg.ID); !exists {
					break
				}
				cfg.ID = fmt.Sprintf("%s-%d", idBase, i)
			}
			mcpClient.Add(cfg)
			if err := stateStore.SetMCPState(state.MCPRuntimeState{ID: cfg.ID, Enabled: true}); err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
			}
			if err := persistUserMCPConfigs(); err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
			}
			// Connect in background — don't block the request handler.
			// NPM servers can take a long time to install/start.
			serverID := cfg.ID
			go func() {
				connectCtx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
				defer cancel()
				if err := mcpClient.Connect(connectCtx, serverID); err != nil {
					fmt.Fprintf(os.Stderr, "[mcp] background connect %s failed: %v\n", serverID, err)
					return
				}
				registerMCPServerTools(serverID)
				fmt.Fprintf(os.Stderr, "[mcp] %s connected and tools registered\n", serverID)
			}()
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"id": cfg.ID, "status": "connecting"}}

		case req.Type == "mcp.remove":
			var payload struct {
				ID string `json:"id"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			info, ok := mcpClient.Get(payload.ID)
			if !ok {
				return transport.Response{ID: req.ID, Success: false, Error: "mcp server not found"}
			}
			if info.Config.Source != "user" {
				return transport.Response{ID: req.ID, Success: false, Error: "only user-managed MCP servers can be removed"}
			}
			tools.RemoveBySource("mcp:" + payload.ID)
			mcpClient.Remove(payload.ID)
			if err := stateStore.DeleteMCPState(payload.ID); err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
			}
			if err := persistUserMCPConfigs(); err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}

		case req.Type == "mcp.test":
			var payload struct {
				ID string `json:"id"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			info, ok := mcpClient.Get(payload.ID)
			if !ok {
				return transport.Response{ID: req.ID, Success: false, Error: "mcp server not found"}
			}
			if info.Status != "running" {
				if err := mcpClient.Connect(reqCtx, payload.ID); err != nil {
					return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
				}
				mcpClient.Disconnect(payload.ID)
				mcpClient.Add(info.Config)
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}

		// --- Skills and hooks ---

		case req.Type == "skills.list":
			hooksList := hookReg.List()
			skillsList := make([]map[string]any, 0, len(skillReg.All()))
			for _, s := range skillReg.All() {
				skillState, _ := skillReg.State(s.ID)
				stateLabel := "active"
				switch {
				case !skillState.Loaded:
					stateLabel = "unloaded"
				case !skillState.Enabled:
					stateLabel = "disabled"
				}
				hooksCount := 0
				for _, h := range hooksList {
					if h.SkillID == s.ID {
						hooksCount++
					}
				}
				item := map[string]any{
					"id":           s.ID,
					"name":         s.Name,
					"category":     s.Category,
					"description":  s.Description,
					"version":      "1.0.0",
					"state":        stateLabel,
					"dependencies": []string{},
					"hooksCount":   hooksCount,
					"toolsCount":   len(s.Tools),
				}
				if skillState.LoadedAt != "" {
					item["loadedAt"] = skillState.LoadedAt
				}
				skillsList = append(skillsList, item)
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"skills": skillsList}}

		case req.Type == "skills.get":
			var payload struct {
				ID string `json:"id"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			s, ok := skillReg.Get(payload.ID)
			if !ok {
				return transport.Response{ID: req.ID, Success: false, Error: "skill not found"}
			}
			skillState, _ := skillReg.State(s.ID)
			stateLabel := "active"
			switch {
			case !skillState.Loaded:
				stateLabel = "unloaded"
			case !skillState.Enabled:
				stateLabel = "disabled"
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{
				"skill": map[string]any{
					"id":           s.ID,
					"name":         s.Name,
					"category":     s.Category,
					"description":  s.Description,
					"version":      "1.0.0",
					"state":        stateLabel,
					"dependencies": []string{},
					"hooksCount":   0,
					"toolsCount":   len(s.Tools),
					"loadedAt":     skillState.LoadedAt,
				},
			}}

		case req.Type == "skills.load":
			var payload struct {
				ID string `json:"id"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if !skillReg.Load(payload.ID) {
				return transport.Response{ID: req.ID, Success: false, Error: "skill not found"}
			}
			skillState, _ := skillReg.State(payload.ID)
			if err := stateStore.SetSkillState(state.SkillRuntimeState{
				ID:        payload.ID,
				Loaded:    skillState.Loaded,
				Enabled:   skillState.Enabled,
				LoadedAt:  skillState.LoadedAt,
				UpdatedAt: skillState.UpdatedAt,
			}); err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}

		case req.Type == "skills.unload":
			var payload struct {
				ID string `json:"id"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if !skillReg.Unload(payload.ID) {
				return transport.Response{ID: req.ID, Success: false, Error: "skill not found"}
			}
			skillState, _ := skillReg.State(payload.ID)
			if err := stateStore.SetSkillState(state.SkillRuntimeState{
				ID:        payload.ID,
				Loaded:    skillState.Loaded,
				Enabled:   skillState.Enabled,
				LoadedAt:  skillState.LoadedAt,
				UpdatedAt: skillState.UpdatedAt,
			}); err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}

		case req.Type == "skills.enable":
			var payload struct {
				ID string `json:"id"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if !skillReg.Enable(payload.ID) {
				return transport.Response{ID: req.ID, Success: false, Error: "skill not found"}
			}
			skillState, _ := skillReg.State(payload.ID)
			if err := stateStore.SetSkillState(state.SkillRuntimeState{
				ID:        payload.ID,
				Loaded:    skillState.Loaded,
				Enabled:   skillState.Enabled,
				LoadedAt:  skillState.LoadedAt,
				UpdatedAt: skillState.UpdatedAt,
			}); err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}

		case req.Type == "skills.disable":
			var payload struct {
				ID string `json:"id"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if !skillReg.Disable(payload.ID) {
				return transport.Response{ID: req.ID, Success: false, Error: "skill not found"}
			}
			skillState, _ := skillReg.State(payload.ID)
			if err := stateStore.SetSkillState(state.SkillRuntimeState{
				ID:        payload.ID,
				Loaded:    skillState.Loaded,
				Enabled:   skillState.Enabled,
				LoadedAt:  skillState.LoadedAt,
				UpdatedAt: skillState.UpdatedAt,
			}); err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}

		case req.Type == "skills.load_builtins":
			for _, builtinID := range skill.BuiltinIDs() {
				skillReg.Enable(builtinID)
				skillState, _ := skillReg.State(builtinID)
				if err := stateStore.SetSkillState(state.SkillRuntimeState{
					ID:        builtinID,
					Loaded:    skillState.Loaded,
					Enabled:   skillState.Enabled,
					LoadedAt:  skillState.LoadedAt,
					UpdatedAt: skillState.UpdatedAt,
				}); err != nil {
					return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
				}
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}

		case req.Type == "skills.metrics":
			metrics := skillReg.Metrics()
			items := make([]map[string]any, 0, len(skillReg.All()))
			for _, s := range skillReg.All() {
				metric := metrics[s.ID]
				items = append(items, map[string]any{
					"skillId":       s.ID,
					"hooksExecuted": 0,
					"toolsExecuted": 0,
					"errorCount":    0,
					"totalDuration": 0,
					"lastUsed":      metric.LastUsed,
				})
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"metrics": items}}

		case req.Type == "skills.summaries":
			summaries := make([]map[string]any, 0, len(skillReg.All()))
			for _, s := range skillReg.All() {
				skillState, _ := skillReg.State(s.ID)
				summaries = append(summaries, map[string]any{
					"id":          s.ID,
					"name":        s.Name,
					"category":    s.Category,
					"description": s.Description,
					"keywords":    skillKeywords(s),
					"toolNames":   s.Tools,
					"hookTypes":   []string{},
					"isLoaded":    skillState.Loaded,
				})
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"summaries": summaries}}

		case req.Type == "skills.content":
			var payload struct {
				SkillID string `json:"skillId"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			s, ok := skillReg.Get(payload.SkillID)
			if !ok {
				return transport.Response{ID: req.ID, Success: false, Error: "skill not found"}
			}
			toolDefs := make([]map[string]any, 0, len(s.Tools))
			for _, toolName := range s.Tools {
				toolDef, ok := tools.Get(toolName)
				if !ok {
					continue
				}
				parameters := make([]map[string]any, 0)
				if schema, ok := toolDef.Def.InputSchema.(map[string]any); ok {
					properties, _ := schema["properties"].(map[string]any)
					required := make(map[string]bool)
					switch raw := schema["required"].(type) {
					case []any:
						for _, item := range raw {
							if name, ok := item.(string); ok {
								required[name] = true
							}
						}
					case []string:
						for _, name := range raw {
							required[name] = true
						}
					}
					for name, raw := range properties {
						prop, _ := raw.(map[string]any)
						param := map[string]any{
							"name":        name,
							"type":        prop["type"],
							"description": prop["description"],
							"required":    required[name],
						}
						if enumValues, ok := prop["enum"]; ok {
							param["enum"] = enumValues
						}
						parameters = append(parameters, param)
					}
				}
				toolDefs = append(toolDefs, map[string]any{
					"name":        toolDef.Def.Name,
					"description": toolDef.Def.Description,
					"parameters":  parameters,
					"action":      toolDef.Source,
					"config":      map[string]any{},
				})
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{
				"content": map[string]any{
					"id":           s.ID,
					"instructions": s.Prompt,
					"tools":        toolDefs,
					"hooks":        []map[string]any{},
					"settings":     map[string]any{},
					"examples":     []map[string]any{},
				},
			}}

		case req.Type == "skills.search":
			var payload struct {
				Query      string   `json:"query"`
				Categories []string `json:"categories"`
				Keywords   []string `json:"keywords"`
				HasTools   bool     `json:"hasTools"`
				HasHooks   bool     `json:"hasHooks"`
				Limit      int      `json:"limit"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			query := strings.ToLower(strings.TrimSpace(payload.Query))
			hooksList := hookReg.List()
			categorySet := map[string]bool{}
			for _, category := range payload.Categories {
				categorySet[strings.ToLower(category)] = true
			}
			matches := make([]map[string]any, 0)
			for _, s := range skillReg.All() {
				if len(categorySet) > 0 && !categorySet[strings.ToLower(s.Category)] {
					continue
				}
				if payload.HasTools && len(s.Tools) == 0 {
					continue
				}
				hookCount := 0
				for _, h := range hooksList {
					if h.SkillID == s.ID {
						hookCount++
					}
				}
				if payload.HasHooks && hookCount == 0 {
					continue
				}
				score := 0.0
				matchedOn := []string{}
				if query != "" {
					if strings.Contains(strings.ToLower(s.Name), query) {
						score += 3
						matchedOn = append(matchedOn, "name")
					}
					if strings.Contains(strings.ToLower(s.Description), query) {
						score += 2
						matchedOn = append(matchedOn, "description")
					}
					if strings.Contains(strings.ToLower(s.Prompt), query) {
						score += 1
						matchedOn = append(matchedOn, "instructions")
					}
					for _, keyword := range skillKeywords(s) {
						if strings.Contains(keyword, query) {
							score += 1
							matchedOn = append(matchedOn, "keywords")
							break
						}
					}
				}
				if len(payload.Keywords) > 0 {
					for _, keyword := range payload.Keywords {
						for _, existing := range skillKeywords(s) {
							if existing == strings.ToLower(keyword) {
								score += 1
								matchedOn = append(matchedOn, "keywords")
								break
							}
						}
					}
				}
				if score == 0 && query != "" {
					continue
				}
				skillState, _ := skillReg.State(s.ID)
				matches = append(matches, map[string]any{
					"skill": map[string]any{
						"id":          s.ID,
						"name":        s.Name,
						"category":    s.Category,
						"description": s.Description,
						"keywords":    skillKeywords(s),
						"toolNames":   s.Tools,
						"hookTypes":   []string{},
						"isLoaded":    skillState.Loaded,
					},
					"score":     score,
					"matchedOn": matchedOn,
					"reason":    "Matched against skill metadata and instructions",
				})
			}
			sort.Slice(matches, func(i, j int) bool {
				left, _ := matches[i]["score"].(float64)
				right, _ := matches[j]["score"].(float64)
				return left > right
			})
			totalCount := len(matches)
			if payload.Limit > 0 && len(matches) > payload.Limit {
				matches = matches[:payload.Limit]
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{
				"matches":    matches,
				"totalCount": totalCount,
				"query":      payload.Query,
			}}

		case req.Type == "skills.instructions":
			var payload struct {
				SkillID string `json:"skillId"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if payload.SkillID != "" {
				s, ok := skillReg.Get(payload.SkillID)
				if !ok {
					return transport.Response{ID: req.ID, Success: false, Error: "skill not found"}
				}
				return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"instructions": s.Prompt}}
			}
			parts := []string{}
			for _, s := range skillReg.All() {
				skillState, _ := skillReg.State(s.ID)
				if !skillState.Loaded || !skillState.Enabled {
					continue
				}
				parts = append(parts, fmt.Sprintf("## %s\n%s", s.Name, s.Prompt))
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"instructions": strings.Join(parts, "\n\n")}}

		case req.Type == "skills.format_for_ai":
			var payload struct {
				SkillID string `json:"skillId"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			s, ok := skillReg.Get(payload.SkillID)
			if !ok {
				return transport.Response{ID: req.ID, Success: false, Error: "skill not found"}
			}
			formatted := fmt.Sprintf("# Skill: %s\n\nDescription: %s\n\nCategory: %s\n\nTools: %s\n\nInstructions:\n%s",
				s.Name, s.Description, s.Category, strings.Join(s.Tools, ", "), s.Prompt)
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"formatted": formatted}}

		case req.Type == "hooks.list":
			items := make([]map[string]any, 0, len(hookReg.List()))
			for _, h := range hookReg.List() {
				items = append(items, map[string]any{
					"id":          h.ID,
					"name":        h.Name,
					"type":        hookTypeLabel(h.Type),
					"priority":    h.Priority,
					"skillId":     h.SkillID,
					"enabled":     hookReg.IsEnabled(h.ID),
					"description": h.Description,
				})
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"hooks": items}}

		case req.Type == "hooks.by_type":
			var payload struct {
				Type string `json:"type"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			items := make([]map[string]any, 0)
			for _, h := range hookReg.List() {
				label := hookTypeLabel(h.Type)
				if payload.Type != "" && !strings.HasPrefix(label, payload.Type) {
					continue
				}
				items = append(items, map[string]any{
					"id":          h.ID,
					"name":        h.Name,
					"type":        label,
					"priority":    h.Priority,
					"skillId":     h.SkillID,
					"enabled":     hookReg.IsEnabled(h.ID),
					"description": h.Description,
				})
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"hooks": items}}

		case req.Type == "hooks.enable":
			var payload struct {
				ID string `json:"id"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if !hookReg.SetEnabled(payload.ID, true) {
				return transport.Response{ID: req.ID, Success: false, Error: "hook not found"}
			}
			if err := stateStore.SetHookState(state.HookRuntimeState{ID: payload.ID, Enabled: true}); err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}

		case req.Type == "hooks.disable":
			var payload struct {
				ID string `json:"id"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if !hookReg.SetEnabled(payload.ID, false) {
				return transport.Response{ID: req.ID, Success: false, Error: "hook not found"}
			}
			if err := stateStore.SetHookState(state.HookRuntimeState{ID: payload.ID, Enabled: false}); err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}

		case req.Type == "hooks.metrics":
			metrics := hookReg.Metrics()
			items := make([]map[string]any, 0, len(hookReg.List()))
			for _, h := range hookReg.List() {
				metric := metrics[h.ID]
				items = append(items, map[string]any{
					"hookId":         h.ID,
					"executionCount": metric.ExecutionCount,
					"errorCount":     metric.ErrorCount,
					"avgDuration":    metric.AvgDuration,
					"lastExecuted":   metric.LastExecuted,
				})
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"metrics": items}}

		// --- Passthrough stubs for frontend requests still intentionally deferred ---

		case strings.HasPrefix(req.Type, "ai.conversations."),
			strings.HasPrefix(req.Type, "auth.set_api_base"),
			strings.HasPrefix(req.Type, "auth.sync_token"),
			req.Type == "system.check_update",
			req.Type == "system.apply_update":
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{}}

		// --- Chat Session Persistence ---

		case req.Type == "sessions.save":
			var payload struct {
				Session chatsession.Session `json:"session"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if payload.Session.ID == "" {
				return transport.Response{ID: req.ID, Success: false, Error: "session.id is required"}
			}
			if err := chatSessStore.Save(&payload.Session); err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}

		case req.Type == "sessions.load":
			var payload struct {
				ID string `json:"id"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if payload.ID == "" {
				return transport.Response{ID: req.ID, Success: false, Error: "id is required"}
			}
			sess, err := chatSessStore.Load(payload.ID)
			if err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"session": sess}}

		case req.Type == "sessions.chat_list":
			metas, err := chatSessStore.List()
			if err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{
				"sessions": metas, "count": len(metas),
			}}

		case req.Type == "sessions.delete":
			var payload struct {
				ID string `json:"id"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if payload.ID == "" {
				return transport.Response{ID: req.ID, Success: false, Error: "id is required"}
			}
			if err := chatSessStore.Delete(payload.ID); err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}

		case req.Type == "sessions.resume":
			var payload struct {
				AgentID   string `json:"agent_id"`
				ProjectID string `json:"project_id"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if payload.AgentID == "" {
				return transport.Response{ID: req.ID, Success: false, Error: "agent_id is required"}
			}
			sess, err := chatSessStore.FindByAgent(payload.AgentID, payload.ProjectID)
			if err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
			}
			if sess == nil {
				return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"session": nil}}
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"session": sess}}

		default:
			fmt.Fprintf(os.Stderr, "[operator] unknown request type: %s\n", req.Type)
			return transport.Response{ID: req.ID, Success: false, Error: "unknown request type: " + req.Type}
		}
	})

	fmt.Fprintf(os.Stderr, "[operator] v%s starting on :%s (workdir: %s)\n", Version, port, opRuntime.workDir)
	fmt.Fprintf(os.Stderr, "[operator] tools: %d registered\n", len(tools.All()))

	if err := srv.Serve(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "[operator] error: %v\n", err)
		os.Exit(1)
	}
}
