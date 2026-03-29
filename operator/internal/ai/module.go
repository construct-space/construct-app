// Package ai implements the AI interaction module for Operator.
// It handles dispatch, chat, streaming, and provider/model listing.
package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"construct-operator/internal/agent"
	"construct-operator/internal/module"
	"construct-operator/internal/oauth"
	"construct-operator/internal/provider"
	appproviders "construct-operator/internal/provider/bootstrap"
	"construct-operator/internal/runner"
	"construct-operator/internal/stream"
	"construct-operator/internal/transport"
)

// StreamCanceler can cancel an in-flight streaming request by ID.
type StreamCanceler interface {
	CancelStream(requestID string) bool
}

// BridgePinger can test desktop-bridge connectivity.
type BridgePinger interface {
	Ping(context.Context) error
}

// oauthStorageLoader loads stored OAuth credentials.
type oauthStorageLoader interface {
	Load() (oauth.StorageData, error)
}

// AIModule handles core AI interactions: dispatch, chat, streaming,
// agent listing, model/provider listing, and system info.
type AIModule struct {
	module.DefaultModule
	runner        *runner.Runner
	agents        []*agent.Config
	fallbackAgent *agent.Config
	appState      *module.AppState
	buildVersion  string
	bridge        BridgePinger
	server        StreamCanceler
	oauthStorage  oauthStorageLoader
	workDir       string
}

// NewModule creates an AIModule from the shared dependency bag.
func NewModule(deps module.Dependencies) module.Module {
	var rn *runner.Runner
	if r, ok := deps.Runner.(*runner.Runner); ok {
		rn = r
	}
	var bridge BridgePinger
	if b, ok := deps.Bridge.(BridgePinger); ok {
		bridge = b
	}
	var storage oauthStorageLoader
	if s, ok := deps.OAuthStorage.(oauthStorageLoader); ok {
		storage = s
	}
	var agents []*agent.Config
	if a, ok := deps.Agents.([]*agent.Config); ok {
		agents = a
	}
	var fallback *agent.Config
	if f, ok := deps.FallbackAgent.(*agent.Config); ok {
		fallback = f
	}
	return &AIModule{
		runner:        rn,
		agents:        agents,
		fallbackAgent: fallback,
		appState:      deps.AppState,
		buildVersion:  "dev",
		bridge:        bridge,
		oauthStorage:  storage,
		workDir:       deps.WorkDir,
	}
}

// ID returns the module identifier.
func (m *AIModule) ID() string { return "ai" }

// SetServer provides the stream canceler (TCP server) after construction.
func (m *AIModule) SetServer(s StreamCanceler) { m.server = s }

// SetBuildVersion sets the operator build version string.
func (m *AIModule) SetBuildVersion(v string) { m.buildVersion = v }

// Routes registers all AI-related request and stream handlers.
func (m *AIModule) Routes(r *module.Router) {
	r.Handle("system.ping", m.handlePing)
	r.Handle("system.info", m.handleInfo)
	r.Handle("agents.list", m.handleAgentsList)
	r.Handle("agents.dispatch", m.handleDispatch)
	r.Handle("ai.chat", m.handleChat)
	r.Handle("ai.models", m.handleModels)
	r.Handle("ai.providers", m.handleProviders)
	r.Handle("providers.list", m.handleProviders)
	r.Handle("stream.cancel", m.handleStreamCancel)

	r.HandleStream("agents.dispatch_stream", m.handleDispatchStream)
	r.HandleStream("ai.chat_stream", m.handleChatStream)
}

// ---------------------------------------------------------------------------
// Request handlers
// ---------------------------------------------------------------------------

func (m *AIModule) handlePing(_ context.Context, req transport.Request) transport.Response {
	return transport.Response{
		ID: req.ID, Success: true,
		Data: map[string]any{"status": "ok", "version": m.buildVersion},
	}
}

func (m *AIModule) handleInfo(ctx context.Context, req transport.Request) transport.Response {
	bridgeStatus := "disabled"
	if m.bridge != nil {
		if err := m.bridge.Ping(ctx); err == nil {
			bridgeStatus = "connected"
		} else {
			bridgeStatus = "unreachable"
		}
	}
	return transport.Response{
		ID: req.ID, Success: true,
		Data: map[string]any{
			"version":      m.buildVersion,
			"workDir":      m.workDir,
			"bridgeStatus": bridgeStatus,
		},
	}
}

func (m *AIModule) handleAgentsList(_ context.Context, req transport.Request) transport.Response {
	agentList := make([]map[string]any, 0, len(m.agents)+1)
	agentList = append(agentList, map[string]any{
		"id":          m.fallbackAgent.ID,
		"name":        m.fallbackAgent.Name,
		"description": m.fallbackAgent.Description,
		"category":    m.fallbackAgent.Category,
	})
	for _, a := range m.agents {
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
	}
}

