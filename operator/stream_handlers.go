package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"construct-operator/internal/agent"
	"construct-operator/internal/provider"
	"construct-operator/internal/runner"
	"construct-operator/internal/stream"
	"construct-operator/internal/transport"
)

func (rt *operatorRuntime) handleStream(reqCtx context.Context, req transport.Request, emit func(transport.StreamChunk)) {
	switch req.Type {
	case "agents.dispatch_stream":
		rt.handleDispatchStream(reqCtx, req, emit)
	case "ai.chat_stream":
		rt.handleChatStream(reqCtx, req, emit)
	default:
		rt.emitStreamError(req, emit, "unknown stream type: "+req.Type)
	}
}

func (rt *operatorRuntime) handleDispatchStream(reqCtx context.Context, req transport.Request, emit func(transport.StreamChunk)) {
	var payload struct {
		AgentID     string             `json:"agent_id"`
		Task        string             `json:"task"`
		Model       string             `json:"model,omitempty"`
		Messages    []provider.Message `json:"messages,omitempty"`
		SessionID   string             `json:"session_id,omitempty"`
		ProjectPath string             `json:"project_path,omitempty"`
		ProjectName string             `json:"project_name,omitempty"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	if payload.Task == "" {
		payload.Task = lastUserMessage(payload.Messages)
	}
	if payload.Task == "" {
		rt.emitStreamError(req, emit, "task is required")
		return
	}

	if payload.SessionID != "" && len(payload.Messages) == 0 {
		if prevSess, ok := rt.runner.GetSession(payload.SessionID); ok && len(prevSess.Messages) > 0 {
			payload.Messages = append(prevSess.Messages, provider.Message{Role: "user", Content: payload.Task})
			payload.Task = ""
		}
	}

	agentCfg := rt.resolveAgent(payload.AgentID)
	if agentCfg == nil {
		rt.emitStreamError(req, emit, "unknown agent: "+payload.AgentID)
		return
	}

	projectCtx := rt.projectContext(reqCtx)
	if payload.ProjectPath != "" {
		projectCtx = &runner.ProjectContext{
			RootPath: payload.ProjectPath,
			Name:     payload.ProjectName,
		}
	}

	fmt.Fprintf(os.Stderr, "[dispatch] agent=%s model=%s project=%s session=%s task=%s\n",
		payload.AgentID, payload.Model,
		func() string {
			if projectCtx != nil {
				return projectCtx.RootPath
			}
			return ""
		}(),
		payload.SessionID, truncateLog(payload.Task, 80))

	result, err := rt.runStreamRequest(reqCtx, req, emit, &runner.RunRequest{
		Agent:    agentCfg,
		Task:     payload.Task,
		Model:    payload.Model,
		Messages: payload.Messages,
		Context:  rt.runnerContext(reqCtx),
		Project:  projectCtx,
	})
	if err != nil {
		rt.emitStreamError(req, emit, err.Error())
		return
	}

	rt.emitStreamDone(req, emit, map[string]any{
		"agent_id":    result.AgentID,
		"session_id":  result.SessionID,
		"content":     result.Content,
		"turns":       len(result.Turns),
		"stop_reason": result.StopReason,
		"usage": map[string]any{
			"input_tokens":  result.Usage.InputTokens,
			"output_tokens": result.Usage.OutputTokens,
		},
	})
}

func (rt *operatorRuntime) handleChatStream(reqCtx context.Context, req transport.Request, emit func(transport.StreamChunk)) {
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
		rt.emitStreamError(req, emit, "message is required")
		return
	}

	result, err := rt.runStreamRequest(reqCtx, req, emit, &runner.RunRequest{
		Agent:    rt.resolveAgent(""),
		Task:     payload.Message,
		Model:    payload.Model,
		Messages: payload.Messages,
		Context:  rt.runnerContext(reqCtx),
		Project:  rt.projectContext(reqCtx),
	})
	if err != nil {
		rt.emitStreamError(req, emit, err.Error())
		return
	}

	rt.emitStreamDone(req, emit, map[string]any{
		"content":     result.Content,
		"turns":       len(result.Turns),
		"stop_reason": result.StopReason,
	})
}

func (rt *operatorRuntime) runStreamRequest(
	reqCtx context.Context,
	req transport.Request,
	emit func(transport.StreamChunk),
	runReq *runner.RunRequest,
) (*agent.RunResult, error) {
	emitter := stream.NewEmitter()
	events := emitter.Subscribe()
	fwdDone := make(chan struct{})

	go func() {
		defer close(fwdDone)
		for ev := range events {
			emit(transport.StreamChunk{ID: req.ID, Type: ev.Type, Data: ev.Data})
		}
	}()

	runReq.Stream = emitter
	result, err := rt.runner.Run(reqCtx, runReq)

	emitter.Close()
	<-fwdDone

	return result, err
}

func (rt *operatorRuntime) emitStreamDone(req transport.Request, emit func(transport.StreamChunk), data map[string]any) {
	emit(transport.StreamChunk{ID: req.ID, Type: "done", Data: data, Done: true})
}

func (rt *operatorRuntime) emitStreamError(req transport.Request, emit func(transport.StreamChunk), message string) {
	emit(transport.StreamChunk{ID: req.ID, Type: "error", Data: map[string]any{"error": message}, Done: true})
}
