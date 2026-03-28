package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"construct-operator/internal/mcp"
	"construct-operator/internal/oauth"
	"construct-operator/internal/provider"
)

type stubBootstrapProvider struct {
	id     string
	models []string
}

func (p stubBootstrapProvider) ID() string { return p.id }

func (p stubBootstrapProvider) Models() []string {
	return append([]string(nil), p.models...)
}

func (p stubBootstrapProvider) Complete(context.Context, *provider.Request) (*provider.Response, error) {
	return nil, nil
}

func (p stubBootstrapProvider) Stream(context.Context, *provider.Request) (<-chan provider.StreamEvent, error) {
	return nil, nil
}

func TestBootstrapProvidersPrefersEnvAndAppendsOAuthRuntimeProviders(t *testing.T) {
	result := bootstrapProviders(providerBootstrapConfig{
		settings: map[string]string{
			"provider_key:deepseek": "settings-deepseek",
			"provider_key:xai":      "settings-xai",
		},
		env: map[string]string{
			"DEEPSEEK_API_KEY": "env-deepseek",
			"OPENAI_API_KEY":   "env-openai",
		},
		oauthData: oauth.StorageData{
			"google-gemini-cli": &oauth.AuthCredential{
				Type: "oauth",
				Credentials: &oauth.Credentials{
					Access:  "access-token",
					Refresh: "refresh-token",
					Expires: 123456789,
					Extra: map[string]any{
						"projectId": "construct-project",
					},
				},
			},
		},
		isDisconnected: func(string) bool { return false },
		newAnthropicOAuthFromOpenCode: func() (provider.Provider, error) {
			return stubBootstrapProvider{id: "anthropic-oauth"}, nil
		},
		newOpenRouter: func(apiKey string) provider.Provider {
			t.Fatalf("unexpected openrouter provider construction for key %q", apiKey)
			return nil
		},
	})

	gotIDs := providerIDs(result.providers)
	wantIDs := []string{
		"anthropic-oauth",
		"deepseek",
		"openai",
		"xai",
		"google-gemini-cli",
	}
	if !reflect.DeepEqual(gotIDs, wantIDs) {
		t.Fatalf("provider order = %#v, want %#v", gotIDs, wantIDs)
	}

	for _, id := range wantIDs {
		if !result.activeProviderIDs[id] {
			t.Fatalf("activeProviderIDs[%q] = false, want true", id)
		}
	}
}

func TestMCPServerListShape(t *testing.T) {
	servers := listMCPServersFromInfos([]mcp.ServerInfo{
		{
			Config: mcp.ServerConfig{
				ID:        "builtin-a",
				Name:      "Builtin A",
				Transport: "stdio",
				Enabled:   true,
				Source:    "space:core",
			},
			Status: "running",
			Tools: []provider.ToolDef{
				{Name: "fetch_doc", Description: "Fetch a doc"},
			},
		},
		{
			Config: mcp.ServerConfig{
				ID:        "user-b",
				Name:      "User B",
				Kind:      "npm",
				Transport: "sse",
				Package:   "@construct/server-b",
				URL:       "https://example.test/sse",
				Enabled:   false,
				Source:    "user",
			},
			Status: "error",
			Error:  "connect failed",
		},
	})

	want := []map[string]any{
		{
			"id":        "builtin-a",
			"name":      "Builtin A",
			"type":      "builtin",
			"transport": "stdio",
			"package":   "",
			"path":      "",
			"url":       "",
			"enabled":   true,
			"status":    "running",
			"tools": []map[string]any{
				{"name": "fetch_doc", "description": "Fetch a doc"},
			},
			"error":  "",
			"source": "space:core",
		},
		{
			"id":        "user-b",
			"name":      "User B",
			"type":      "npm",
			"transport": "sse",
			"package":   "@construct/server-b",
			"path":      "",
			"url":       "https://example.test/sse",
			"enabled":   false,
			"status":    "error",
			"tools":     []map[string]any{},
			"error":     "connect failed",
			"source":    "user",
		},
	}
	if !reflect.DeepEqual(servers, want) {
		t.Fatalf("listMCPServersFromInfos() = %#v, want %#v", servers, want)
	}
}

func TestPersistUserMCPConfigsFiltersNonUserSources(t *testing.T) {
	tempDir := t.TempDir()
	configPath := filepath.Join(tempDir, "mcp.json")

	err := persistUserMCPConfigs(configPath, []mcp.ServerInfo{
		{
			Config: mcp.ServerConfig{
				ID:      "space-server",
				Name:    "Space Server",
				Type:    mcp.TypeStdio,
				Command: "/bin/space-server",
				Enabled: true,
				Source:  "space:design",
			},
		},
		{
			Config: mcp.ServerConfig{
				ID:      "user-server",
				Name:    "User Server",
				Type:    mcp.TypeURL,
				URL:     "https://example.test/mcp",
				Enabled: true,
				Source:  "user",
			},
		},
	})
	if err != nil {
		t.Fatalf("persistUserMCPConfigs() error = %v", err)
	}

	data, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("ReadFile(%q) error = %v", configPath, err)
	}

	var saved struct {
		Servers map[string]json.RawMessage `json:"mcpServers"`
	}
	if err := json.Unmarshal(data, &saved); err != nil {
		t.Fatalf("saved config JSON parse error = %v", err)
	}

	if len(saved.Servers) != 1 {
		t.Fatalf("saved %d servers, want 1", len(saved.Servers))
	}
	if _, ok := saved.Servers["user-server"]; !ok {
		t.Fatalf("saved config missing user-server: %s", string(data))
	}
	if _, ok := saved.Servers["space-server"]; ok {
		t.Fatalf("saved config unexpectedly included space-server: %s", string(data))
	}
}

func providerIDs(providers []provider.Provider) []string {
	ids := make([]string, 0, len(providers))
	for _, prov := range providers {
		ids = append(ids, prov.ID())
	}
	return ids
}
