package tool

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"construct-operator/internal/transport"
)

// HandlerToolTimeout is the timeout for tool execution via the handler endpoint.
const HandlerToolTimeout = 5 * time.Minute

// handleList returns all registered tool names.
func (m *ToolModule) handleList(_ context.Context, req transport.Request) transport.Response {
	allTools := m.registry.All()
	toolNames := make([]string, len(allTools))
	for i, t := range allTools {
		toolNames[i] = t.Def.Name
	}
	return transport.Response{
		ID: req.ID, Success: true,
		Data: map[string]any{"tools": toolNames, "count": len(toolNames)},
	}
}

// handleCall executes a tool by name.
func (m *ToolModule) handleCall(reqCtx context.Context, req transport.Request) transport.Response {
	var payload struct {
		Name     string          `json:"name"`
		Input    string          `json:"input"`
		ToolCall json.RawMessage `json:"toolCall"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	if payload.Name == "" && payload.ToolCall != nil {
		var tc struct {
			Function struct {
				Name      string `json:"name"`
				Arguments string `json:"arguments"`
			} `json:"function"`
		}
		json.Unmarshal(payload.ToolCall, &tc)
		payload.Name = tc.Function.Name
		payload.Input = tc.Function.Arguments
	}
	t, ok := m.registry.Get(payload.Name)
	if !ok {
		return transport.Response{ID: req.ID, Success: false, Error: "unknown tool: " + payload.Name}
	}
	if m.hooks != nil {
		if hookResult, err := m.hooks.RunPre(reqCtx, payload.Name, payload.Input); err == nil && hookResult != nil && hookResult.Block {
			return transport.Response{ID: req.ID, Success: false, Error: fmt.Sprintf("blocked by hook: %s", hookResult.Message)}
		}
	}
	toolCtx, toolCancel := context.WithTimeout(reqCtx, HandlerToolTimeout)
	defer toolCancel()
	result, err := t.Executor.Execute(toolCtx, payload.Input)
	if err != nil {
		errMsg := err.Error()
		if toolCtx.Err() == context.DeadlineExceeded {
			errMsg = fmt.Sprintf("tool %s timed out after %s", payload.Name, HandlerToolTimeout)
		}
		return transport.Response{ID: req.ID, Success: false, Error: errMsg}
	}
	if m.hooks != nil {
		m.hooks.RunPost(reqCtx, payload.Name, result.Content)
	}
	return transport.Response{
		ID: req.ID, Success: true,
		Data: map[string]any{"content": result.Content, "is_error": result.IsError},
	}
}

// handleSpaceActionsReady is called by the frontend after all space
// automation providers are registered. Registers space action tools instantly.
func (m *ToolModule) handleSpaceActionsReady(_ context.Context, req transport.Request) transport.Response {
	EnsureSpaceActionsRegistered()
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}
}
