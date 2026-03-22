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
	"sync"
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
	"construct-operator/internal/plugin"
	"construct-operator/internal/provider"
	"construct-operator/internal/runner"
	"construct-operator/internal/session"
	"construct-operator/internal/skill"
	"construct-operator/internal/space"
	"construct-operator/internal/state"
	"construct-operator/internal/stream"
	"construct-operator/internal/tool"
	"construct-operator/internal/transport"
	"construct-operator/internal/vibe"
)

const Version = "0.7.0-beta.1"

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
	default:
		return ""
	}
}

func providerStatus(settings map[string]string) map[string]bool {
	result := map[string]bool{
		"deepseek": strings.TrimSpace(os.Getenv("DEEPSEEK_API_KEY")) != "",
		"mimo":     strings.TrimSpace(os.Getenv("MIMO_API_KEY")) != "",
		"xai":      strings.TrimSpace(os.Getenv("XAI_API_KEY")) != "",
		"zai":      strings.TrimSpace(os.Getenv("ZAI_API_KEY")) != "",
		"kimi":     false,
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

func mergeContextMaps(base, extra map[string]any) map[string]any {
	if len(base) == 0 && len(extra) == 0 {
		return nil
	}
	result := make(map[string]any, len(base)+len(extra))
	for key, value := range base {
		result[key] = value
	}
	for key, value := range extra {
		result[key] = value
	}
	return result
}

func localDataString(localData map[string]any, key string) string {
	if len(localData) == 0 {
		return ""
	}
	if value, ok := localData[key].(string); ok && strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	spaceContext, _ := localData["space_context"].(map[string]any)
	projectContext, _ := spaceContext["project"].(map[string]any)
	switch key {
	case "project_name":
		if value, ok := projectContext["name"].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	case "project_path":
		if value, ok := projectContext["localPath"].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func localDataProjectID(localData map[string]any) string {
	if len(localData) == 0 {
		return ""
	}
	for _, key := range []string{"project_id", "projectId"} {
		if value, ok := localData[key].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	if routeContext, _ := localData["route_context"].(map[string]any); routeContext != nil {
		if value, ok := routeContext["projectId"].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	if spaceContext, _ := localData["space_context"].(map[string]any); spaceContext != nil {
		if projectContext, _ := spaceContext["project"].(map[string]any); projectContext != nil {
			switch value := projectContext["id"].(type) {
			case string:
				return strings.TrimSpace(value)
			case int:
				if value > 0 {
					return fmt.Sprintf("%d", value)
				}
			case int64:
				if value > 0 {
					return fmt.Sprintf("%d", value)
				}
			case float64:
				if value > 0 {
					return fmt.Sprintf("%.0f", value)
				}
			}
		}
	}
	return ""
}

func projectContextFromLocalData(localData map[string]any) *runner.ProjectContext {
	if len(localData) == 0 {
		return nil
	}
	name := localDataString(localData, "project_name")
	path := localDataString(localData, "project_path")
	if name == "" && path == "" {
		return nil
	}
	return &runner.ProjectContext{
		Name:     name,
		RootPath: path,
	}
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

func intValue(value any) int {
	switch v := value.(type) {
	case int:
		return v
	case int64:
		return int(v)
	case float64:
		return int(v)
	default:
		return 0
	}
}

func looksLikeVibeToolDirective(content string) bool {
	normalized := strings.ToLower(strings.TrimSpace(content))
	if normalized == "" {
		return false
	}
	if !strings.Contains(normalized, "to=") && !strings.Contains(normalized, "tool:") && !strings.Contains(normalized, "function:") {
		return false
	}
	for _, name := range []string{
		"bash",
		"write_file",
		"edit_file",
		"read_file",
		"list_dir",
		"glob",
		"grep",
		"spawn_agent",
	} {
		aliases := []string{
			name,
			strings.ReplaceAll(name, "_", "-"),
			name + "_code",
			strings.ReplaceAll(name, "_", "") + "_code",
		}
		for _, alias := range aliases {
			if strings.Contains(normalized, "to="+alias) ||
				strings.Contains(normalized, "tool:"+alias) ||
				strings.Contains(normalized, "function:"+alias) {
				return true
			}
		}
	}
	return false
}

func vibeTurnProgressText(turn, _ int) string {
	if turn <= 0 {
		return "Getting oriented in the project"
	}
	phrases := []string{
		"Connecting the dots",
		"Tracing the current implementation",
		"Working through the next change",
		"Checking the relevant files",
		"Shaping the fix",
		"Making the next pass",
		"Refining the implementation",
		"Validating the approach",
	}
	return phrases[(turn-1)%len(phrases)]
}

func extractAbsolutePaths(text string) []string {
	if strings.TrimSpace(text) == "" {
		return nil
	}
	var paths []string
	seen := map[string]bool{}
	for index := 0; index < len(text); {
		switch text[index] {
		case '"', '\'', '`':
			quote := text[index]
			if index+1 < len(text) && text[index+1] == '/' {
				end := index + 2
				for end < len(text) && text[end] != quote {
					end++
				}
				candidate := strings.TrimSpace(text[index+1 : end])
				candidate = strings.TrimRight(candidate, ",;:)]}")
				if candidate != "" && filepath.IsAbs(candidate) && !seen[candidate] {
					seen[candidate] = true
					paths = append(paths, candidate)
				}
				index = end + 1
				continue
			}
		case '/':
			// Only treat as path if preceded by whitespace/start or quote — not mid-word like "dark/light"
			if index > 0 && text[index-1] != ' ' && text[index-1] != '\n' && text[index-1] != '\t' && text[index-1] != '"' && text[index-1] != '\'' && text[index-1] != '`' && text[index-1] != '(' && text[index-1] != '[' {
				index++
				continue
			}
			end := index + 1
			for end < len(text) {
				switch text[end] {
				case ' ', '\n', '\t', '\r', '"', '\'', '`', ',', ';', ':', ')', ']', '}':
					goto flushPath
				}
				end++
			}
		flushPath:
			candidate := strings.TrimSpace(text[index:end])
			candidate = strings.TrimRight(candidate, ",;:)]}")
			if candidate != "" && filepath.IsAbs(candidate) && !seen[candidate] {
				seen[candidate] = true
				paths = append(paths, candidate)
			}
			index = end
			continue
		}
		index++
	}
	return paths
}

func inferConstructProjectRoot(path string) string {
	clean := strings.TrimSpace(path)
	if clean == "" {
		return ""
	}
	clean = strings.TrimRight(clean, ",;:)]}")
	if !filepath.IsAbs(clean) {
		return ""
	}
	clean = filepath.Clean(clean)
	sep := string(filepath.Separator)
	for _, marker := range []string{sep + "docs" + sep, sep + "code" + sep, sep + ".construct" + sep} {
		if idx := strings.Index(clean, marker); idx > 0 {
			return clean[:idx]
		}
	}
	for _, suffix := range []string{sep + "docs", sep + "code", sep + ".construct"} {
		if strings.HasSuffix(clean, suffix) {
			return filepath.Dir(clean)
		}
	}
	projectConfigSuffix := filepath.Join(".construct", "project.json")
	if strings.HasSuffix(clean, projectConfigSuffix) {
		return filepath.Dir(filepath.Dir(clean))
	}
	return ""
}

func inferProjectContextFromToolEventData(data map[string]any) (string, string) {
	if len(data) == 0 {
		return "", ""
	}
	candidatePaths := []string{}
	addTextPaths := func(text string) {
		for _, candidate := range extractAbsolutePaths(text) {
			candidatePaths = append(candidatePaths, candidate)
		}
	}
	var walk func(value any)
	walk = func(value any) {
		switch typed := value.(type) {
		case map[string]any:
			for _, nested := range typed {
				walk(nested)
			}
		case []any:
			for _, nested := range typed {
				walk(nested)
			}
		case string:
			trimmed := strings.TrimSpace(typed)
			if trimmed == "" {
				return
			}
			if filepath.IsAbs(trimmed) {
				candidatePaths = append(candidatePaths, trimmed)
			}
			addTextPaths(trimmed)
			if strings.HasPrefix(trimmed, "{") {
				var parsed map[string]any
				if err := json.Unmarshal([]byte(trimmed), &parsed); err == nil {
					walk(parsed)
				}
			}
		}
	}
	walk(data["input"])
	walk(data["content"])

	for _, candidate := range candidatePaths {
		root := inferConstructProjectRoot(candidate)
		if root == "" {
			continue
		}
		return root, filepath.Base(root)
	}
	return "", ""
}

func pathExists(path string) bool {
	if strings.TrimSpace(path) == "" {
		return false
	}
	_, err := os.Stat(path)
	return err == nil
}

func extractBacktickClaims(content string) []string {
	if strings.TrimSpace(content) == "" {
		return nil
	}
	claims := []string{}
	seen := map[string]bool{}
	inBackticks := false
	start := 0
	for index, r := range content {
		if r != '`' {
			continue
		}
		if !inBackticks {
			inBackticks = true
			start = index + 1
			continue
		}
		candidate := strings.TrimSpace(content[start:index])
		inBackticks = false
		if candidate == "" || seen[candidate] {
			continue
		}
		seen[candidate] = true
		claims = append(claims, candidate)
	}
	return claims
}

func validateVibeCompletionClaims(sess *vibe.Session, content string) error {
	content = strings.TrimSpace(content)
	if content == "" {
		return nil
	}

	projectPath := strings.TrimSpace(sess.ProjectPath)
	if projectPath != "" && !pathExists(projectPath) {
		return fmt.Errorf("claimed project path does not exist: %s", projectPath)
	}

	seenPaths := map[string]bool{}
	pathsToCheck := []string{}
	addPath := func(candidate string) {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" || seenPaths[candidate] {
			return
		}
		seenPaths[candidate] = true
		pathsToCheck = append(pathsToCheck, candidate)
	}

	for _, candidate := range extractAbsolutePaths(content) {
		addPath(candidate)
	}

	for _, claim := range extractBacktickClaims(content) {
		if projectPath == "" {
			continue
		}
		if strings.Contains(claim, "&&") || strings.Contains(claim, "\n") || strings.Contains(claim, " ") {
			continue
		}
		if strings.HasPrefix(claim, "/") {
			addPath(claim)
			continue
		}
		if strings.HasPrefix(claim, "docs/") ||
			strings.HasPrefix(claim, "code/") ||
			strings.HasPrefix(claim, ".construct/") ||
			strings.HasSuffix(claim, ".md") ||
			strings.HasSuffix(claim, ".json") ||
			strings.HasSuffix(claim, ".vue") ||
			strings.HasSuffix(claim, ".css") {
			addPath(filepath.Join(projectPath, claim))
		}
	}

	for _, candidate := range pathsToCheck {
		if !pathExists(candidate) {
			return fmt.Errorf("claimed output does not exist: %s", candidate)
		}
	}

	return nil
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

	// Initialize data directory (~/Library/Application Support/Construct/)
	appdir.Init(isDev)

	// Desktop bridge client (operator → Tauri reverse bridge)
	// Token is passed via env by Tauri when spawning operator.
	var bridge *desktop.Client
	if token := os.Getenv("CONSTRUCT_BRIDGE_TOKEN"); token != "" {
		bridge = desktop.NewClient(token)
		fmt.Fprintf(os.Stderr, "[operator] desktop bridge: enabled (token len=%d)\n", len(token))
	} else {
		fmt.Fprintf(os.Stderr, "[operator] desktop bridge: disabled (no CONSTRUCT_BRIDGE_TOKEN)\n")
	}

	// Initialize session store (persistent to disk)
	sessStore := session.NewStore(appdir.SessionsDir())
	stateStore := state.NewStore(appdir.StateDir())
	vibeStore := vibe.NewStore(filepath.Join(appdir.Dir, "vibe-sessions"))
	chatSessStore := chatsession.NewStore(appdir.Dir)

	// Project context — tracked per connected Construct client instance.
	// Defined early so tools can resolve the active project for the requesting client.
	activeProjects := make(map[string]*runner.ProjectContext)
	clientContexts := make(map[string]*clientContextState)
	var projectMu sync.RWMutex
	clientKey := func(clientID string) string {
		if clientID == "" {
			return "default"
		}
		return clientID
	}

	getProjectDir := func(reqCtx context.Context) string {
		if override := projectOverrideFromContext(reqCtx); override != nil && override.RootPath != "" {
			return override.RootPath
		}
		clientID := clientKey(transport.ClientIDFromContext(reqCtx))
		projectMu.RLock()
		defer projectMu.RUnlock()
		if proj := activeProjects[clientID]; proj != nil && proj.RootPath != "" {
			return proj.RootPath
		}
		return workDir
	}

	getProjectContext := func(reqCtx context.Context) *runner.ProjectContext {
		if override := projectOverrideFromContext(reqCtx); override != nil {
			return override
		}
		clientID := clientKey(transport.ClientIDFromContext(reqCtx))
		projectMu.RLock()
		defer projectMu.RUnlock()
		return activeProjects[clientID]
	}

	getClientContext := func(reqCtx context.Context) *clientContextState {
		clientID := clientKey(transport.ClientIDFromContext(reqCtx))
		projectMu.RLock()
		defer projectMu.RUnlock()
		return clientContexts[clientID]
	}

	getRunnerContext := func(reqCtx context.Context) map[string]any {
		state := getClientContext(reqCtx)
		if state == nil {
			return nil
		}
		result := map[string]any{}
		if state.Mode != "" {
			result["mode"] = state.Mode
		}
		if len(state.Component) > 0 {
			result["component"] = cloneMap(state.Component)
		}
		if len(state.Selection) > 0 {
			result["selection"] = cloneMap(state.Selection)
		}
		if len(result) == 0 {
			return nil
		}
		return result
	}

	// Initialize providers (LLM-agnostic — add as many as you want)
	opts := []runner.Option{runner.WithSessionStore(sessStore)}
	oauthRegistry := oauth.NewRegistry()
	oauthStorage := oauth.NewStorageInDir(appdir.Dir)
	oauthData, _ := oauthStorage.Load()
	activeProviderIDs := map[string]bool{}
	var pendingDeviceFlowsMu sync.Mutex
	pendingDeviceFlows := map[string]*oauth.DeviceFlowState{}

	// Anthropic OAuth — try OpenCode tokens first, then env vars
	if oauthProvider, err := provider.NewAnthropicOAuthFromOpenCode(); err == nil {
		opts = append(opts, runner.WithProvider(oauthProvider))
		activeProviderIDs[oauthProvider.ID()] = true
		fmt.Fprintf(os.Stderr, "[operator] provider: anthropic-oauth (opencode tokens)\n")
	} else if token := os.Getenv("ANTHROPIC_OAUTH_TOKEN"); token != "" {
		envProv := provider.NewAnthropicOAuth(provider.OAuthConfig{
			AccessToken:  token,
			RefreshToken: os.Getenv("ANTHROPIC_OAUTH_REFRESH"),
		})
		opts = append(opts, runner.WithProvider(envProv))
		activeProviderIDs[envProv.ID()] = true
		fmt.Fprintf(os.Stderr, "[operator] provider: anthropic-oauth (env)\n")
	}
	if key := os.Getenv("DEEPSEEK_API_KEY"); key != "" {
		deepseekProv := provider.NewOpenAICompat(provider.OpenAICompatConfig{
			Name: "DeepSeek", Key: "deepseek",
			BaseURL: "https://api.deepseek.com/v1", APIKey: key,
			Models: []string{"deepseek-chat", "deepseek-reasoner"},
		})
		opts = append(opts, runner.WithProvider(deepseekProv))
		activeProviderIDs[deepseekProv.ID()] = true
		fmt.Fprintf(os.Stderr, "[operator] provider: deepseek\n")
	} else if prov := providerFromSetting("provider_key:deepseek", stateStore.Settings()["provider_key:deepseek"]); prov != nil {
		opts = append(opts, runner.WithProvider(prov))
		activeProviderIDs[prov.ID()] = true
		fmt.Fprintf(os.Stderr, "[operator] provider: deepseek (settings)\n")
	}
	if key := os.Getenv("MIMO_API_KEY"); key != "" {
		mimoProv := provider.NewOpenAICompat(provider.OpenAICompatConfig{
			Name: "MiMo", Key: "mimo",
			BaseURL: "https://api.xiaomimimo.com/v1", APIKey: key,
			Models: []string{"mimo-v2-flash"},
		})
		opts = append(opts, runner.WithProvider(mimoProv))
		activeProviderIDs[mimoProv.ID()] = true
		fmt.Fprintf(os.Stderr, "[operator] provider: mimo\n")
	} else if prov := providerFromSetting("provider_key:mimo", stateStore.Settings()["provider_key:mimo"]); prov != nil {
		opts = append(opts, runner.WithProvider(prov))
		activeProviderIDs[prov.ID()] = true
		fmt.Fprintf(os.Stderr, "[operator] provider: mimo (settings)\n")
	}
	if key := os.Getenv("ZAI_API_KEY"); key != "" {
		zaiProv := provider.NewOpenAICompat(provider.OpenAICompatConfig{
			Name: "Z.ai", Key: "zai",
			BaseURL: "https://api.z.ai/api/coding/paas/v4", APIKey: key,
			Models: []string{"glm-5"},
		})
		opts = append(opts, runner.WithProvider(zaiProv))
		activeProviderIDs[zaiProv.ID()] = true
		fmt.Fprintf(os.Stderr, "[operator] provider: zai\n")
	} else if prov := providerFromSetting("provider_key:zai", stateStore.Settings()["provider_key:zai"]); prov != nil {
		opts = append(opts, runner.WithProvider(prov))
		activeProviderIDs[prov.ID()] = true
		fmt.Fprintf(os.Stderr, "[operator] provider: zai (settings)\n")
	}
	// OpenAI Codex OAuth — chatgpt.com backend (gpt-5.x models via Codex CLI tokens)
	if codexProv := provider.NewCodexOAuthFromFile(); codexProv != nil {
		opts = append(opts, runner.WithProvider(codexProv))
		activeProviderIDs[codexProv.ID()] = true
		fmt.Fprintf(os.Stderr, "[operator] provider: openai-oauth (codex chatgpt.com)\n")
	}
	// OpenAI API — only if user sets OPENAI_API_KEY (separate from Codex)
	if key := os.Getenv("OPENAI_API_KEY"); key != "" {
		openaiProv := provider.NewOpenAICompat(provider.OpenAICompatConfig{
			Name: "OpenAI", Key: "openai",
			BaseURL: "https://api.openai.com/v1", APIKey: key,
			Models: []string{"gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o", "gpt-4o-mini", "o3", "o3-mini", "o4-mini"},
		})
		opts = append(opts, runner.WithProvider(openaiProv))
		activeProviderIDs[openaiProv.ID()] = true
		fmt.Fprintf(os.Stderr, "[operator] provider: openai (api key)\n")
	}
	if key := os.Getenv("XAI_API_KEY"); key != "" {
		xaiProv := provider.NewOpenAICompat(provider.OpenAICompatConfig{
			Name: "xAI", Key: "xai",
			BaseURL: "https://api.x.ai/v1", APIKey: key,
			Models: []string{"grok-3", "grok-3-mini"},
		})
		opts = append(opts, runner.WithProvider(xaiProv))
		activeProviderIDs[xaiProv.ID()] = true
		fmt.Fprintf(os.Stderr, "[operator] provider: xai\n")
	} else if prov := providerFromSetting("provider_key:xai", stateStore.Settings()["provider_key:xai"]); prov != nil {
		opts = append(opts, runner.WithProvider(prov))
		activeProviderIDs[prov.ID()] = true
		fmt.Fprintf(os.Stderr, "[operator] provider: xai (settings)\n")
	}

	appendOAuthRuntimeProviders(&opts, activeProviderIDs, oauthData)

	// Initialize tools — use dynamic workdir that follows the active project
	tools := tool.NewRegistry()
	tool.RegisterBuiltins(tools, getProjectDir)
	tool.RegisterBridgeTools(tools, bridge)
	tool.RegisterSpaceCLITools(tools, getProjectDir)

	// Project context tool — lets the agent discover the active project
	tools.Register(tool.Func("get_project_context",
		"Get information about the currently active project, including name, type, root path, framework, and available tools.",
		map[string]any{"type": "object", "properties": map[string]any{}},
		func(ctx context.Context, input string) (*tool.Result, error) {
			proj := getProjectContext(ctx)
			clientCtx := getClientContext(ctx)
			if proj == nil {
				home, _ := os.UserHomeDir()
				projectsRoot := filepath.Join(home, "ConstructProjects")
				content := "No project is currently active.\nProjects root: " + projectsRoot
				if clientCtx != nil && clientCtx.Mode != "" {
					content += "\nCurrent mode: " + clientCtx.Mode
				}
				content += "\nNew projects should be created under the projects root."
				return &tool.Result{Content: content}, nil
			}
			// List all available tools
			allTools := tools.All()
			toolNames := make([]string, len(allTools))
			for i, t := range allTools {
				toolNames[i] = t.Def.Name
			}
			result := fmt.Sprintf("Active Project:\n  Name: %s\n  Type: %s\n  Root: %s\n  Framework: %s",
				proj.Name, proj.Type, proj.RootPath, proj.Framework)
			if clientCtx != nil {
				if clientCtx.Mode != "" {
					result += "\n  Mode: " + clientCtx.Mode
				}
				if len(clientCtx.Component) > 0 {
					componentName := mapString(clientCtx.Component, "name")
					componentType := mapString(clientCtx.Component, "type")
					if componentName != "" {
						if componentType != "" {
							result += fmt.Sprintf("\n  Component: %s (%s)", componentName, componentType)
						} else {
							result += "\n  Component: " + componentName
						}
					}
				}
				if len(clientCtx.Selection) > 0 {
					if selectionType := mapString(clientCtx.Selection, "type"); selectionType != "" {
						result += "\n  Selection: " + selectionType
					}
				}
			}
			result += "\n\nAvailable tools: " + strings.Join(toolNames, ", ")
			return &tool.Result{Content: result}, nil
		},
	))

	// Load ALL agents from spaces — operator is space-agnostic.
	// Core agents — always available, cannot be uninstalled.
	// Space agents can extend or shadow these via "space:<id>" namespace.
	allAgents := coreAgents()
	fmt.Fprintf(os.Stderr, "[operator] loaded %d core agents: architect, vibe, project\n", len(allAgents))

	// Hook system — safety hooks first, then space + user hooks
	hookReg := hook.NewRegistry()
	hook.RegisterSafetyHooks(hookReg, getProjectDir)

	// Skill registry
	skillReg := skill.NewRegistry()

	// Plugin manager
	pluginMgr := plugin.NewManager()

	// Load spaces from all known directories
	spaceDirs := appdir.AllSpacesDirs()
	for _, dir := range spaceDirs {
		fmt.Fprintf(os.Stderr, "[operator] loading spaces from: %s\n", dir)
		spaceResults, err := space.LoadAll(dir, getProjectDir)
		if err != nil {
			fmt.Fprintf(os.Stderr, "[operator] warning: %s: %v\n", dir, err)
			continue
		}
		for _, sr := range spaceResults {
			for _, t := range sr.Tools {
				// Skip space tools that need the desktop bridge when it's not available
				if bridge == nil && isDesktopOnlySpaceTool(t.Def.Name) {
					continue
				}
				tools.Register(t)
			}
			for _, h := range sr.Hooks {
				hookReg.Register(h)
			}
			for _, s := range sr.Skills {
				skillReg.Register(s)
			}
			for _, p := range sr.Plugins {
				if err := pluginMgr.RegisterPlugin(p, tools, hookReg); err != nil {
					fmt.Fprintf(os.Stderr, "[operator] warning: %s plugin %s: %v\n", sr.SpaceID, p.ID, err)
				}
			}
			if sr.Agent != nil {
				allAgents = append(allAgents, sr.Agent)
				fmt.Fprintf(os.Stderr, "[operator] space: %s (agent: %s, tools: %d, hooks: %d, skills: %d, plugins: %d)\n",
					sr.SpaceID, sr.Agent.ID, len(sr.Tools), len(sr.Hooks), len(sr.Skills), len(sr.Plugins))
			}
		}
	}

	// Load user hook configs from data dir
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

	skill.RegisterBuiltins(skillReg)
	for _, builtinID := range skill.BuiltinIDs() {
		if saved, ok := stateStore.SkillStates()[builtinID]; ok {
			_ = skillReg.SetState(builtinID, skill.State{
				Loaded:    saved.Loaded,
				Enabled:   saved.Enabled,
				LoadedAt:  saved.LoadedAt,
				UpdatedAt: saved.UpdatedAt,
			})
			continue
		}
		skillReg.Unload(builtinID)
	}
	for id, saved := range stateStore.SkillStates() {
		_ = skillReg.SetState(id, skill.State{
			Loaded:    saved.Loaded,
			Enabled:   saved.Enabled,
			LoadedAt:  saved.LoadedAt,
			UpdatedAt: saved.UpdatedAt,
		})
	}
	for id, saved := range stateStore.HookStates() {
		if saved.Enabled {
			hookReg.SetEnabled(id, true)
		} else {
			hookReg.SetEnabled(id, false)
		}
	}
	fmt.Fprintf(os.Stderr, "[operator] hooks: %d registered, skills: %d, plugins: %d\n",
		len(hookReg.List()), len(skillReg.All()), len(pluginMgr.List()))

	// Load and connect MCP servers
	mcpConfigs := mcp.LoadAllConfigs(spaceDirs, appdir.Dir)
	for id, saved := range stateStore.MCPStates() {
		for i := range mcpConfigs {
			if mcpConfigs[i].ID == id {
				mcpConfigs[i].Enabled = saved.Enabled
			}
		}
	}
	mcpClient := mcp.NewClient()
	for _, cfg := range mcpConfigs {
		mcpClient.Add(cfg)
		if cfg.Enabled {
			if err := mcpClient.Connect(ctx, cfg.ID); err != nil {
				fmt.Fprintf(os.Stderr, "[operator] warning: mcp %s: %v\n", cfg.ID, err)
			}
		}
	}
	mcpClient.RegisterTools(tools)
	fmt.Fprintf(os.Stderr, "[operator] mcp configs: %d servers found\n", len(mcpConfigs))

	userMCPConfigPath := filepath.Join(appdir.Dir, "mcp.json")
	listMCPServers := func() []map[string]any {
		infos := mcpClient.List()
		servers := make([]map[string]any, 0, len(infos))
		for _, info := range infos {
			status := "stopped"
			switch info.Status {
			case "running":
				status = "running"
			case "error":
				status = "error"
			}
			toolsList := make([]map[string]any, 0, len(info.Tools))
			for _, toolDef := range info.Tools {
				toolsList = append(toolsList, map[string]any{
					"name":        toolDef.Name,
					"description": toolDef.Description,
				})
			}
			serverType := info.Config.Kind
			if serverType == "" {
				serverType = "builtin"
			}
			servers = append(servers, map[string]any{
				"id":        info.Config.ID,
				"name":      info.Config.Name,
				"type":      serverType,
				"transport": info.Config.Transport,
				"package":   info.Config.Package,
				"path":      info.Config.Path,
				"url":       info.Config.URL,
				"enabled":   info.Config.Enabled,
				"status":    status,
				"tools":     toolsList,
				"error":     info.Error,
				"source":    info.Config.Source,
			})
		}
		return servers
	}
	persistUserMCPConfigs := func() error {
		infos := mcpClient.List()
		configs := make([]mcp.ServerConfig, 0)
		for _, info := range infos {
			if info.Config.Source != "user" {
				continue
			}
			configs = append(configs, info.Config)
		}
		return mcp.SaveConfig(userMCPConfigPath, configs)
	}
	registerMCPServerTools := func(serverID string) {
		tools.RemoveBySource("mcp:" + serverID)
		mcpClient.RegisterServerTools(tools, serverID)
	}

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

	opts = append(opts, runner.WithTools(tools))
	opts = append(opts, runner.WithHooks(hookReg))
	opts = append(opts, runner.WithSkills(skillReg))

	// Resolve agent by ID — searches all loaded space agents, falls back to general
	resolveAgent := func(id string) *agent.Config {
		if id == "" {
			// Default: use vibe if loaded, else fallback
			for index := len(allAgents) - 1; index >= 0; index-- {
				a := allAgents[index]
				if a.ID == "space:vibe" || a.ID == "vibe" {
					return a
				}
			}
			return fallbackAgent
		}
		for index := len(allAgents) - 1; index >= 0; index-- {
			a := allAgents[index]
			if a.ID == id || a.ID == "space:"+id {
				return a
			}
		}
		if id == "general" {
			return fallbackAgent
		}
		return nil // Unknown agent — fail fast
	}

	// Wire agent resolver and spawn tool into runner
	opts = append(opts, runner.WithAgentResolver(resolveAgent))
	run := runner.New(opts...)

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
		switch {
		case req.Type == "agents.dispatch_stream":
			var payload struct {
				AgentID  string             `json:"agent_id"`
				Task     string             `json:"task"`
				Model    string             `json:"model,omitempty"`
				Messages []provider.Message `json:"messages,omitempty"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if payload.Task == "" {
				payload.Task = lastUserMessage(payload.Messages)
			}
			if payload.Task == "" {
				emit(transport.StreamChunk{ID: req.ID, Type: "error", Data: map[string]any{"error": "task is required"}, Done: true})
				return
			}

			agentCfg := resolveAgent(payload.AgentID)
			if agentCfg == nil {
				emit(transport.StreamChunk{ID: req.ID, Type: "error", Data: map[string]any{"error": "unknown agent: " + payload.AgentID}, Done: true})
				return
			}
			emitter := stream.NewEmitter()

			// Forward stream events to client — use a done channel to
			// drain all text events before sending the final "done" chunk.
			events := emitter.Subscribe()
			fwdDone := make(chan struct{})
			go func() {
				defer close(fwdDone)
				for ev := range events {
					emit(transport.StreamChunk{ID: req.ID, Type: ev.Type, Data: ev.Data})
				}
			}()

			result, err := run.Run(reqCtx, &runner.RunRequest{
				Agent:    agentCfg,
				Task:     payload.Task,
				Model:    payload.Model,
				Messages: payload.Messages,
				Context:  getRunnerContext(reqCtx),
				Stream:   emitter,
				Project:  getProjectContext(reqCtx),
			})

			// Close emitter and wait for all text events to be forwarded
			emitter.Close()
			<-fwdDone

			if err != nil {
				emit(transport.StreamChunk{ID: req.ID, Type: "error", Data: map[string]any{"error": err.Error()}, Done: true})
				return
			}

			emit(transport.StreamChunk{ID: req.ID, Type: "done", Data: map[string]any{
				"agent_id":    result.AgentID,
				"session_id":  result.SessionID,
				"content":     result.Content,
				"turns":       len(result.Turns),
				"stop_reason": result.StopReason,
				"usage": map[string]any{
					"input_tokens":  result.Usage.InputTokens,
					"output_tokens": result.Usage.OutputTokens,
				},
			}, Done: true})

		case req.Type == "ai.chat_stream":
			var payload struct {
				Message  string             `json:"message"`
				Model    string             `json:"model,omitempty"`
				Messages []provider.Message `json:"messages,omitempty"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if payload.Message == "" {
				payload.Message = lastUserMessage(payload.Messages)
			}
			if payload.Message == "" {
				emit(transport.StreamChunk{ID: req.ID, Type: "error", Data: map[string]any{"error": "message is required"}, Done: true})
				return
			}

			emitter := stream.NewEmitter()

			events := emitter.Subscribe()
			fwdDone := make(chan struct{})
			go func() {
				defer close(fwdDone)
				for ev := range events {
					emit(transport.StreamChunk{ID: req.ID, Type: ev.Type, Data: ev.Data})
				}
			}()

			result, err := run.Run(reqCtx, &runner.RunRequest{
				Agent:    resolveAgent(""),
				Task:     payload.Message,
				Model:    payload.Model,
				Messages: payload.Messages,
				Context:  getRunnerContext(reqCtx),
				Stream:   emitter,
				Project:  getProjectContext(reqCtx),
			})

			// Close emitter and wait for all text events to be forwarded
			emitter.Close()
			<-fwdDone

			if err != nil {
				emit(transport.StreamChunk{ID: req.ID, Type: "error", Data: map[string]any{"error": err.Error()}, Done: true})
				return
			}

			emit(transport.StreamChunk{ID: req.ID, Type: "done", Data: map[string]any{
				"content":     result.Content,
				"turns":       len(result.Turns),
				"stop_reason": result.StopReason,
			}, Done: true})

		case req.Type == "ai.vibe_stream":
			var payload struct {
				Messages      []provider.Message `json:"messages"`
				Model         string             `json:"model,omitempty"`
				Source        string             `json:"source,omitempty"`
				Goal          string             `json:"goal,omitempty"`
				SessionID     string             `json:"session_id,omitempty"`
				LocalData     map[string]any     `json:"local_data,omitempty"`
				MaxIterations int                `json:"max_iterations,omitempty"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}

			goal := strings.TrimSpace(payload.Goal)
			if goal == "" {
				goal = lastUserMessage(payload.Messages)
			}
			if goal == "" {
				emit(transport.StreamChunk{ID: req.ID, Type: "error", Data: map[string]any{"error": "goal is required"}, Done: true})
				return
			}

			agentCfg := resolveAgent("vibe")
			if agentCfg == nil {
				emit(transport.StreamChunk{ID: req.ID, Type: "error", Data: map[string]any{"error": "vibe agent not available"}, Done: true})
				return
			}

			projectCtx := getProjectContext(reqCtx)
			if override := projectContextFromLocalData(payload.LocalData); override != nil {
				projectCtx = override
				reqCtx = withProjectOverride(reqCtx, override)
			}

			runnerCtx := mergeContextMaps(getRunnerContext(reqCtx), payload.LocalData)
			projectID := localDataProjectID(payload.LocalData)
			source := strings.TrimSpace(payload.Source)
			if source == "" {
				source = "vibe"
			}

			var vibeSess *vibe.Session
			if payload.SessionID != "" {
				if existing, ok := vibeStore.Get(payload.SessionID); ok {
					vibeSess = existing
					// Resume existing session — follow-ups continue the same goal
					vibeSess.Status = "running"
					vibeStore.Update(vibeSess)
				}
			}
			if vibeSess == nil {
				vibeSess = vibeStore.Create(goal, projectID)
			}

			vibeSessionMu := sync.Mutex{}
			updateVibeSession := func(mutator func(*vibe.Session)) {
				vibeSessionMu.Lock()
				defer vibeSessionMu.Unlock()
				mutator(vibeSess)
				vibeStore.Update(vibeSess)
			}
			appendVibeEvent := func(eventType string, data map[string]any) {
				vibeStore.AppendEvent(vibeSess.ID, vibe.Event{
					EventType: eventType,
					Data:      data,
				})
			}
			emitVibeSession := func() {
				sessionData := map[string]any{
					"session_id": vibeSess.ID,
					"goal":       vibeSess.Goal,
					"source":     vibeSess.Source,
					"space":      "vibe",
					"status":     vibeSess.Status,
				}
				if vibeSess.ProjectID != "" {
					sessionData["project_id"] = vibeSess.ProjectID
				}
				if vibeSess.ProjectName != "" {
					sessionData["project_name"] = vibeSess.ProjectName
				}
				if vibeSess.ProjectPath != "" {
					sessionData["project_path"] = vibeSess.ProjectPath
				}
				if vibeSess.CurrentPhase != "" {
					sessionData["current_phase"] = vibeSess.CurrentPhase
				}
				emit(transport.StreamChunk{ID: req.ID, Type: "vibe.session", Data: sessionData})
				appendVibeEvent("vibe.session", sessionData)
			}
			maybeUpdateVibeProjectContext := func(data map[string]any) {
				projectPath, projectName := inferProjectContextFromToolEventData(data)
				if projectPath == "" {
					return
				}
				changed := false
				updateVibeSession(func(session *vibe.Session) {
					if strings.TrimSpace(session.ProjectPath) == "" {
						session.ProjectPath = projectPath
						changed = true
					}
					if strings.TrimSpace(session.ProjectName) == "" && strings.TrimSpace(projectName) != "" {
						session.ProjectName = projectName
						changed = true
					}
					// Derive project ID from path if not set (folder name slug)
					if strings.TrimSpace(session.ProjectID) == "" && session.ProjectPath != "" {
						dirName := filepath.Base(session.ProjectPath)
						if dirName != "" && dirName != "." && dirName != "/" {
							session.ProjectID = dirName
							changed = true
						}
					}
					if changed && session.Source != "architect" {
						session.SessionType = "new_feature"
					}
				})
				if changed {
					emitVibeSession()
				}
			}

			updateVibeSession(func(session *vibe.Session) {
				// Only set goal on first run, not on follow-ups
				if session.Goal == "" {
					session.Goal = goal
				}
				session.Source = source
				if session.ProjectID == "" {
					session.ProjectID = projectID
				}
				if name := localDataString(payload.LocalData, "project_name"); name != "" {
					session.ProjectName = name
				} else if projectCtx != nil && strings.TrimSpace(projectCtx.Name) != "" {
					session.ProjectName = strings.TrimSpace(projectCtx.Name)
				}
				if path := localDataString(payload.LocalData, "project_path"); path != "" {
					session.ProjectPath = path
				} else if projectCtx != nil && strings.TrimSpace(projectCtx.RootPath) != "" {
					session.ProjectPath = strings.TrimSpace(projectCtx.RootPath)
				}
				if session.Source == "architect" {
					session.SessionType = "new_project"
				} else if session.ProjectName != "" || session.ProjectPath != "" {
					session.SessionType = "new_feature"
				}
				if session.AutonomyLevel == "" {
					session.AutonomyLevel = "auto-until-checkpoint"
				}
				session.Status = "planning"
				session.CurrentPhase = "implement"
			})
			emitVibeSession()

			emitter := stream.NewEmitter()
			events := emitter.Subscribe()
			fwdDone := make(chan struct{})
			assistantTextMu := sync.Mutex{}
			assistantTextDelivered := false
			go func() {
				defer close(fwdDone)
				var assistantText strings.Builder
				flushAssistantText := func() {
					text := strings.TrimSpace(assistantText.String())
					assistantText.Reset()
					if text == "" || looksLikeVibeToolDirective(text) {
						return
					}
					assistantTextMu.Lock()
					assistantTextDelivered = true
					assistantTextMu.Unlock()
					emit(transport.StreamChunk{ID: req.ID, Type: "stream", Data: map[string]any{"text": text}})
				}
				clearAssistantText := func() {
					assistantText.Reset()
				}
				for ev := range events {
					switch ev.Type {
					case "text":
						text, _ := ev.Data["text"].(string)
						if strings.TrimSpace(text) == "" {
							continue
						}
						assistantText.WriteString(text)
					case "turn.start":
						clearAssistantText()
						turn := intValue(ev.Data["turn"])
						maxTurns := intValue(ev.Data["max_turns"])
						// Emit standard turn.start so frontend gets turn/maxTurns
						emit(transport.StreamChunk{ID: req.ID, Type: "turn.start", Data: ev.Data})
						// Also emit status for human-readable progress
						statusMsg := vibeTurnProgressText(turn, maxTurns)
						emit(transport.StreamChunk{ID: req.ID, Type: "status", Data: map[string]any{
							"state": "thinking", "message": statusMsg,
							"turn": turn, "max_turns": maxTurns,
						}})
						appendVibeEvent("status", map[string]any{"state": "thinking", "message": statusMsg})
						if turn == 0 {
							updateVibeSession(func(session *vibe.Session) {
								session.Status = "implementing"
								session.CurrentPhase = "implement"
							})
						}
					case "status":
						// Forward runner status events directly
						emit(transport.StreamChunk{ID: req.ID, Type: "status", Data: ev.Data})
					case "tool.call":
						maybeUpdateVibeProjectContext(ev.Data)
						// Emit standard tool.call (not tool_call)
						emit(transport.StreamChunk{ID: req.ID, Type: "tool.call", Data: ev.Data})
						appendVibeEvent("tool.call", ev.Data)
					case "tool.result":
						maybeUpdateVibeProjectContext(ev.Data)
						// Emit standard tool.result (not tool_result)
						emit(transport.StreamChunk{ID: req.ID, Type: "tool.result", Data: ev.Data})
						appendVibeEvent("tool.result", ev.Data)
					case "turn.end":
						if nudge, _ := ev.Data["nudge"].(bool); nudge {
							clearAssistantText()
							continue
						}
						if intValue(ev.Data["tool_calls"]) > 0 {
							clearAssistantText()
							continue
						}
						flushAssistantText()
					}
				}
				flushAssistantText()
			}()

			result, err := run.Run(reqCtx, &runner.RunRequest{
				Agent:    agentCfg,
				Task:     goal,
				Model:    payload.Model,
				Messages: payload.Messages,
				Context:  runnerCtx,
				Stream:   emitter,
				Project:  projectCtx,
				MaxTurns: payload.MaxIterations,
			})

			emitter.Close()
			<-fwdDone

			if err != nil {
				updateVibeSession(func(session *vibe.Session) {
					session.Status = "failed"
				})
				appendVibeEvent("session.failed", map[string]any{"error": err.Error()})
				emit(transport.StreamChunk{ID: req.ID, Type: "error", Data: map[string]any{"error": err.Error()}, Done: true})
				return
			}

			if validationErr := validateVibeCompletionClaims(vibeSess, result.Content); validationErr != nil {
				updateVibeSession(func(session *vibe.Session) {
					session.Status = "failed"
				})
				appendVibeEvent("session.failed", map[string]any{"error": validationErr.Error()})
				emit(transport.StreamChunk{ID: req.ID, Type: "error", Data: map[string]any{"error": validationErr.Error()}, Done: true})
				return
			}

			updateVibeSession(func(session *vibe.Session) {
				session.Status = "complete"
				session.CurrentPhase = "summarize"
			})

			assistantTextMu.Lock()
			needsFinalSummary := !assistantTextDelivered
			assistantTextMu.Unlock()
			if needsFinalSummary {
				if finalContent := strings.TrimSpace(result.Content); finalContent != "" && !looksLikeVibeToolDirective(finalContent) {
					emit(transport.StreamChunk{ID: req.ID, Type: "stream", Data: map[string]any{"text": finalContent}})
				}
			}

			completeData := map[string]any{
				"status":  "completed",
				"content": result.Content,
				"results": []map[string]any{},
			}
			emit(transport.StreamChunk{ID: req.ID, Type: "orchestration.complete", Data: completeData})
			appendVibeEvent("orchestration.complete", completeData)
			appendVibeEvent("session.completed", map[string]any{"content": result.Content})

			emit(transport.StreamChunk{ID: req.ID, Type: "done", Data: map[string]any{
				"agent_id":          result.AgentID,
				"session_id":        vibeSess.ID,
				"runner_session_id": result.SessionID,
				"content":           result.Content,
				"turns":             len(result.Turns),
				"stop_reason":       result.StopReason,
				"usage": map[string]any{
					"input_tokens":  result.Usage.InputTokens,
					"output_tokens": result.Usage.OutputTokens,
				},
			}, Done: true})

		default:
			emit(transport.StreamChunk{ID: req.ID, Type: "error", Data: map[string]any{"error": "unknown stream type: " + req.Type}, Done: true})
		}
	})

	srv.OnRequest(func(reqCtx context.Context, req transport.Request) transport.Response {
		switch {
		case req.Type == "system.ping":
			return transport.Response{
				ID: req.ID, Success: true,
				Data: map[string]any{"status": "ok", "version": Version},
			}

		case req.Type == "system.info":
			bridgeStatus := "disabled"
			if bridge != nil {
				if err := bridge.Ping(ctx); err == nil {
					bridgeStatus = "connected"
				} else {
					bridgeStatus = "unreachable"
				}
			}
			return transport.Response{
				ID: req.ID, Success: true,
				Data: map[string]any{
					"version":      Version,
					"workDir":      workDir,
					"bridgeStatus": bridgeStatus,
				},
			}

		case req.Type == "providers.list" || req.Type == "ai.providers":
			authData, _ := oauthStorage.Load()
			providerList := mergeRunnerProvidersWithOAuthProviders(run.ListProviders(), authData)
			return transport.Response{
				ID: req.ID, Success: true,
				Data: map[string]any{"providers": providerList},
			}

		case req.Type == "ai.models":
			// Flatten all provider models into a single list
			var models []map[string]string
			for _, p := range run.ListProviders() {
				if ms, ok := p["models"].([]map[string]string); ok {
					models = append(models, ms...)
				}
			}
			return transport.Response{
				ID: req.ID, Success: true,
				Data: map[string]any{"models": models},
			}

		case req.Type == "tools.list":
			allTools := tools.All()
			toolNames := make([]string, len(allTools))
			for i, t := range allTools {
				toolNames[i] = t.Def.Name
			}
			return transport.Response{
				ID: req.ID, Success: true,
				Data: map[string]any{"tools": toolNames, "count": len(toolNames)},
			}

		case req.Type == "agents.list":
			// Fully dynamic — all agents come from spaces
			agentList := make([]map[string]any, 0, len(allAgents)+1)
			agentList = append(agentList, map[string]any{
				"id": fallbackAgent.ID, "name": fallbackAgent.Name,
				"description": fallbackAgent.Description, "category": fallbackAgent.Category,
			})
			for _, a := range allAgents {
				agentList = append(agentList, map[string]any{
					"id": a.ID, "name": a.Name, "description": a.Description, "category": a.Category,
				})
			}
			return transport.Response{
				ID: req.ID, Success: true,
				Data: map[string]any{"agents": agentList, "count": len(agentList)},
			}

		case req.Type == "agents.dispatch" || req.Type == "agents.dispatch_stream":
			// Handle both sync and stream dispatch (stream falls back to sync here)
			var payload struct {
				AgentID  string             `json:"agent_id"`
				Task     string             `json:"task"`
				Model    string             `json:"model,omitempty"`
				Messages []provider.Message `json:"messages,omitempty"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if payload.Task == "" {
				payload.Task = lastUserMessage(payload.Messages)
			}
			if payload.Task == "" {
				return transport.Response{ID: req.ID, Success: false, Error: "task is required"}
			}

			agentCfg := resolveAgent(payload.AgentID)
			if agentCfg == nil {
				return transport.Response{ID: req.ID, Success: false, Error: "unknown agent: " + payload.AgentID}
			}
			result, err := run.Run(reqCtx, &runner.RunRequest{
				Agent:    agentCfg,
				Task:     payload.Task,
				Model:    payload.Model,
				Messages: payload.Messages,
				Context:  getRunnerContext(reqCtx),
				Project:  getProjectContext(reqCtx),
			})
			if err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
			}

			return transport.Response{
				ID: req.ID, Success: true,
				Data: map[string]any{
					"agent_id":   result.AgentID,
					"session_id": result.SessionID,
					"content":    result.Content,
					"turns":      len(result.Turns),
					"usage": map[string]any{
						"input_tokens":  result.Usage.InputTokens,
						"output_tokens": result.Usage.OutputTokens,
					},
					"stop_reason": result.StopReason,
				},
			}

		case req.Type == "ai.chat" || req.Type == "ai.chat_stream":
			var payload struct {
				Message  string             `json:"message"`
				Model    string             `json:"model,omitempty"`
				Messages []provider.Message `json:"messages,omitempty"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if payload.Message == "" {
				payload.Message = lastUserMessage(payload.Messages)
			}
			if payload.Message == "" {
				return transport.Response{ID: req.ID, Success: false, Error: "message is required"}
			}

			// Use general agent for chat
			result, err := run.Run(reqCtx, &runner.RunRequest{
				Agent:    resolveAgent(""),
				Task:     payload.Message,
				Model:    payload.Model,
				Messages: payload.Messages,
				Context:  getRunnerContext(reqCtx),
				Project:  getProjectContext(reqCtx),
			})
			if err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
			}

			return transport.Response{
				ID: req.ID, Success: true,
				Data: map[string]any{
					"content":     result.Content,
					"turns":       len(result.Turns),
					"stop_reason": result.StopReason,
				},
			}

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
				pendingDeviceFlowsMu.Lock()
				pendingDeviceFlows[payload.Provider] = state
				pendingDeviceFlowsMu.Unlock()

				fmt.Fprintf(os.Stderr, "[oauth] %s: device flow started, code: %s\n", payload.Provider, state.UserCode)
				return transport.Response{
					ID: req.ID, Success: true,
					Data: map[string]any{
						"provider":   payload.Provider,
						"device_code": true,
						"user_code":  state.UserCode,
						"url":        state.VerificationURI,
					},
				}
			}

			// Standard OAuth flow — opens browser, waits for callback
			var authURL string
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
					fmt.Fprintf(os.Stderr, "[oauth] %s: browser opened for login\n", payload.Provider)
					if info.Instructions != "" {
						fmt.Fprintf(os.Stderr, "[oauth] %s: %s\n", payload.Provider, info.Instructions)
					}
				},
				OnPrompt: func(prompt oauth.Prompt) (string, error) {
					if prompt.AllowEmpty {
						return "", nil
					}
					return "", fmt.Errorf("interactive prompt %q is not supported in desktop mode yet", prompt.Message)
				},
				OnProgress: func(message string) {
					fmt.Fprintf(os.Stderr, "[oauth] %s: %s\n", payload.Provider, message)
				},
			})
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
					"success":  true,
					"url":      authURL,
				},
			}

		case req.Type == "oauth.device-poll":
			var payload struct {
				Provider string `json:"provider"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}

			pendingDeviceFlowsMu.Lock()
			state, ok := pendingDeviceFlows[payload.Provider]
			pendingDeviceFlowsMu.Unlock()

			if !ok || state == nil {
				return transport.Response{ID: req.ID, Success: false, Error: "no pending device flow for " + payload.Provider}
			}

			// This blocks until user authorizes or timeout
			creds, err := oauth.CompleteCopilotDeviceFlow(state)

			// Clean up pending state
			pendingDeviceFlowsMu.Lock()
			delete(pendingDeviceFlows, payload.Provider)
			pendingDeviceFlowsMu.Unlock()

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

		// --- Project Context ---

		case req.Type == "context.set_project":
			var proj runner.ProjectContext
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &proj)
			}
			clientID := clientKey(req.ClientID)
			projectMu.Lock()
			activeProjects[clientID] = &proj
			projectMu.Unlock()
			fmt.Fprintf(os.Stderr, "[operator] project set (%s): %s (%s)\n", clientID, proj.Name, proj.RootPath)
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}

		case req.Type == "context.set_mode":
			var payload struct {
				Mode string `json:"mode"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			clientID := clientKey(req.ClientID)
			projectMu.Lock()
			state := clientContexts[clientID]
			if state == nil {
				state = &clientContextState{}
				clientContexts[clientID] = state
			}
			state.Mode = payload.Mode
			state.Timestamp = time.Now().UTC().Format(time.RFC3339)
			projectMu.Unlock()
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}

		case req.Type == "context.set_component":
			var payload map[string]any
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			clientID := clientKey(req.ClientID)
			projectMu.Lock()
			state := clientContexts[clientID]
			if state == nil {
				state = &clientContextState{}
				clientContexts[clientID] = state
			}
			state.Component = cloneMap(payload)
			state.Timestamp = time.Now().UTC().Format(time.RFC3339)
			projectMu.Unlock()
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}

		case req.Type == "context.set_selection":
			var payload map[string]any
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			clientID := clientKey(req.ClientID)
			projectMu.Lock()
			state := clientContexts[clientID]
			if state == nil {
				state = &clientContextState{}
				clientContexts[clientID] = state
			}
			state.Selection = cloneMap(payload)
			state.Timestamp = time.Now().UTC().Format(time.RFC3339)
			projectMu.Unlock()
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}

		case req.Type == "context.clear_project":
			clientID := clientKey(req.ClientID)
			projectMu.Lock()
			delete(activeProjects, clientID)
			projectMu.Unlock()
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}

		case req.Type == "context.get":
			proj := getProjectContext(reqCtx)
			clientCtx := getClientContext(reqCtx)
			data := map[string]any{
				"workDir":   getProjectDir(reqCtx),
				"mode":      "code",
				"timestamp": time.Now().UTC().Format(time.RFC3339),
			}
			if proj != nil {
				data["project"] = proj
			}
			if clientCtx != nil {
				if clientCtx.Mode != "" {
					data["mode"] = clientCtx.Mode
				}
				if len(clientCtx.Component) > 0 {
					data["component"] = cloneMap(clientCtx.Component)
				}
				if len(clientCtx.Selection) > 0 {
					data["selection"] = cloneMap(clientCtx.Selection)
				}
				if clientCtx.Timestamp != "" {
					data["timestamp"] = clientCtx.Timestamp
				}
			}
			return transport.Response{ID: req.ID, Success: true, Data: data}

		// --- Construct local state ---

		case req.Type == "storage.get":
			var payload struct {
				Key       string `json:"key"`
				Category  string `json:"category"`
				ProjectID *int   `json:"projectId"`
				UserID    string `json:"userId"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if payload.Key == "" {
				return transport.Response{ID: req.ID, Success: false, Error: "key is required"}
			}
			value, ok := stateStore.StorageGet(payload.Key, state.Scope{
				Category:  payload.Category,
				ProjectID: payload.ProjectID,
				UserID:    payload.UserID,
			})
			if !ok {
				return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"value": nil}}
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"value": value}}

		case req.Type == "storage.set":
			var payload struct {
				Key       string          `json:"key"`
				Value     json.RawMessage `json:"value"`
				Category  string          `json:"category"`
				ProjectID *int            `json:"projectId"`
				UserID    string          `json:"userId"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if payload.Key == "" {
				return transport.Response{ID: req.ID, Success: false, Error: "key is required"}
			}
			if err := stateStore.StorageSet(payload.Key, payload.Value, state.Scope{
				Category:  payload.Category,
				ProjectID: payload.ProjectID,
				UserID:    payload.UserID,
			}); err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}

		case req.Type == "storage.delete":
			var payload struct {
				Key       string `json:"key"`
				Category  string `json:"category"`
				ProjectID *int   `json:"projectId"`
				UserID    string `json:"userId"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if payload.Key == "" {
				return transport.Response{ID: req.ID, Success: false, Error: "key is required"}
			}
			var scope *state.Scope
			if payload.Category != "" || payload.ProjectID != nil || payload.UserID != "" {
				scope = &state.Scope{
					Category:  payload.Category,
					ProjectID: payload.ProjectID,
					UserID:    payload.UserID,
				}
			}
			if err := stateStore.StorageDelete(payload.Key, scope); err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}

		case req.Type == "storage.batch_get":
			var payload struct {
				Keys      []string `json:"keys"`
				Category  string   `json:"category"`
				ProjectID *int     `json:"projectId"`
				UserID    string   `json:"userId"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			items := stateStore.StorageBatchGet(payload.Keys, state.Scope{
				Category:  payload.Category,
				ProjectID: payload.ProjectID,
				UserID:    payload.UserID,
			})
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"items": items}}

		case req.Type == "storage.batch_set":
			var payload struct {
				Items     map[string]json.RawMessage `json:"items"`
				Category  string                     `json:"category"`
				ProjectID *int                       `json:"projectId"`
				UserID    string                     `json:"userId"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if err := stateStore.StorageBatchSet(payload.Items, state.Scope{
				Category:  payload.Category,
				ProjectID: payload.ProjectID,
				UserID:    payload.UserID,
			}); err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}

		case req.Type == "storage.list":
			var payload struct {
				Category  string `json:"category"`
				ProjectID *int   `json:"projectId"`
				UserID    string `json:"userId"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			entries := stateStore.StorageList(state.Scope{
				Category:  payload.Category,
				ProjectID: payload.ProjectID,
				UserID:    payload.UserID,
			})
			items := make([]map[string]any, 0, len(entries))
			for _, entry := range entries {
				items = append(items, map[string]any{
					"key":   entry.Key,
					"value": entry.Value,
				})
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"items": items}}

		case req.Type == "kv.get":
			var payload struct {
				Key      string `json:"key"`
				Category string `json:"category"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if payload.Key == "" {
				return transport.Response{ID: req.ID, Success: false, Error: "key is required"}
			}
			value, ok := stateStore.KVGet(payload.Key, payload.Category)
			if !ok {
				return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"value": nil}}
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"value": value}}

		case req.Type == "kv.set":
			var payload struct {
				Key      string `json:"key"`
				Value    string `json:"value"`
				Category string `json:"category"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if payload.Key == "" {
				return transport.Response{ID: req.ID, Success: false, Error: "key is required"}
			}
			if err := stateStore.KVSet(payload.Key, payload.Value, payload.Category); err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}

		case req.Type == "kv.delete":
			var payload struct {
				Key      string `json:"key"`
				Category string `json:"category"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if payload.Key == "" {
				return transport.Response{ID: req.ID, Success: false, Error: "key is required"}
			}
			if err := stateStore.KVDelete(payload.Key, payload.Category); err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}

		case req.Type == "kv.list":
			var payload struct {
				Category string `json:"category"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{
				"entries": stateStore.KVList(payload.Category),
			}}

		case req.Type == "settings.get":
			var payload struct {
				Key string `json:"key"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if payload.Key == "" {
				return transport.Response{ID: req.ID, Success: false, Error: "key is required"}
			}
			value, ok := stateStore.SettingGet(payload.Key)
			if !ok {
				return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"value": nil}}
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"value": value}}

		case req.Type == "settings.set":
			var payload struct {
				Key   string `json:"key"`
				Value string `json:"value"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if payload.Key == "" {
				return transport.Response{ID: req.ID, Success: false, Error: "key is required"}
			}
			if err := stateStore.SettingSet(payload.Key, payload.Value); err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
			}
			if envVar := providerEnvVarForSetting(payload.Key); envVar == "" || strings.TrimSpace(os.Getenv(envVar)) == "" {
				if prov := providerFromSetting(payload.Key, strings.TrimSpace(payload.Value)); prov != nil {
					run.AddProvider(prov)
				} else if providerID := providerIDForSetting(payload.Key); providerID != "" && strings.TrimSpace(payload.Value) == "" {
					run.RemoveProvider(providerID)
				}
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}

		case req.Type == "settings.provider_status":
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{
				"providers": providerStatus(stateStore.Settings()),
			}}

		case req.Type == "project_settings.get":
			var payload struct {
				ProjectID int `json:"projectId"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if payload.ProjectID == 0 {
				return transport.Response{ID: req.ID, Success: false, Error: "projectId is required"}
			}
			settings, ok := stateStore.ProjectSettingsGet(payload.ProjectID)
			if !ok {
				return transport.Response{ID: req.ID, Success: true, Data: nil}
			}
			return transport.Response{ID: req.ID, Success: true, Data: settings}

		case req.Type == "project_settings.set":
			var payload struct {
				ProjectID  int    `json:"projectId"`
				LocalPath  string `json:"localPath"`
				EditorPath string `json:"editorPath"`
				SyncedAt   string `json:"syncedAt"`
				UpdatedAt  string `json:"updatedAt"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if payload.ProjectID == 0 {
				return transport.Response{ID: req.ID, Success: false, Error: "projectId is required"}
			}
			if err := stateStore.ProjectSettingsSet(state.ProjectSettings{
				ProjectID:  payload.ProjectID,
				LocalPath:  payload.LocalPath,
				EditorPath: payload.EditorPath,
				SyncedAt:   payload.SyncedAt,
				UpdatedAt:  payload.UpdatedAt,
			}); err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}

		case req.Type == "pinned.list":
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{
				"items": stateStore.PinnedList(),
			}}

		case req.Type == "pinned.add":
			var payload state.PinnedItem
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if err := stateStore.PinnedAdd(payload); err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}

		case req.Type == "pinned.remove":
			var payload struct {
				ID string `json:"id"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if payload.ID == "" {
				return transport.Response{ID: req.ID, Success: false, Error: "id is required"}
			}
			if err := stateStore.PinnedRemove(payload.ID); err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}

		case req.Type == "pinned.reorder":
			var payload struct {
				Items []state.PinnedOrder `json:"items"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if err := stateStore.PinnedReorder(payload.Items); err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}

		case req.Type == "designs.list":
			var payload struct {
				ProjectID *int `json:"projectId"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			records := stateStore.DesignList(payload.ProjectID)
			designs := make([]map[string]any, 0, len(records))
			for _, record := range records {
				designs = append(designs, record.ResponseMap())
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"designs": designs}}

		case req.Type == "designs.get":
			var payload struct {
				LocalID string `json:"localId"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if payload.LocalID == "" {
				return transport.Response{ID: req.ID, Success: false, Error: "localId is required"}
			}
			record, ok := stateStore.DesignGet(payload.LocalID)
			if !ok {
				return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"design": nil}}
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"design": record.ResponseMap()}}

		case req.Type == "designs.save":
			var payload struct {
				LocalID        string          `json:"localId"`
				LocalIDSnake   string          `json:"local_id"`
				ProjectID      *int            `json:"projectId"`
				ProjectIDSnake *int            `json:"project_id"`
				Name           string          `json:"name"`
				NodesJSON      string          `json:"nodes_json"`
				PagesJSON      string          `json:"pages_json"`
				ViewportJSON   string          `json:"viewport_json"`
				HistoryJSON    string          `json:"history_json"`
				HistoryIndex   int             `json:"history_index"`
				SyncedAt       string          `json:"synced_at"`
				CreatedAt      string          `json:"created_at"`
				Nodes          json.RawMessage `json:"nodes"`
				Pages          json.RawMessage `json:"pages"`
				Viewport       json.RawMessage `json:"viewport"`
				History        json.RawMessage `json:"history"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			localID := payload.LocalID
			if localID == "" {
				localID = payload.LocalIDSnake
			}
			projectID := payload.ProjectID
			if projectID == nil {
				projectID = payload.ProjectIDSnake
			}
			nodesJSON := payload.NodesJSON
			if nodesJSON == "" && len(payload.Nodes) > 0 {
				nodesJSON = string(payload.Nodes)
			}
			pagesJSON := payload.PagesJSON
			if pagesJSON == "" && len(payload.Pages) > 0 {
				pagesJSON = string(payload.Pages)
			}
			viewportJSON := payload.ViewportJSON
			if viewportJSON == "" && len(payload.Viewport) > 0 {
				viewportJSON = string(payload.Viewport)
			}
			historyJSON := payload.HistoryJSON
			if historyJSON == "" && len(payload.History) > 0 {
				historyJSON = string(payload.History)
			}
			record, err := stateStore.DesignSave(state.DesignInput{
				LocalID:      localID,
				ProjectID:    projectID,
				Name:         payload.Name,
				NodesJSON:    nodesJSON,
				PagesJSON:    pagesJSON,
				ViewportJSON: viewportJSON,
				HistoryJSON:  historyJSON,
				HistoryIndex: payload.HistoryIndex,
				SyncedAt:     payload.SyncedAt,
				CreatedAt:    payload.CreatedAt,
			})
			if err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{
				"id":      record.ID,
				"localId": record.LocalID,
			}}

		case req.Type == "designs.delete":
			var payload struct {
				LocalID string `json:"localId"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if payload.LocalID == "" {
				return transport.Response{ID: req.ID, Success: false, Error: "localId is required"}
			}
			if err := stateStore.DesignDelete(payload.LocalID); err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}

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
			if err := mcpClient.Connect(reqCtx, payload.ID); err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
			}
			registerMCPServerTools(payload.ID)
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}

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
			if err := mcpClient.Connect(reqCtx, cfg.ID); err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
			}
			registerMCPServerTools(cfg.ID)
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"id": cfg.ID}}

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

		case req.Type == "vibe.session.list":
			var payload struct {
				ProjectID   string `json:"project_id"`
				ProjectPath string `json:"project_path"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			sessions := vibeStore.ListByIDOrPath(payload.ProjectID, payload.ProjectPath)
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"sessions": sessions}}

		case req.Type == "vibe.session.get":
			var payload struct {
				SessionID string `json:"session_id"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			sess, ok := vibeStore.Get(payload.SessionID)
			if !ok {
				return transport.Response{ID: req.ID, Success: false, Error: "session not found"}
			}
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{
				"session":     sess,
				"events":      sess.Events,
				"checkpoints": sess.Checkpoints,
			}}

		case req.Type == "vibe.session.delete":
			var payload struct {
				SessionID string `json:"session_id"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			if payload.SessionID == "" {
				return transport.Response{ID: req.ID, Success: false, Error: "session_id required"}
			}
			if err := vibeStore.Delete(payload.SessionID); err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
			}
			return transport.Response{ID: req.ID, Success: true}

		case req.Type == "vibe.session.create":
			var payload struct {
				Goal      string `json:"goal"`
				ProjectID string `json:"project_id"`
			}
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &payload)
			}
			sess := vibeStore.Create(payload.Goal, payload.ProjectID)
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"session": sess}}

		case req.Type == "vibe.session.update":
			var sess vibe.Session
			if req.Payload != nil {
				json.Unmarshal(req.Payload, &sess)
			}
			if sess.ID == "" {
				return transport.Response{ID: req.ID, Success: false, Error: "session id required"}
			}
			vibeStore.Update(&sess)
			return transport.Response{ID: req.ID, Success: true}

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

	fmt.Fprintf(os.Stderr, "[operator] v%s starting on :%s (workdir: %s)\n", Version, port, workDir)
	fmt.Fprintf(os.Stderr, "[operator] tools: %d registered\n", len(tools.All()))

	if err := srv.Serve(ctx); err != nil {
		fmt.Fprintf(os.Stderr, "[operator] error: %v\n", err)
		os.Exit(1)
	}
}
