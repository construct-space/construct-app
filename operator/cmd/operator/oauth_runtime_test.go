package main

import (
	"testing"
	"time"

	"construct-operator/internal/oauth"
)

func TestProviderFromOAuthCredentialsSupportedProviders(t *testing.T) {
	creds := &oauth.Credentials{
		Access:  "access-token",
		Refresh: "refresh-token",
		Expires: time.Now().Add(time.Hour).UnixMilli(),
	}

	anthropicProv := providerFromOAuthCredentials("anthropic", creds)
	if anthropicProv == nil {
		t.Fatal("expected anthropic runtime provider")
	}
	if anthropicProv.ID() != "anthropic-oauth" {
		t.Fatalf("expected anthropic runtime provider id, got %q", anthropicProv.ID())
	}

	codexProv := providerFromOAuthCredentials("openai-codex", creds)
	if codexProv == nil {
		t.Fatal("expected openai codex runtime provider")
	}
	if codexProv.ID() != "openai-oauth" {
		t.Fatalf("expected openai runtime provider id, got %q", codexProv.ID())
	}

	githubCreds := &oauth.Credentials{
		Access:  "tid=test;exp=9999999999;proxy-ep=proxy.individual.githubcopilot.com;",
		Refresh: "github-refresh-token",
		Expires: time.Now().Add(time.Hour).UnixMilli(),
	}
	githubProv := providerFromOAuthCredentials("github-copilot", githubCreds)
	if githubProv == nil {
		t.Fatal("expected github copilot runtime provider")
	}
	if githubProv.ID() != "github-copilot" {
		t.Fatalf("expected github runtime provider id, got %q", githubProv.ID())
	}

	geminiCreds := &oauth.Credentials{
		Access:  "google-access-token",
		Refresh: "google-refresh-token",
		Expires: time.Now().Add(time.Hour).UnixMilli(),
		Extra: map[string]any{
			"projectId": "test-project",
		},
	}
	geminiProv := providerFromOAuthCredentials("google-gemini-cli", geminiCreds)
	if geminiProv == nil {
		t.Fatal("expected google gemini runtime provider")
	}
	if geminiProv.ID() != "google-gemini-cli" {
		t.Fatalf("expected google gemini runtime provider id, got %q", geminiProv.ID())
	}
}

func TestMergeRunnerProvidersWithOAuthProvidersSkipsStoredProvidersWithoutRuntime(t *testing.T) {
	runnerProviders := []map[string]any{
		{
			"id":    "anthropic-oauth",
			"label": "anthropic-oauth",
			"models": []map[string]string{
				{"id": "claude-sonnet-4-6", "label": "claude-sonnet-4-6"},
			},
		},
	}
	authData := oauth.StorageData{
		"anthropic": {
			Type: "oauth",
			Credentials: &oauth.Credentials{
				Access: "a", Refresh: "r", Expires: time.Now().Add(time.Hour).UnixMilli(),
			},
		},
		"github-copilot": {
			Type: "oauth",
			Credentials: &oauth.Credentials{
				Access: "a", Refresh: "r", Expires: time.Now().Add(time.Hour).UnixMilli(),
			},
		},
		"google-gemini-cli": {
			Type: "oauth",
			Credentials: &oauth.Credentials{
				Access: "a", Refresh: "r", Expires: time.Now().Add(time.Hour).UnixMilli(),
			},
		},
	}

	merged := mergeRunnerProvidersWithOAuthProviders(runnerProviders, authData)
	if len(merged) != 1 {
		t.Fatalf("expected only live runtime providers, got %d", len(merged))
	}

	seen := map[string]bool{}
	for _, entry := range merged {
		id, _ := entry["id"].(string)
		seen[id] = true
	}

	if !seen["anthropic-oauth"] {
		t.Fatal("expected anthropic-oauth provider to remain in merged list")
	}
	if seen["github-copilot"] {
		t.Fatal("did not expect github-copilot without a registered runtime provider")
	}
	if seen["google-gemini-cli"] {
		t.Fatal("did not expect google-gemini-cli without a registered runtime provider")
	}
	if seen["anthropic"] {
		t.Fatal("did not expect duplicate anthropic storage entry when runtime provider is already active")
	}
}

func TestOAuthConnectedProviderEntriesMarksStoredAndRuntimeProviders(t *testing.T) {
	runnerProviders := []map[string]any{
		{"id": "openai-oauth"},
	}
	authData := oauth.StorageData{
		"github-copilot": {
			Type: "oauth",
			Credentials: &oauth.Credentials{
				Access: "a", Refresh: "r", Expires: time.Now().Add(time.Hour).UnixMilli(),
			},
		},
		"google-gemini-cli": {
			Type: "oauth",
			Credentials: &oauth.Credentials{
				Access: "a", Refresh: "r", Expires: time.Now().Add(time.Hour).UnixMilli(),
				Extra: map[string]any{
					"email": "person@example.com",
				},
			},
		},
	}

	entries := oauthConnectedProviderEntries(authData, runnerProviders)
	if len(entries) != len(oauthProviderDescriptors) {
		t.Fatalf("expected one entry per oauth provider descriptor, got %d", len(entries))
	}

	byID := map[string]map[string]any{}
	for _, entry := range entries {
		id, _ := entry["id"].(string)
		byID[id] = entry
	}

	if connected, _ := byID["openai-codex"]["connected"].(bool); !connected {
		t.Fatal("expected openai-codex to be connected from active runtime provider")
	}
	if connected, _ := byID["github-copilot"]["connected"].(bool); !connected {
		t.Fatal("expected github-copilot to be connected from stored oauth credentials")
	}
	if email, _ := byID["google-gemini-cli"]["email"].(string); email != "person@example.com" {
		t.Fatalf("expected google-gemini-cli email to be exposed, got %q", email)
	}
	if connected, _ := byID["anthropic"]["connected"].(bool); connected {
		t.Fatal("expected anthropic to be disconnected without storage or runtime provider")
	}
}
