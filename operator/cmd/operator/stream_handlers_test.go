package main

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"

	"construct-operator/internal/agent"
	"construct-operator/internal/provider"
	"construct-operator/internal/runner"
	"construct-operator/internal/session"
	"construct-operator/internal/transport"
)

func TestHandleStreamDispatchSuccessEmitsDone(t *testing.T) {
	prov := &streamHandlerTestProvider{
		id:     "test-provider",
		models: []string{"test-model"},
		streamEvents: []provider.StreamEvent{
			{Type: "text_delta", Text: "hello"},
			{Type: "done", Response: &provider.Response{
				Content:    "hello",
				StopReason: "end_turn",
				Usage: provider.Usage{
					InputTokens:  7,
					OutputTokens: 3,
				},
			}},
		},
	}
	rt := newStreamHandlerTestRuntime(t, prov)

	payload := map[string]any{
		"agent_id": "vibe",
		"model":    "test-model",
		"messages": []map[string]any{
			{"role": "assistant", "content": "Earlier"},
			{"role": "user", "content": "Write a summary"},
		},
	}
	req := newStreamHandlerTestRequest(t, "req-dispatch-success", "agents.dispatch_stream", payload)

	var chunks []transport.StreamChunk
	rt.handleStream(context.Background(), req, func(chunk transport.StreamChunk) {
		chunks = append(chunks, chunk)
	})

	if len(chunks) == 0 {
		t.Fatal("expected streamed chunks")
	}
	if len(chunks) < 2 {
		t.Fatalf("expected at least one forwarded event before done, got %d chunks", len(chunks))
	}

	done := chunks[len(chunks)-1]
	if done.Type != "done" {
		t.Fatalf("final chunk type = %q, want %q", done.Type, "done")
	}
	if !done.Done {
		t.Fatal("expected final chunk to be marked done")
	}
	if chunks[len(chunks)-2].Done {
		t.Fatalf("expected non-terminal chunk before done, got %#v", chunks[len(chunks)-2])
	}
	if chunks[len(chunks)-2].Type == "done" {
		t.Fatalf("expected forwarded event before done, got %#v", chunks[len(chunks)-2])
	}

	doneData := mustChunkDataMap(t, done)
	assertExactKeys(t, doneData, "agent_id", "content", "session_id", "stop_reason", "turns", "usage")
	sessionID, ok := doneData["session_id"].(string)
	if !ok || sessionID == "" {
		t.Fatalf("session_id = %#v, want non-empty string", doneData["session_id"])
	}
	usage, ok := doneData["usage"].(map[string]any)
	if !ok {
		t.Fatalf("usage type = %T, want map[string]any", doneData["usage"])
	}
	assertExactKeys(t, usage, "input_tokens", "output_tokens")
	expectedDoneData := map[string]any{
		"agent_id":    "vibe",
		"session_id":  sessionID,
		"content":     "hello",
		"turns":       1,
		"stop_reason": "end_turn",
		"usage": map[string]any{
			"input_tokens":  7,
			"output_tokens": 3,
		},
	}
	if !reflect.DeepEqual(doneData, expectedDoneData) {
		t.Fatalf("done data = %#v, want %#v", doneData, expectedDoneData)
	}

	if got := prov.lastRequest.Messages[len(prov.lastRequest.Messages)-1].Content; got != "Write a summary" {
		t.Fatalf("last forwarded message = %q, want %q", got, "Write a summary")
	}

	if got := prov.lastRequest.Model; got != "test-model" {
		t.Fatalf("forwarded model = %q, want %q", got, "test-model")
	}

	for _, chunk := range chunks {
		if chunk.ID != req.ID {
			t.Fatalf("chunk id = %q, want %q", chunk.ID, req.ID)
		}
	}
}

