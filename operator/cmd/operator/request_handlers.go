package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"construct-operator/internal/provider"
	"construct-operator/internal/runner"
	"construct-operator/internal/transport"
)

type streamCanceler interface {
	CancelStream(requestID string) bool
}

type bridgePinger interface {
	Ping(context.Context) error
}

type requestDispatchDeps struct {
	server  streamCanceler
	rootCtx context.Context
	bridge  bridgePinger
}

// dispatchFrontRequests handles the low-risk front-of-switch routes that were
// extracted from main.go. The remaining request switch stays in main.go in the
// original order.
func (rt *operatorRuntime) dispatchFrontRequests(reqCtx context.Context, req transport.Request, deps requestDispatchDeps) (transport.Response, bool) {
	switch {
	case req.Type == "system.ping":
		return transport.Response{
			ID: req.ID, Success: true,
			Data: map[string]any{"status": "ok", "version": Version},
		}, true

	case req.Type == "stream.cancel":
		var payload struct {
			RequestID string `json:"request_id"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		if payload.RequestID == "" {
			return transport.Response{ID: req.ID, Success: false, Error: "request_id required"}, true
		}
		cancelled := false
		if deps.server != nil {
			cancelled = deps.server.CancelStream(payload.RequestID)
		}
		fmt.Fprintf(os.Stderr, "[operator] stream.cancel: %s (found=%v)\n", payload.RequestID, cancelled)
		return transport.Response{
			ID: req.ID, Success: true,
			Data: map[string]any{"cancelled": cancelled},
		}, true

	case req.Type == "system.info":
		bridgeStatus := "disabled"
		if deps.bridge != nil {
			if err := deps.bridge.Ping(deps.rootCtx); err == nil {
				bridgeStatus = "connected"
			} else {
				bridgeStatus = "unreachable"
			}
		}
		return transport.Response{
			ID: req.ID, Success: true,
			Data: map[string]any{
				"version":      Version,
				"workDir":      rt.workDir,
				"bridgeStatus": bridgeStatus,
			},
		}, true

	case req.Type == "providers.list" || req.Type == "ai.providers":
		authData, _ := rt.oauthStorage.Load()
		providerList := mergeRunnerProvidersWithOAuthProviders(rt.runner.ListProviders(), authData)
		return transport.Response{
			ID: req.ID, Success: true,
			Data: map[string]any{"providers": providerList},
		}, true

	case req.Type == "ai.models":
		// Preserve the existing behavior exactly, including the legacy type
		// assertion used by the current request path.
		var models []map[string]string
		for _, p := range rt.runner.ListProviders() {
			if ms, ok := p["models"].([]map[string]string); ok {
				models = append(models, ms...)
			}
		}
		return transport.Response{
			ID: req.ID, Success: true,
			Data: map[string]any{"models": models},
		}, true

	case req.Type == "tools.list":
		allTools := rt.tools.All()
		toolNames := make([]string, len(allTools))
		for i, t := range allTools {
			toolNames[i] = t.Def.Name
		}
		return transport.Response{
			ID: req.ID, Success: true,
			Data: map[string]any{"tools": toolNames, "count": len(toolNames)},
		}, true

	case req.Type == "agents.list":
		agentList := make([]map[string]any, 0, len(rt.agents)+1)
		agentList = append(agentList, map[string]any{
			"id":          rt.fallbackAgent.ID,
			"name":        rt.fallbackAgent.Name,
			"description": rt.fallbackAgent.Description,
			"category":    rt.fallbackAgent.Category,
		})
		for _, a := range rt.agents {
			agentList = append(agentList, map[string]any{
				"id":          a.ID,
				"name":        a.Name,
				"description": a.Description,
				"category":    a.Category,
			})
		}
		return transport.Response{
			ID: req.ID, Success: true,
			Data: map[string]any{"agents": agentList, "count": len(agentList)},
		}, true

	case req.Type == "agents.dispatch" || req.Type == "agents.dispatch_stream":
		return rt.handleDispatchRequest(reqCtx, req), true

	case req.Type == "ai.chat" || req.Type == "ai.chat_stream":
		return rt.handleChatRequest(reqCtx, req), true

	case req.Type == "context.set_project" ||
		req.Type == "context.set_mode" ||
		req.Type == "context.set_component" ||
		req.Type == "context.set_selection" ||
		req.Type == "context.clear_project" ||
		req.Type == "context.get":
		return rt.handleContextRequest(reqCtx, req)

	default:
		return transport.Response{}, false
	}
}

func (rt *operatorRuntime) handleDispatchRequest(reqCtx context.Context, req transport.Request) transport.Response {
	var payload struct {
		AgentID   string             `json:"agent_id"`
		Task      string             `json:"task"`
		Model     string             `json:"model,omitempty"`
		Messages  []provider.Message `json:"messages,omitempty"`
		SessionID string             `json:"session_id,omitempty"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	if payload.Task == "" {
		payload.Task = lastUserMessage(payload.Messages)
	}
	if payload.Task == "" {
		return transport.Response{ID: req.ID, Success: false, Error: "task is required"}
	}

	if payload.SessionID != "" && len(payload.Messages) == 0 {
		if prevSess, ok := rt.runner.GetSession(payload.SessionID); ok && len(prevSess.Messages) > 0 {
			payload.Messages = append(prevSess.Messages, provider.Message{Role: "user", Content: payload.Task})
			payload.Task = ""
		}
	}

	agentCfg := rt.resolveAgent(payload.AgentID)
	if agentCfg == nil {
		return transport.Response{ID: req.ID, Success: false, Error: "unknown agent: " + payload.AgentID}
	}
	result, err := rt.runner.Run(reqCtx, &runner.RunRequest{
		Agent:    agentCfg,
		Task:     payload.Task,
		Model:    payload.Model,
		Messages: payload.Messages,
		Context:  rt.runnerContext(reqCtx),
		Project:  rt.projectContext(reqCtx),
	})
	if err != nil {
		return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
	}

	return transport.Response{
		ID: req.ID, Success: true,
		Data: map[string]any{
			"agent_id":   result.AgentID,
			"session_id": result.SessionID,
			"content":    result.Content,
			"turns":      len(result.Turns),
			"usage": map[string]any{
				"input_tokens":  result.Usage.InputTokens,
				"output_tokens": result.Usage.OutputTokens,
			},
			"stop_reason": result.StopReason,
		},
	}
}

func (rt *operatorRuntime) handleChatRequest(reqCtx context.Context, req transport.Request) transport.Response {
	var payload struct {
		Message  string             `json:"message"`
		Model    string             `json:"model,omitempty"`
		Messages []provider.Message `json:"messages,omitempty"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	if payload.Message == "" {
		payload.Message = lastUserMessage(payload.Messages)
	}
	if payload.Message == "" {
		return transport.Response{ID: req.ID, Success: false, Error: "message is required"}
	}

	result, err := rt.runner.Run(reqCtx, &runner.RunRequest{
		Agent:    rt.resolveAgent(""),
		Task:     payload.Message,
		Model:    payload.Model,
		Messages: payload.Messages,
		Context:  rt.runnerContext(reqCtx),
		Project:  rt.projectContext(reqCtx),
	})
	if err != nil {
		return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
	}

	return transport.Response{
		ID: req.ID, Success: true,
		Data: map[string]any{
			"content":     result.Content,
			"turns":       len(result.Turns),
			"stop_reason": result.StopReason,
		},
	}
}
