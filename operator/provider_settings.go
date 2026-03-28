package main

import (
	"os"
	"strings"

	"construct-operator/internal/provider"
)

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