func TestHandleStreamDispatchMissingTaskReturnsError(t *testing.T) {
	rt := newStreamHandlerTestRuntime(t, &streamHandlerTestProvider{
		id:     "test-provider",
		models: []string{"test-model"},
	})
	req := newStreamHandlerTestRequest(t, "req-missing-task", "agents.dispatch_stream", map[string]any{
		"agent_id": "vibe",
	})

	var chunks []transport.StreamChunk
	rt.handleStream(context.Background(), req, func(chunk transport.StreamChunk) {
		chunks = append(chunks, chunk)
	})

	if len(chunks) != 1 {
		t.Fatalf("expected 1 chunk, got %d", len(chunks))
	}
	if chunks[0].Type != "error" {
		t.Fatalf("chunk type = %q, want %q", chunks[0].Type, "error")
	}
	if !chunks[0].Done {
		t.Fatal("expected terminal error chunk")
	}

	data, ok := chunks[0].Data.(map[string]any)
	if !ok {
		t.Fatalf("chunk data type = %T, want map[string]any", chunks[0].Data)
	}
	if got := data["error"]; got != "task is required" {
		t.Fatalf("error = %#v, want %q", got, "task is required")
	}
}

func TestHandleStreamUnknownTypeReturnsError(t *testing.T) {
	rt := newStreamHandlerTestRuntime(t, &streamHandlerTestProvider{
		id:     "test-provider",
		models: []string{"test-model"},
	})
	req := newStreamHandlerTestRequest(t, "req-unknown-stream", "stream.unknown", nil)

	var chunks []transport.StreamChunk
	rt.handleStream(context.Background(), req, func(chunk transport.StreamChunk) {
		chunks = append(chunks, chunk)
	})

	if len(chunks) != 1 {
		t.Fatalf("expected 1 chunk, got %d", len(chunks))
	}
	if chunks[0].Type != "error" {
		t.Fatalf("chunk type = %q, want %q", chunks[0].Type, "error")
	}
	if !chunks[0].Done {
		t.Fatal("expected terminal error chunk")
	}

	data, ok := chunks[0].Data.(map[string]any)
	if !ok {
		t.Fatalf("chunk data type = %T, want map[string]any", chunks[0].Data)
	}
	if got := data["error"]; got != "unknown stream type: stream.unknown" {
		t.Fatalf("error = %#v, want %q", got, "unknown stream type: stream.unknown")
	}
}

func TestHandleStreamChatSuccessPreservesRequestID(t *testing.T) {
	prov := &streamHandlerTestProvider{
		id:     "test-provider",
		models: []string{"test-model"},
		streamEvents: []provider.StreamEvent{
			{Type: "text_delta", Text: "reply"},
			{Type: "done", Response: &provider.Response{
				Content:    "reply",
				StopReason: "end_turn",
			}},
		},
	}
	rt := newStreamHandlerTestRuntime(t, prov)

	req := newStreamHandlerTestRequest(t, "req-chat-id", "ai.chat_stream", map[string]any{
		"model": "test-model",
		"messages": []map[string]any{
			{"role": "user", "content": "Say hi"},
		},
	})

	var chunks []transport.StreamChunk
	rt.handleStream(context.Background(), req, func(chunk transport.StreamChunk) {
		chunks = append(chunks, chunk)
	})

	if len(chunks) == 0 {
		t.Fatal("expected streamed chunks")
	}
	if len(chunks) < 2 {
		t.Fatalf("expected at least one forwarded event before done, got %d chunks", len(chunks))
	}
	for _, chunk := range chunks {
		if chunk.ID != req.ID {
			t.Fatalf("chunk id = %q, want %q", chunk.ID, req.ID)
		}
	}

	done := chunks[len(chunks)-1]
	if done.Type != "done" || !done.Done {
		t.Fatalf("final chunk = %#v, want terminal done chunk", done)
	}
	if chunks[len(chunks)-2].Done {
		t.Fatalf("expected non-terminal chunk before done, got %#v", chunks[len(chunks)-2])
	}
	if chunks[len(chunks)-2].Type == "done" {
		t.Fatalf("expected forwarded event before done, got %#v", chunks[len(chunks)-2])
	}

	doneData := mustChunkDataMap(t, done)
	assertExactKeys(t, doneData, "content", "stop_reason", "turns")
	expectedDoneData := map[string]any{
		"content":     "reply",
		"turns":       1,
		"stop_reason": "end_turn",
	}
	if !reflect.DeepEqual(doneData, expectedDoneData) {
		t.Fatalf("done data = %#v, want %#v", doneData, expectedDoneData)
	}
}

