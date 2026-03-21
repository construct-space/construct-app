package provider

import "testing"

func TestNewCodexOAuth_DefaultModelOrderPrefersCodex(t *testing.T) {
	prov := NewCodexOAuth(CodexOAuthConfig{})
	models := prov.Models()
	if len(models) == 0 {
		t.Fatal("expected default models")
	}
	if models[0] != "gpt-5.3-codex" {
		t.Fatalf("expected codex model to be preferred first, got %q", models[0])
	}
}

func TestBuildPayloadIncludesTools(t *testing.T) {
	prov := NewCodexOAuth(CodexOAuthConfig{})
	payload := prov.buildPayload(&Request{
		Model: "gpt-5.3-codex",
		Messages: []Message{
			{Role: "user", Content: "hello"},
		},
		Tools: []ToolDef{
			{
				Name:        "write_file",
				Description: "Write a file",
				InputSchema: map[string]any{
					"type": "object",
					"properties": map[string]any{
						"path": map[string]any{"type": "string"},
					},
					"required": []string{"path"},
				},
			},
		},
	})

	tools, ok := payload["tools"].([]map[string]any)
	if !ok || len(tools) != 1 {
		t.Fatalf("expected tools in payload, got %#v", payload["tools"])
	}
	if payload["tool_choice"] != "auto" {
		t.Fatalf("expected tool_choice auto, got %#v", payload["tool_choice"])
	}
	if tools[0]["name"] != "write_file" {
		t.Fatalf("expected write_file tool, got %#v", tools[0])
	}
	if tools[0]["type"] != "function" {
		t.Fatalf("expected function type, got %#v", tools[0]["type"])
	}
}

func TestSanitizeToolSchemaProducesValidObjectShape(t *testing.T) {
	schema := SanitizeToolSchema(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"detail": map[string]any{
				"type": "string",
				"enum": []any{"status", "log"},
			},
			"metadata": map[string]any{
				"type":                 "object",
				"additionalProperties": "object",
			},
		},
		"required": []any{"detail"},
	})

	if schema["type"] != "object" {
		t.Fatalf("expected object schema, got %#v", schema["type"])
	}
	if schema["additionalProperties"] != false {
		t.Fatalf("expected top-level additionalProperties=false, got %#v", schema["additionalProperties"])
	}
	props, ok := schema["properties"].(map[string]any)
	if !ok {
		t.Fatalf("expected properties map, got %#v", schema["properties"])
	}
	metadata, ok := props["metadata"].(map[string]any)
	if !ok {
		t.Fatalf("expected metadata property, got %#v", props["metadata"])
	}
	if metadata["type"] != "object" {
		t.Fatalf("expected object metadata property, got %#v", metadata["type"])
	}
	if metadata["additionalProperties"] != true {
		t.Fatalf("expected nested object additionalProperties=true, got %#v", metadata["additionalProperties"])
	}
}
