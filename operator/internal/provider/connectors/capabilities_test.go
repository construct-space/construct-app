package connectors

import (
	"testing"

	"construct-operator/internal/provider"
)

// TestConnectorCapabilities verifies each connector correctly reports capabilities.
func TestConnectorCapabilities(t *testing.T) {
	tests := []struct {
		name     string
		provider provider.CapabilitiesProvider
		want     provider.Capabilities
	}{
		{
			name:     "anthropic",
			provider: NewAnthropic("test-key"),
			want: provider.Capabilities{
				SupportsStructuredOutput: true,
				SupportsTools:            true,
				SupportsStreaming:         true,
				MaxContextTokens:         200000,
			},
		},
		{
			name: "anthropic-oauth",
			provider: NewAnthropicOAuth(OAuthConfig{
				AccessToken: "test-token",
			}),
			want: provider.Capabilities{
				SupportsStructuredOutput: true,
				SupportsTools:            true,
				SupportsStreaming:         true,
				MaxContextTokens:         200000,
			},
		},
		{
			name: "openai-compat (deepseek)",
			provider: NewOpenAICompat(OpenAICompatConfig{
				Name: "DeepSeek", Key: "deepseek",
				BaseURL: "https://api.deepseek.com/v1",
				APIKey:  "test-key",
				Models:  []string{"deepseek-chat"},
			}),
			want: provider.Capabilities{
				SupportsStructuredOutput: true,
				SupportsTools:            true,
				SupportsStreaming:         true,
				MaxContextTokens:         128000,
			},
		},
		{
			name: "openai-codex",
			provider: NewCodexOAuth(CodexOAuthConfig{
				AccessToken: "test-token",
			}),
			want: provider.Capabilities{
				SupportsStructuredOutput: false,
				SupportsTools:            true,
				SupportsStreaming:         true,
				MaxContextTokens:         128000,
			},
		},
		{
			name: "github-copilot",
			provider: NewGitHubCopilotOAuth(GitHubCopilotOAuthConfig{
				AccessToken: "test-token",
			}),
			want: provider.Capabilities{
				SupportsStructuredOutput: false,
				SupportsTools:            true,
				SupportsStreaming:         true,
				MaxContextTokens:         128000,
			},
		},
		{
			name: "google-gemini-cli",
			provider: NewGoogleGeminiCLIOAuth(GoogleGeminiCLIOAuthConfig{
				AccessToken: "test-token",
			}),
			want: provider.Capabilities{
				SupportsStructuredOutput: true,
				SupportsTools:            true,
				SupportsStreaming:         true,
				MaxContextTokens:         1000000,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.provider.Capabilities()
			if got.SupportsStructuredOutput != tt.want.SupportsStructuredOutput {
				t.Errorf("SupportsStructuredOutput: got %v, want %v", got.SupportsStructuredOutput, tt.want.SupportsStructuredOutput)
			}
			if got.SupportsTools != tt.want.SupportsTools {
				t.Errorf("SupportsTools: got %v, want %v", got.SupportsTools, tt.want.SupportsTools)
			}
			if got.SupportsStreaming != tt.want.SupportsStreaming {
				t.Errorf("SupportsStreaming: got %v, want %v", got.SupportsStreaming, tt.want.SupportsStreaming)
			}
			if got.MaxContextTokens != tt.want.MaxContextTokens {
				t.Errorf("MaxContextTokens: got %d, want %d", got.MaxContextTokens, tt.want.MaxContextTokens)
			}
		})
	}
}

// TestAllConnectorsImplementCapabilities ensures each connector implements the interface.
func TestAllConnectorsImplementCapabilities(t *testing.T) {
	connectors := []struct {
		name     string
		provider provider.Provider
	}{
		{"anthropic", NewAnthropic("key")},
		{"anthropic-oauth", NewAnthropicOAuth(OAuthConfig{AccessToken: "tok"})},
		{"openai-compat", NewOpenAICompat(OpenAICompatConfig{Key: "test"})},
		{"openai-codex", NewCodexOAuth(CodexOAuthConfig{AccessToken: "tok"})},
		{"github-copilot", NewGitHubCopilotOAuth(GitHubCopilotOAuthConfig{AccessToken: "tok"})},
		{"google-gemini-cli", NewGoogleGeminiCLIOAuth(GoogleGeminiCLIOAuthConfig{AccessToken: "tok"})},
	}

	for _, c := range connectors {
		t.Run(c.name, func(t *testing.T) {
			if _, ok := c.provider.(provider.CapabilitiesProvider); !ok {
				t.Fatalf("%s does not implement CapabilitiesProvider", c.name)
			}
			if _, ok := c.provider.(provider.HealthChecker); !ok {
				t.Fatalf("%s does not implement HealthChecker", c.name)
			}
		})
	}
}

// TestTokenUsageParsing verifies that parseResponse correctly extracts usage info.
func TestAnthropicTokenUsageParsing(t *testing.T) {
	prov := NewAnthropic("test-key")
	resp, err := prov.parseResponse([]byte(`{
		"content": [{"type": "text", "text": "hello"}],
		"stop_reason": "end_turn",
		"usage": {
			"input_tokens": 100,
			"output_tokens": 50
		}
	}`))
	if err != nil {
		t.Fatalf("parseResponse failed: %v", err)
	}
	if resp.Usage.InputTokens != 100 {
		t.Fatalf("expected input_tokens=100, got %d", resp.Usage.InputTokens)
	}
	if resp.Usage.OutputTokens != 50 {
		t.Fatalf("expected output_tokens=50, got %d", resp.Usage.OutputTokens)
	}
}

func TestOpenAICompatTokenUsageParsing(t *testing.T) {
	prov := NewOpenAICompat(OpenAICompatConfig{Key: "test"})
	resp, err := prov.parseResponse([]byte(`{
		"choices": [{
			"message": {"content": "hi", "role": "assistant"},
			"finish_reason": "stop"
		}],
		"usage": {
			"prompt_tokens": 200,
			"completion_tokens": 75
		}
	}`))
	if err != nil {
		t.Fatalf("parseResponse failed: %v", err)
	}
	if resp.Usage.InputTokens != 200 {
		t.Fatalf("expected input_tokens=200, got %d", resp.Usage.InputTokens)
	}
	if resp.Usage.OutputTokens != 75 {
		t.Fatalf("expected output_tokens=75, got %d", resp.Usage.OutputTokens)
	}
}

func TestAnthropicOAuthTokenUsageParsing(t *testing.T) {
	prov := NewAnthropicOAuth(OAuthConfig{AccessToken: "test"})
	resp, err := prov.parseResponse([]byte(`{
		"content": [{"type": "text", "text": "world"}],
		"stop_reason": "end_turn",
		"usage": {
			"input_tokens": 150,
			"output_tokens": 80
		}
	}`))
	if err != nil {
		t.Fatalf("parseResponse failed: %v", err)
	}
	if resp.Usage.InputTokens != 150 {
		t.Fatalf("expected input_tokens=150, got %d", resp.Usage.InputTokens)
	}
	if resp.Usage.OutputTokens != 80 {
		t.Fatalf("expected output_tokens=80, got %d", resp.Usage.OutputTokens)
	}
}
