package main

import (
	"sort"
	"strings"
	"time"

	"construct-operator/internal/oauth"
	"construct-operator/internal/provider"
	"construct-operator/internal/runner"
)

type oauthProviderDescriptor struct {
	ID        string
	Name      string
	Models    []string
	RuntimeID string
}

var oauthProviderDescriptors = map[string]oauthProviderDescriptor{
	"anthropic": {
		ID:        "anthropic",
		Name:      "Claude Pro/Max",
		Models:    []string{"claude-opus-4-6", "claude-sonnet-4-6", "claude-sonnet-4-5", "claude-haiku-4-5"},
		RuntimeID: "anthropic-oauth",
	},
	"openai-codex": {
		ID:        "openai-codex",
		Name:      "ChatGPT Plus/Pro",
		Models:    []string{"gpt-5.4", "gpt-5.3-codex", "gpt-5.2-codex", "gpt-5.1-codex", "gpt-5.1-codex-mini"},
		RuntimeID: "openai-oauth",
	},
	"github-copilot": {
		ID:        "github-copilot",
		Name:      "GitHub Copilot",
		Models:    []string{"claude-sonnet-4", "gpt-5.4", "gpt-4.1", "o3", "gemini-2.5-pro", "gemini-2.5-flash"},
		RuntimeID: "github-copilot",
	},
	"google-gemini-cli": {
		ID:        "google-gemini-cli",
		Name:      "Google Gemini CLI",
		Models:    []string{"gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash", "gemini-3-pro-preview", "gemini-3-flash-preview", "gemini-3.1-pro-preview"},
		RuntimeID: "google-gemini-cli",
	},
}

func oauthProviderDescriptorFor(id string) (oauthProviderDescriptor, bool) {
	desc, ok := oauthProviderDescriptors[id]
	return desc, ok
}

func oauthRuntimeProviderID(id string) string {
	desc, ok := oauthProviderDescriptorFor(id)
	if !ok {
		return ""
	}
	return desc.RuntimeID
}

func providerFromOAuthCredentials(providerID string, creds *oauth.Credentials) provider.Provider {
	if creds == nil {
		return nil
	}

	desc, _ := oauthProviderDescriptorFor(providerID)

	switch providerID {
	case "anthropic":
		return provider.NewAnthropicOAuth(provider.OAuthConfig{
			ClientID:     provider.OpenCodeClientID,
			AccessToken:  creds.Access,
			RefreshToken: creds.Refresh,
			ExpiresAt:    time.UnixMilli(creds.Expires),
		})
	case "openai-codex":
		accountID, _ := creds.Extra["accountId"].(string)
		return provider.NewCodexOAuth(provider.CodexOAuthConfig{
			AccessToken:  creds.Access,
			RefreshToken: creds.Refresh,
			AccountID:    accountID,
		})
	case "github-copilot":
		enterpriseDomain, _ := creds.Extra["enterpriseUrl"].(string)
		return provider.NewGitHubCopilotOAuth(provider.GitHubCopilotOAuthConfig{
			AccessToken:      creds.Access,
			RefreshToken:     creds.Refresh,
			EnterpriseDomain: enterpriseDomain,
			ExpiresAt:        time.UnixMilli(creds.Expires),
			Models:           desc.Models,
		})
	case "google-gemini-cli":
		projectID, _ := creds.Extra["projectId"].(string)
		if strings.TrimSpace(projectID) == "" {
			return nil
		}
		return provider.NewGoogleGeminiCLIOAuth(provider.GoogleGeminiCLIOAuthConfig{
			AccessToken:  creds.Access,
			RefreshToken: creds.Refresh,
			ProjectID:    projectID,
			ExpiresAt:    time.UnixMilli(creds.Expires),
			Models:       desc.Models,
		})
	default:
		return nil
	}
}

func appendOAuthRuntimeProviders(opts *[]runner.Option, existing map[string]bool, authData oauth.StorageData) {
	for providerID, cred := range authData {
		if cred == nil || cred.Type != "oauth" || cred.Credentials == nil {
			continue
		}
		runtimeID := oauthRuntimeProviderID(providerID)
		if runtimeID == "" || existing[runtimeID] {
			continue
		}
		if prov := providerFromOAuthCredentials(providerID, cred.Credentials); prov != nil {
			*opts = append(*opts, runner.WithProvider(prov))
			existing[prov.ID()] = true
		}
	}
}

func oauthConnectedProviderEntries(authData oauth.StorageData, runnerProviders []map[string]any) []map[string]any {
	activeIDs := make(map[string]bool, len(runnerProviders))
	for _, entry := range runnerProviders {
		if id, _ := entry["id"].(string); strings.TrimSpace(id) != "" {
			activeIDs[id] = true
		}
	}

	var entries []map[string]any
	for providerID, desc := range oauthProviderDescriptors {
		connected := false
		if cred := authData[providerID]; cred != nil && cred.Type == "oauth" && cred.Credentials != nil {
			connected = true
		}
		if !connected && desc.RuntimeID != "" && activeIDs[desc.RuntimeID] {
			connected = true
		}

		entry := map[string]any{
			"id":        desc.ID,
			"name":      desc.Name,
			"models":    append([]string(nil), desc.Models...),
			"connected": connected,
			"runtime":   desc.RuntimeID != "",
		}
		if cred := authData[providerID]; cred != nil && cred.Credentials != nil {
			if email, _ := cred.Credentials.Extra["email"].(string); strings.TrimSpace(email) != "" {
				entry["email"] = email
			}
		}
		if desc.RuntimeID != "" {
			entry["runtime_id"] = desc.RuntimeID
		}
		entries = append(entries, entry)
	}

	sort.Slice(entries, func(i, j int) bool {
		left, _ := entries[i]["id"].(string)
		right, _ := entries[j]["id"].(string)
		return left < right
	})
	return entries
}

func mergeRunnerProvidersWithOAuthProviders(runnerProviders []map[string]any, authData oauth.StorageData) []map[string]any {
	_ = authData
	merged := make([]map[string]any, 0, len(runnerProviders))

	for _, entry := range runnerProviders {
		merged = append(merged, entry)
	}
	return merged
}
