package connectors

import (
	"io"
	"strings"
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

func TestReadSSEHandlesInvalidJSON(t *testing.T) {
	// Simulate an SSE stream with valid data, invalid JSON, and valid data
	sseData := strings.Join([]string{
		`data: {"choices":[{"delta":{"content":"hello"},"finish_reason":null}]}`,
		`data: {broken json!`,
		`data: {"choices":[{"delta":{"content":" world"},"finish_reason":null}]}`,
		`data: {"choices":[{"delta":{},"finish_reason":"stop"}]}`,
		`data: [DONE]`,
	}, "\n") + "\n"

	prov := NewOpenAICompat(OpenAICompatConfig{Key: "test"})
	ch := make(chan provider.StreamEvent, 64)

	body := io.NopCloser(strings.NewReader(sseData))
	prov.readSSE(body, ch)

	var events []provider.StreamEvent
	for ev := range ch {
		events = append(events, ev)
	}

	// Should have received text deltas for "hello" and " world" plus "done"
	// The broken JSON line should be logged and skipped
	textDeltas := 0
	doneCount := 0
	for _, ev := range events {
		if ev.Type == "text_delta" {
			textDeltas++
		}
		if ev.Type == "done" {
			doneCount++
		}
	}
	if textDeltas != 2 {
		t.Fatalf("expected 2 text_delta events, got %d (total events: %d)", textDeltas, len(events))
	}
	if doneCount != 1 {
		t.Fatalf("expected 1 done event, got %d", doneCount)
	}
}

func TestReadSSEHandlesEmptyStream(t *testing.T) {
	prov := NewOpenAICompat(OpenAICompatConfig{Key: "test"})
	ch := make(chan provider.StreamEvent, 64)

	body := io.NopCloser(strings.NewReader(""))
	prov.readSSE(body, ch)

	var events []provider.StreamEvent
	for ev := range ch {
		events = append(events, ev)
	}

	if len(events) != 0 {
		t.Fatalf("expected 0 events for empty stream, got %d", len(events))
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