func (m *AIModule) handleDispatch(reqCtx context.Context, req transport.Request) transport.Response {
	var payload struct {
		AgentID       string             `json:"agent_id"`
		Task          string             `json:"task"`
		Model         string             `json:"model,omitempty"`
		Messages      []provider.Message `json:"messages,omitempty"`
		SessionID     string             `json:"session_id,omitempty"`
		ProjectPath   string             `json:"project_path,omitempty"`
		ProjectName   string             `json:"project_name,omitempty"`
		AssistantType string             `json:"assistant_type,omitempty"`
		OutputSchema  string             `json:"output_schema,omitempty"`
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
		if prevSess, ok := m.runner.GetSession(payload.SessionID); ok && len(prevSess.Messages) > 0 {
			payload.Messages = append(prevSess.Messages, provider.Message{Role: "user", Content: payload.Task})
			payload.Task = ""
		}
	}

	agentCfg := m.resolveAgent(payload.AgentID)
	if agentCfg == nil {
		return transport.Response{ID: req.ID, Success: false, Error: "unknown agent: " + payload.AgentID}
	}

	projectCtx := m.projectContext(reqCtx)
	if payload.ProjectPath != "" {
		projectCtx = &runner.ProjectContext{
			RootPath: payload.ProjectPath,
			Name:     payload.ProjectName,
		}
	}
	result, err := m.runner.Run(reqCtx, &runner.RunRequest{
		Agent:         agentCfg,
		Task:          payload.Task,
		Model:         payload.Model,
		Messages:      payload.Messages,
		Context:       m.runnerContext(reqCtx),
		Project:       projectCtx,
		AssistantType: payload.AssistantType,
		OutputSchema:  payload.OutputSchema,
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

func (m *AIModule) handleChat(reqCtx context.Context, req transport.Request) transport.Response {
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

	result, err := m.runner.Run(reqCtx, &runner.RunRequest{
		Agent:    m.resolveAgent(""),
		Task:     payload.Message,
		Model:    payload.Model,
		Messages: payload.Messages,
		Context:  m.runnerContext(reqCtx),
		Project:  m.projectContext(reqCtx),
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

func (m *AIModule) handleModels(_ context.Context, req transport.Request) transport.Response {
	var models []map[string]string
	for _, p := range m.runner.ListProviders() {
		if ms, ok := p["models"].([]map[string]string); ok {
			models = append(models, ms...)
		}
	}
	return transport.Response{
		ID: req.ID, Success: true,
		Data: map[string]any{"models": models},
	}
}

func (m *AIModule) handleProviders(_ context.Context, req transport.Request) transport.Response {
	var authData oauth.StorageData
	if m.oauthStorage != nil {
		authData, _ = m.oauthStorage.Load()
	}
	providerList := appproviders.MergeRunnerProvidersWithOAuthProviders(m.runner.ListProviders(), authData)
	return transport.Response{
		ID: req.ID, Success: true,
		Data: map[string]any{"providers": providerList},
	}
}

func (m *AIModule) handleStreamCancel(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		RequestID string `json:"request_id"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	if payload.RequestID == "" {
		return transport.Response{ID: req.ID, Success: false, Error: "request_id required"}
	}
	cancelled := false
	if m.server != nil {
		cancelled = m.server.CancelStream(payload.RequestID)
	}
	fmt.Fprintf(os.Stderr, "[operator] stream.cancel: %s (found=%v)\n", payload.RequestID, cancelled)
	return transport.Response{
		ID: req.ID, Success: true,
		Data: map[string]any{"cancelled": cancelled},
	}
}

// ---------------------------------------------------------------------------
// Stream handlers
// ---------------------------------------------------------------------------

func (m *AIModule) handleDispatchStream(reqCtx context.Context, req transport.Request, emit func(transport.StreamChunk)) {
	var payload struct {
		AgentID       string             `json:"agent_id"`
		Task          string             `json:"task"`
		Model         string             `json:"model,omitempty"`
		Messages      []provider.Message `json:"messages,omitempty"`
		SessionID     string             `json:"session_id,omitempty"`
		ProjectPath   string             `json:"project_path,omitempty"`
		ProjectName   string             `json:"project_name,omitempty"`
		AssistantType string             `json:"assistant_type,omitempty"`
		OutputSchema  string             `json:"output_schema,omitempty"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	if payload.Task == "" {
		payload.Task = lastUserMessage(payload.Messages)
	}
	if payload.Task == "" {
		emitStreamError(req, emit, "task is required")
		return
	}

	if payload.SessionID != "" && len(payload.Messages) == 0 {
		if prevSess, ok := m.runner.GetSession(payload.SessionID); ok && len(prevSess.Messages) > 0 {
			payload.Messages = append(prevSess.Messages, provider.Message{Role: "user", Content: payload.Task})
			payload.Task = ""
		}
	}

	agentCfg := m.resolveAgent(payload.AgentID)
	if agentCfg == nil {
		emitStreamError(req, emit, "unknown agent: "+payload.AgentID)
		return
	}

	projectCtx := m.projectContext(reqCtx)
	if payload.ProjectPath != "" {
		projectCtx = &runner.ProjectContext{
			RootPath: payload.ProjectPath,
			Name:     payload.ProjectName,
		}
	}

	fmt.Fprintf(os.Stderr, "[dispatch] agent=%s model=%s project=%s session=%s assistant_type=%s task=%s\n",
		payload.AgentID, payload.Model,
		func() string {
			if projectCtx != nil {
				return projectCtx.RootPath
			}
			return ""
		}(),
		payload.SessionID, payload.AssistantType, truncateLog(payload.Task, 80))

	result, err := runStreamRequest(m.runner, reqCtx, req, emit, &runner.RunRequest{
		Agent:         agentCfg,
		Task:          payload.Task,
		Model:         payload.Model,
		Messages:      payload.Messages,
		Context:       m.runnerContext(reqCtx),
		Project:       projectCtx,
		AssistantType: payload.AssistantType,
		OutputSchema:  payload.OutputSchema,
	})
	if err != nil {
		emitStreamError(req, emit, err.Error())
		return
	}

	emitStreamDone(req, emit, map[string]any{
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

func (m *AIModule) handleChatStream(reqCtx context.Context, req transport.Request, emit func(transport.StreamChunk)) {
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
		emitStreamError(req, emit, "message is required")
		return
	}

	result, err := runStreamRequest(m.runner, reqCtx, req, emit, &runner.RunRequest{
		Agent:    m.resolveAgent(""),
		Task:     payload.Message,
		Model:    payload.Model,
		Messages: payload.Messages,
		Context:  m.runnerContext(reqCtx),
		Project:  m.projectContext(reqCtx),
	})
	if err != nil {
		emitStreamError(req, emit, err.Error())
		return
	}

	emitStreamDone(req, emit, map[string]any{
		"content":     result.Content,
		"turns":       len(result.Turns),
		"stop_reason": result.StopReason,
	})
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func (m *AIModule) resolveAgent(id string) *agent.Config {
	return resolveAgent(m.agents, m.fallbackAgent, id)
}

func (m *AIModule) projectContext(reqCtx context.Context) *runner.ProjectContext {
	if m.appState == nil {
		return nil
	}
	clientID := transport.ClientIDFromContext(reqCtx)
	p, _ := m.appState.Project(clientID).(*runner.ProjectContext)
	return p
}

func (m *AIModule) runnerContext(reqCtx context.Context) map[string]any {
	if m.appState == nil {
		return nil
	}
	clientID := transport.ClientIDFromContext(reqCtx)
	clientCtx := m.appState.Client(clientID)
	if clientCtx == nil {
		return nil
	}
	result := map[string]any{}
	if clientCtx.Mode != "" {
		result["mode"] = clientCtx.Mode
	}
	if len(clientCtx.Component) > 0 {
		result["component"] = clientCtx.Component
	}
	if len(clientCtx.Selection) > 0 {
		result["selection"] = clientCtx.Selection
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func resolveAgent(agents []*agent.Config, fallback *agent.Config, id string) *agent.Config {
	if id == "" {
		if agentCfg := findAgent(agents, "vibe"); agentCfg != nil {
			return agentCfg
		}
		return fallback
	}
	if agentCfg := findAgent(agents, id); agentCfg != nil {
		return agentCfg
	}
	if id == "general" {
		return fallback
	}
	return nil
}

func findAgent(agents []*agent.Config, id string) *agent.Config {
	for index := len(agents) - 1; index >= 0; index-- {
		candidate := agents[index]
		if candidate.ID == id || candidate.ID == "space:"+id {
			return candidate
		}
	}
	return nil
}

func lastUserMessage(messages []provider.Message) string {
	for i := len(messages) - 1; i >= 0; i-- {
		if strings.EqualFold(messages[i].Role, "user") {
			if content := strings.TrimSpace(messages[i].Content); content != "" {
				return content
			}
		}
	}
	return ""
}

func truncateLog(s string, max int) string {
	s = strings.TrimSpace(s)
	if len(s) <= max {
		return s
	}
	return s[:max] + "..."
}

func runStreamRequest(
	r *runner.Runner,
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
	result, err := r.Run(reqCtx, runReq)

	emitter.Close()
	<-fwdDone

	return result, err
}

func emitStreamDone(req transport.Request, emit func(transport.StreamChunk), data map[string]any) {
	emit(transport.StreamChunk{ID: req.ID, Type: "done", Data: data, Done: true})
}

func emitStreamError(req transport.Request, emit func(transport.StreamChunk), message string) {
	emit(transport.StreamChunk{ID: req.ID, Type: "error", Data: map[string]any{"error": message}, Done: true})
}
