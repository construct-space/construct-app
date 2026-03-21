package provider

import "testing"

func TestSanitizeToolNameRoundTrip(t *testing.T) {
	tests := []struct {
		name string
	}{
		{name: "write_file"},
		{name: "space.snapshot"},
		{name: "mcp-github-list/files"},
		{name: "tool (preview)"},
		{name: "naive cafe"},
	}

	for _, tt := range tests {
		sanitized := SanitizeToolName(tt.name)
		if sanitized == "" {
			t.Fatalf("expected sanitized name for %q", tt.name)
		}
		for i := 0; i < len(sanitized); i++ {
			ch := sanitized[i]
			if !isAllowedToolNameChar(ch) {
				t.Fatalf("sanitized name %q contains invalid char %q", sanitized, ch)
			}
		}
		if got := UnsanitizeToolName(sanitized); got != tt.name {
			t.Fatalf("round-trip mismatch: got %q want %q", got, tt.name)
		}
	}
}

func TestAnthropicParseResponseUnsanitizesToolNames(t *testing.T) {
	prov := NewAnthropic("test-key")
	resp, err := prov.parseResponse([]byte(`{
		"content":[{"type":"tool_use","id":"call_1","name":"space__2e__snapshot","input":{"space_id":"project"}}],
		"stop_reason":"tool_use",
		"usage":{"input_tokens":1,"output_tokens":1}
	}`))
	if err != nil {
		t.Fatalf("parseResponse: %v", err)
	}
	if len(resp.ToolCalls) != 1 {
		t.Fatalf("expected 1 tool call, got %d", len(resp.ToolCalls))
	}
	if resp.ToolCalls[0].Name != "space.snapshot" {
		t.Fatalf("expected unsanitized name, got %q", resp.ToolCalls[0].Name)
	}
}

func TestAnthropicOAuthParseResponseStripsPrefixAndUnsanitizes(t *testing.T) {
	prov := NewAnthropicOAuth(OAuthConfig{AccessToken: "token"})
	resp, err := prov.parseResponse([]byte(`{
		"content":[{"type":"tool_use","id":"call_1","name":"mcp_space__2e__snapshot","input":{"space_id":"project"}}],
		"stop_reason":"tool_use",
		"usage":{"input_tokens":1,"output_tokens":1}
	}`))
	if err != nil {
		t.Fatalf("parseResponse: %v", err)
	}
	if len(resp.ToolCalls) != 1 {
		t.Fatalf("expected 1 tool call, got %d", len(resp.ToolCalls))
	}
	if resp.ToolCalls[0].Name != "space.snapshot" {
		t.Fatalf("expected OAuth tool name to round-trip, got %q", resp.ToolCalls[0].Name)
	}
}
