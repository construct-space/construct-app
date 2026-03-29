package bootstrap

import (
	"os"

	"construct-operator/internal/oauth"
	"construct-operator/internal/provider"
	"construct-operator/internal/provider/connectors"
)

type BootstrapConfig struct {
	Settings                      map[string]string
	Env                           map[string]string
	OAuthData                     oauth.StorageData
	IsDisconnected                func(string) bool
	NewAnthropicOAuthFromOpenCode func() (provider.Provider, error)
	NewOpenRouter                 func(string) provider.Provider
	Logf                          func(string, ...any)
}

type BootstrapResult struct {
	Providers         []provider.Provider
	ActiveProviderIDs map[string]bool
}

func Bootstrap(cfg BootstrapConfig) BootstrapResult {
	if cfg.IsDisconnected == nil {
		cfg.IsDisconnected = func(string) bool { return false }
	}
	if cfg.NewAnthropicOAuthFromOpenCode == nil {
		cfg.NewAnthropicOAuthFromOpenCode = func() (provider.Provider, error) {
			return connectors.NewAnthropicOAuthFromOpenCode()
		}
	}
	if cfg.NewOpenRouter == nil {
		cfg.NewOpenRouter = func(apiKey string) provider.Provider {
			return connectors.NewOpenRouter(apiKey)
		}
	}

	result := BootstrapResult{
		ActiveProviderIDs: map[string]bool{},
	}

	addProvider := func(prov provider.Provider, logLine string, args ...any) {
		if prov == nil {
			return
		}
		result.Providers = append(result.Providers, prov)
		result.ActiveProviderIDs[prov.ID()] = true
		if cfg.Logf != nil && logLine != "" {
			cfg.Logf(logLine, args...)
		}
	}

	// Anthropic OAuth — try OpenCode tokens first, then env vars.
	// Skip auto-discovery if user explicitly disconnected.
	if !cfg.IsDisconnected("anthropic") {
		if oauthProvider, err := cfg.NewAnthropicOAuthFromOpenCode(); err == nil {
			addProvider(oauthProvider, "[operator] provider: anthropic-oauth (opencode tokens)\n")
		}
	}
	if !result.ActiveProviderIDs["anthropic-oauth"] {
		if token := cfg.Env["ANTHROPIC_OAUTH_TOKEN"]; token != "" {
			addProvider(connectors.NewAnthropicOAuth(connectors.OAuthConfig{
				AccessToken:  token,
				RefreshToken: cfg.Env["ANTHROPIC_OAUTH_REFRESH"],
			}), "[operator] provider: anthropic-oauth (env)\n")
		}
	}

	if key := cfg.Env["DEEPSEEK_API_KEY"]; key != "" {
		addProvider(connectors.NewOpenAICompat(connectors.OpenAICompatConfig{
			Name: "DeepSeek", Key: "deepseek",
			BaseURL: "https://api.deepseek.com/v1", APIKey: key,
			Models: []string{"deepseek-chat", "deepseek-reasoner"},
		}), "[operator] provider: deepseek\n")
	} else if prov := FromSetting("provider_key:deepseek", cfg.Settings["provider_key:deepseek"]); prov != nil {
		addProvider(prov, "[operator] provider: deepseek (settings)\n")
	}

	if key := cfg.Env["MIMO_API_KEY"]; key != "" {
		addProvider(connectors.NewOpenAICompat(connectors.OpenAICompatConfig{
			Name: "MiMo", Key: "mimo",
			BaseURL: "https://api.xiaomimimo.com/v1", APIKey: key,
			Models: []string{"mimo-v2-flash"},
		}), "[operator] provider: mimo\n")
	} else if prov := FromSetting("provider_key:mimo", cfg.Settings["provider_key:mimo"]); prov != nil {
		addProvider(prov, "[operator] provider: mimo (settings)\n")
	}

	if key := cfg.Env["ZAI_API_KEY"]; key != "" {
		addProvider(connectors.NewOpenAICompat(connectors.OpenAICompatConfig{
			Name: "Z.ai", Key: "zai",
			BaseURL: "https://api.z.ai/api/coding/paas/v4", APIKey: key,
			Models: []string{"glm-5"},
		}), "[operator] provider: zai\n")
	} else if prov := FromSetting("provider_key:zai", cfg.Settings["provider_key:zai"]); prov != nil {
		addProvider(prov, "[operator] provider: zai (settings)\n")
	}

	// OpenAI API — only if user sets OPENAI_API_KEY.
	if key := cfg.Env["OPENAI_API_KEY"]; key != "" {
		addProvider(connectors.NewOpenAICompat(connectors.OpenAICompatConfig{
			Name: "OpenAI", Key: "openai",
			BaseURL: "https://api.openai.com/v1", APIKey: key,
			Models: []string{"gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o", "gpt-4o-mini", "o3", "o3-mini", "o4-mini"},
		}), "[operator] provider: openai (api key)\n")
	}

	if key := cfg.Env["XAI_API_KEY"]; key != "" {
		addProvider(connectors.NewOpenAICompat(connectors.OpenAICompatConfig{
			Name: "xAI", Key: "xai",
			BaseURL: "https://api.x.ai/v1", APIKey: key,
			Models: []string{"grok-3", "grok-3-mini"},
		}), "[operator] provider: xai\n")
	} else if prov := FromSetting("provider_key:xai", cfg.Settings["provider_key:xai"]); prov != nil {
		addProvider(prov, "[operator] provider: xai (settings)\n")
	}

	if key := cfg.Env["OPENROUTER_API_KEY"]; key != "" {
		orProv := cfg.NewOpenRouter(key)
		if orProv != nil {
			addProvider(orProv, "[operator] provider: openrouter (%d free models)\n", len(orProv.Models()))
		}
	} else if prov := FromSetting("provider_key:openrouter", cfg.Settings["provider_key:openrouter"]); prov != nil {
		addProvider(prov, "[operator] provider: openrouter (settings)\n")
	}

	appendOAuthRuntimeProviders(&result.Providers, result.ActiveProviderIDs, cfg.OAuthData)
	return result
}

func CurrentEnv() map[string]string {
	return map[string]string{
		"ANTHROPIC_OAUTH_REFRESH": os.Getenv("ANTHROPIC_OAUTH_REFRESH"),
		"ANTHROPIC_OAUTH_TOKEN":   os.Getenv("ANTHROPIC_OAUTH_TOKEN"),
		"DEEPSEEK_API_KEY":        os.Getenv("DEEPSEEK_API_KEY"),
		"MIMO_API_KEY":            os.Getenv("MIMO_API_KEY"),
		"OPENAI_API_KEY":          os.Getenv("OPENAI_API_KEY"),
		"OPENROUTER_API_KEY":      os.Getenv("OPENROUTER_API_KEY"),
		"XAI_API_KEY":             os.Getenv("XAI_API_KEY"),
		"ZAI_API_KEY":             os.Getenv("ZAI_API_KEY"),
	}
}