func mustChunkDataMap(t *testing.T, chunk transport.StreamChunk) map[string]any {
	t.Helper()

	data, ok := chunk.Data.(map[string]any)
	if !ok {
		t.Fatalf("chunk data type = %T, want map[string]any", chunk.Data)
	}
	return data
}

func assertExactKeys(t *testing.T, data map[string]any, wantKeys ...string) {
	t.Helper()

	if len(data) != len(wantKeys) {
		t.Fatalf("map keys = %#v, want %#v", sortedKeys(data), wantKeys)
	}
	keySet := make(map[string]bool, len(wantKeys))
	for _, key := range wantKeys {
		keySet[key] = true
	}
	for key := range data {
		if !keySet[key] {
			t.Fatalf("unexpected key %q in %#v", key, data)
		}
	}
}

func sortedKeys(data map[string]any) []string {
	keys := make([]string, 0, len(data))
	for key := range data {
		keys = append(keys, key)
	}
	for i := 0; i < len(keys); i++ {
		for j := i + 1; j < len(keys); j++ {
			if keys[j] < keys[i] {
				keys[i], keys[j] = keys[j], keys[i]
			}
		}
	}
	return keys
}

type streamHandlerTestProvider struct {
	id           string
	models       []string
	streamEvents []provider.StreamEvent
	lastRequest  *provider.Request
}

func (p *streamHandlerTestProvider) ID() string {
	return p.id
}

func (p *streamHandlerTestProvider) Models() []string {
	return p.models
}

func (p *streamHandlerTestProvider) Complete(context.Context, *provider.Request) (*provider.Response, error) {
	panic("Complete should not be called in stream handler tests")
}

func (p *streamHandlerTestProvider) Stream(_ context.Context, req *provider.Request) (<-chan provider.StreamEvent, error) {
	p.lastRequest = cloneProviderRequest(req)
	ch := make(chan provider.StreamEvent, len(p.streamEvents))
	for _, event := range p.streamEvents {
		ch <- event
	}
	close(ch)
	return ch, nil
}

func cloneProviderRequest(req *provider.Request) *provider.Request {
	if req == nil {
		return nil
	}
	copyReq := *req
	if len(req.Messages) > 0 {
		copyReq.Messages = append([]provider.Message(nil), req.Messages...)
	}
	if len(req.Tools) > 0 {
		copyReq.Tools = append([]provider.ToolDef(nil), req.Tools...)
	}
	return &copyReq
}

func newStreamHandlerTestRuntime(t *testing.T, prov provider.Provider) *operatorRuntime {
	t.Helper()

	rt := newOperatorRuntime(t.TempDir())
	rt.fallbackAgent = &agent.Config{
		ID:       "general",
		Name:     "General",
		System:   "You are a test agent.",
		Model:    "test-model",
		MaxTurns: 1,
	}
	rt.agents = []*agent.Config{
		{
			ID:       "vibe",
			Name:     "Vibe",
			System:   "You are a vibe agent.",
			Model:    "test-model",
			MaxTurns: 1,
		},
	}
	rt.sessionStore = session.NewStore("")
	rt.runner = runner.New(
		runner.WithProvider(prov),
		runner.WithSessionStore(rt.sessionStore),
	)
	return rt
}

func newStreamHandlerTestRequest(t *testing.T, id, reqType string, payload map[string]any) transport.Request {
	t.Helper()

	var raw json.RawMessage
	if payload != nil {
		data, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("marshal payload: %v", err)
		}
		raw = data
	}

	return transport.Request{
		ID:      id,
		Type:    reqType,
		Payload: raw,
	}
}
