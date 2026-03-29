package connectors

import (
	"testing"

	"construct-operator/internal/provider"
)

func TestOpenAICompatBuildBodySanitizesToolSchema(t *testing.T) {
	prov := NewOpenAICompat(OpenAICompatConfig{})
	body := prov.buildBody(&provider.Request{
		Model: "deepseek-chat",
		Messages: []provider.Message{
			{Role: "user", Content: "hello"},
		},
		Tools: []provider.ToolDef{
			{
				Name:        "install",
				Description: "Install a package",
				InputSchema: map[string]any{
					"type": "object",
					"properties": map[string]any{
						"packages": map[string]any{
							"type":  "array",
							"items": nil,
						},
					},
				},
			},
		},
	})

	tools, ok := body["tools"].([]map[string]any)
	if !ok || len(tools) != 1 {
		t.Fatalf("expected tools in request body, got %#v", body["tools"])
	}
	function, ok := tools[0]["function"].(map[string]any)
	if !ok {
		t.Fatalf("expected function payload, got %#v", tools[0]["function"])
	}
	parameters, ok := function["parameters"].(map[string]any)
	if !ok {
		t.Fatalf("expected parameter schema map, got %#v", function["parameters"])
	}
	if parameters["type"] != "object" {
		t.Fatalf("expected object schema, got %#v", parameters["type"])
	}
}

func TestOpenAICompatBuildBodyIncludesRequiredToolChoice(t *testing.T) {
	prov := NewOpenAICompat(OpenAICompatConfig{})
	body := prov.buildBody(&provider.Request{
		Model:      "openrouter/free",
		ToolChoice: "required",
		Messages: []provider.Message{
			{Role: "user", Content: "hello"},
		},
		Tools: []provider.ToolDef{
			{
				Name:        "bash",
				Description: "Run shell commands",
				InputSchema: map[string]any{"type": "object"},
			},
		},
	})

	if body["tool_choice"] != "required" {
		t.Fatalf("expected required tool_choice, got %#v", body["tool_choice"])
	}
}
