package main

import (
	"fmt"
	"os"

	"construct-operator/internal/oauth"
	"construct-operator/internal/provider"
)

type providerBootstrapConfig struct {
	settings                      map[string]string
	env                           map[string]string
	oauthData                     oauth.StorageData
	isDisconnected                func(string) bool
	newAnthropicOAuthFromOpenCode func() (provider.Provider, error)
	newOpenRouter                 func(string) provider.Provider
	logf                          func(string, ...any)
}

type providerBootstrapResult struct {
	providers         []provider.Provider
	activeProviderIDs map[string]bool
}

func bootstrapProviders(cfg providerBootstrapConfig) providerBootstrapResult {
	if cfg.isDisconnected == nil {
		cfg.isDisconnected = func(string) bool { return false }
	}
	if cfg.newAnthropicOAuthFromOpenCode == nil {
		cfg.newAnthropicOAuthFromOpenCode = func() (provider.Provider, error) {
			return provider.NewAnthropicOAuthFromOpenCode()
		}
	}
	if cfg.newOpenRouter == nil {
		cfg.newOpenRouter = func(apiKey string) provider.Provider {
			return provider.NewOpenRouter(apiKey)
		}
	}

	result := providerBootstrapResult{
		activeProviderIDs: map[string]bool{},
	}

	addProvider := func(prov provider.Provider, logLine string, args ...any) {
		if prov == nil {
			return
		}
		result.providers = append(result.providers, prov)
		result.activeProviderIDs[prov.ID()] = true
		if cfg.logf != nil && logLine != "" {
			cfg.logf(logLine, args...)
		}
	}

	// Anthropic OAuth — try OpenCode tokens first, then env vars.
	// Skip auto-discovery if user explicitly disconnected.
	if !cfg.isDisconnected("anthropic") {
		if oauthProvider, err := cfg.newAnthropicOAuthFromOpenCode(); err == nil {
			addProvider(oauthProvider, "[operator] provider: anthropic-oauth (opencode tokens)\n")
		}
	}
	if !result.activeProviderIDs["anthropic-oauth"] {
		if token := cfg.env["ANTHROPIC_OAUTH_TOKEN"]; token != "" {
			addProvider(provider.NewAnthropicOAuth(provider.OAuthConfig{
				AccessToken:  token,
				RefreshToken: cfg.env["ANTHROPIC_OAUTH_REFRESH"],
			}), "[operator] provider: anthropic-oauth (env)\n")
		}
	}

	if key := cfg.env["DEEPSEEK_API_KEY"]; key != "" {
		addProvider(provider.NewOpenAICompat(provider.OpenAICompatConfig{
			Name: "DeepSeek", Key: "deepseek",
			BaseURL: "https://api.deepseek.com/v1", APIKey: key,
			Models: []string{"deepseek-chat", "deepseek-reasoner"},
		}), "[operator] provider: deepseek\n")
	} else if prov := providerFromSetting("provider_key:deepseek", cfg.settings["provider_key:deepseek"]); prov != nil {
		addProvider(prov, "[operator] provider: deepseek (settings)\n")
	}

	if key := cfg.env["MIMO_API_KEY"]; key != "" {
		addProvider(provider.NewOpenAICompat(provider.OpenAICompatConfig{
			Name: "MiMo", Key: "mimo",
			BaseURL: "https://api.xiaomimimo.com/v1", APIKey: key,
			Models: []string{"mimo-v2-flash"},
		}), "[operator] provider: mimo\n")
	} else if prov := providerFromSetting("provider_key:mimo", cfg.settings["provider_key:mimo"]); prov != nil {
		addProvider(prov, "[operator] provider: mimo (settings)\n")
	}

	if key := cfg.env["ZAI_API_KEY"]; key != "" {
		addProvider(provider.NewOpenAICompat(provider.OpenAICompatConfig{
			Name: "Z.ai", Key: "zai",
			BaseURL: "https://api.z.ai/api/coding/paas/v4", APIKey: key,
			Models: []string{"glm-5"},
		}), "[operator] provider: zai\n")
	} else if prov := providerFromSetting("provider_key:zai", cfg.settings["provider_key:zai"]); prov != nil {
		addProvider(prov, "[operator] provider: zai (settings)\n")
	}

	// OpenAI API — only if user sets OPENAI_API_KEY.
	if key := cfg.env["OPENAI_API_KEY"]; key != "" {
		addProvider(provider.NewOpenAICompat(provider.OpenAICompatConfig{
			Name: "OpenAI", Key: "openai",
			BaseURL: "https://api.openai.com/v1", APIKey: key,
			Models: []string{"gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o", "gpt-4o-mini", "o3", "o3-mini", "o4-mini"},
		}), "[operator] provider: openai (api key)\n")
	}

	if key := cfg.env["XAI_API_KEY"]; key != "" {
		addProvider(provider.NewOpenAICompat(provider.OpenAICompatConfig{
			Name: "xAI", Key: "xai",
			BaseURL: "https://api.x.ai/v1", APIKey: key,
			Models: []string{"grok-3", "grok-3-mini"},
		}), "[operator] provider: xai\n")
	} else if prov := providerFromSetting("provider_key:xai", cfg.settings["provider_key:xai"]); prov != nil {
		addProvider(prov, "[operator] provider: xai (settings)\n")
	}

	if key := cfg.env["OPENROUTER_API_KEY"]; key != "" {
		orProv := cfg.newOpenRouter(key)
		if orProv != nil {
			addProvider(orProv, "[operator] provider: openrouter (%d free models)\n", len(orProv.Models()))
		}
	} else if prov := providerFromSetting("provider_key:openrouter", cfg.settings["provider_key:openrouter"]); prov != nil {
		addProvider(prov, "[operator] provider: openrouter (settings)\n")
	}

	appendOAuthRuntimeProviders(&result.providers, result.activeProviderIDs, cfg.oauthData)
	return result
}

func currentProviderEnv() map[string]string {
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

func operatorBootstrapLogger(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format, args...)
}
