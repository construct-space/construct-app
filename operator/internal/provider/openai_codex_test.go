package provider

import (
	"io"
	"strings"
	"testing"
)

func TestNewCodexOAuth_DefaultModelOrderStartsWithGPT54(t *testing.T) {
	prov := NewCodexOAuth(CodexOAuthConfig{})
	models := prov.Models()
	if len(models) == 0 {
		t.Fatal("expected default models")
	}
	if models[0] != "gpt-5.4" {
		t.Fatalf("expected GPT-5.4 to be preferred first, got %q", models[0])
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

func TestBuildPayloadAllowsRequiredToolChoice(t *testing.T) {
	prov := NewCodexOAuth(CodexOAuthConfig{})
	payload := prov.buildPayload(&Request{
		Model:      "gpt-5.4",
		ToolChoice: "required",
		Messages: []Message{
			{Role: "user", Content: "hello"},
		},
		Tools: []ToolDef{
			{
				Name:        "bash",
				Description: "Run shell commands",
				InputSchema: map[string]any{"type": "object"},
			},
		},
	})

	if payload["tool_choice"] != "required" {
		t.Fatalf("expected tool_choice required, got %#v", payload["tool_choice"])
	}
}

func TestReadCodexSSEIncludesToolCallsInDoneResponse(t *testing.T) {
	prov := NewCodexOAuth(CodexOAuthConfig{})
	body := strings.NewReader(strings.Join([]string{
		"event: response.output_item.done",
		`data: {"item":{"id":"item_1","type":"function_call","call_id":"call_1","name":"bash","arguments":"{\"cmd\":\"pwd\"}"}}`,
		"",
		"event: response.completed",
		`data: {}`,
		"",
	}, "\n"))

	ch := make(chan StreamEvent, 4)
	go prov.readCodexSSE(io.NopCloser(body), ch)

	var done *Response
	for event := range ch {
		if event.Type == "done" {
			done = event.Response
		}
	}

	if done == nil {
		t.Fatal("expected final response")
	}
	if done.StopReason != "tool_use" {
		t.Fatalf("expected tool_use stop reason, got %q", done.StopReason)
	}
	if len(done.ToolCalls) != 1 {
		t.Fatalf("expected 1 tool call, got %d", len(done.ToolCalls))
	}
	if done.ToolCalls[0].Name != "bash" {
		t.Fatalf("expected bash tool call, got %q", done.ToolCalls[0].Name)
	}
}

func TestReadCodexSSEUsesOutputTextDoneWhenNoDeltaArrives(t *testing.T) {
	prov := NewCodexOAuth(CodexOAuthConfig{})
	body := strings.NewReader(strings.Join([]string{
		"event: response.output_text.done",
		`data: {"item_id":"msg_1","content_index":0,"text":"Running that command now."}`,
		"",
		"event: response.completed",
		`data: {}`,
		"",
	}, "\n"))

	ch := make(chan StreamEvent, 4)
	go prov.readCodexSSE(io.NopCloser(body), ch)

	var textDeltas []string
	var done *Response
	for event := range ch {
		switch event.Type {
		case "text_delta":
			textDeltas = append(textDeltas, event.Text)
		case "done":
			done = event.Response
		}
	}

	if strings.Join(textDeltas, "") != "Running that command now." {
		t.Fatalf("expected fallback text delta, got %#v", textDeltas)
	}
	if done == nil {
		t.Fatal("expected final response")
	}
	if done.Content != "Running that command now." {
		t.Fatalf("expected final response content to include fallback text, got %q", done.Content)
	}
}

func TestReadCodexSSEDoesNotDuplicateTextWhenDoneFollowsDelta(t *testing.T) {
	prov := NewCodexOAuth(CodexOAuthConfig{})
	body := strings.NewReader(strings.Join([]string{
		"event: response.output_text.delta",
		`data: {"item_id":"msg_1","content_index":0,"delta":"Doing that now."}`,
		"",
		"event: response.output_text.done",
		`data: {"item_id":"msg_1","content_index":0,"text":"Doing that now."}`,
		"",
		"event: response.completed",
		`data: {}`,
		"",
	}, "\n"))

	ch := make(chan StreamEvent, 4)
	go prov.readCodexSSE(io.NopCloser(body), ch)

	var textDeltas []string
	var done *Response
	for event := range ch {
		switch event.Type {
		case "text_delta":
			textDeltas = append(textDeltas, event.Text)
		case "done":
			done = event.Response
		}
	}

	if strings.Join(textDeltas, "") != "Doing that now." {
		t.Fatalf("expected a single streamed sentence, got %#v", textDeltas)
	}
	if done == nil {
		t.Fatal("expected final response")
	}
	if done.Content != "Doing that now." {
		t.Fatalf("expected final response content without duplication, got %q", done.Content)
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
