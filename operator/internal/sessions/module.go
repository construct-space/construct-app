// Package sessions implements the sessions module for Operator.
// It handles sessions.* requests and passthrough request types.
package sessions

import (
	"context"
	"encoding/json"
	"strings"

	"construct-operator/internal/chatsession"
	"construct-operator/internal/module"
	"construct-operator/internal/runner"
	"construct-operator/internal/transport"
)

// SessionsModule handles session listing, saving, loading, deletion,
// resume, and passthrough request types.
type SessionsModule struct {
	module.DefaultModule
	runner           *runner.Runner
	chatSessionStore *chatsession.Store
}

// NewModule creates a SessionsModule from the shared dependency bag.
func NewModule(deps module.Dependencies) module.Module {
	var rn *runner.Runner
	if r, ok := deps.Runner.(*runner.Runner); ok {
		rn = r
	}
	var css *chatsession.Store
	if s, ok := deps.ChatSessionStore.(*chatsession.Store); ok {
		css = s
	}
	return &SessionsModule{
		runner:           rn,
		chatSessionStore: css,
	}
}

// ID returns the module identifier.
func (m *SessionsModule) ID() string { return "sessions" }

// Routes registers all sessions.* and passthrough request handlers.
func (m *SessionsModule) Routes(r *module.Router) {
	r.Handle("sessions.list", m.handleList)
	r.Handle("sessions.get", m.handleGet)
	r.Handle("sessions.save", m.handleSave)
	r.Handle("sessions.load", m.handleLoad)
	r.Handle("sessions.chat_list", m.handleChatList)
	r.Handle("sessions.delete", m.handleDelete)
	r.Handle("sessions.resume", m.handleResume)

	// Passthrough types — return empty success.
	for _, pt := range passthroughTypes() {
		pt := pt
		r.Handle(pt, func(_ context.Context, req transport.Request) transport.Response {
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{}}
		})
	}
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

func (m *SessionsModule) handleList(_ context.Context, req transport.Request) transport.Response {
	sessions := m.runner.ListSessions()
	return transport.Response{
		ID: req.ID, Success: true,
		Data: map[string]any{"sessions": sessions, "count": len(sessions)},
	}
}

func (m *SessionsModule) handleGet(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		SessionID string `json:"session_id"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	sess, ok := m.runner.GetSession(payload.SessionID)
	if !ok {
		return transport.Response{ID: req.ID, Success: false, Error: "session not found"}
	}
	return transport.Response{
		ID: req.ID, Success: true,
		Data: map[string]any{"session": sess},
	}
}

func (m *SessionsModule) handleSave(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		Session chatsession.Session `json:"session"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	if payload.Session.ID == "" {
		return transport.Response{ID: req.ID, Success: false, Error: "session.id is required"}
	}
	if err := m.chatSessionStore.Save(&payload.Session); err != nil {
		return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
	}
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}
}

func (m *SessionsModule) handleLoad(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		ID string `json:"id"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	if payload.ID == "" {
		return transport.Response{ID: req.ID, Success: false, Error: "id is required"}
	}
	sess, err := m.chatSessionStore.Load(payload.ID)
	if err != nil {
		return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
	}
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"session": sess}}
}

func (m *SessionsModule) handleChatList(_ context.Context, req transport.Request) transport.Response {
	metas, err := m.chatSessionStore.List()
	if err != nil {
		return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
	}
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{
		"sessions": metas, "count": len(metas),
	}}
}

func (m *SessionsModule) handleDelete(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		ID string `json:"id"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	if payload.ID == "" {
		return transport.Response{ID: req.ID, Success: false, Error: "id is required"}
	}
	if err := m.chatSessionStore.Delete(payload.ID); err != nil {
		return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
	}
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}
}

func (m *SessionsModule) handleResume(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		AgentID   string `json:"agent_id"`
		ProjectID string `json:"project_id"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	if payload.AgentID == "" {
		return transport.Response{ID: req.ID, Success: false, Error: "agent_id is required"}
	}
	sess, err := m.chatSessionStore.FindByAgent(payload.AgentID, payload.ProjectID)
	if err != nil {
		return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
	}
	if sess == nil {
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"session": nil}}
	}
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"session": sess}}
}

// ---------------------------------------------------------------------------
// Passthrough helpers
// ---------------------------------------------------------------------------

// IsPassthroughRequestType reports whether a request type is handled as a
// passthrough (empty success response). Exported so callers can check before
// dispatching.
func IsPassthroughRequestType(reqType string) bool {
	switch {
	case strings.HasPrefix(reqType, "ai.conversations."),
		strings.HasPrefix(reqType, "auth.set_api_base"),
		strings.HasPrefix(reqType, "auth.sync_token"),
		reqType == "system.check_update",
		reqType == "system.apply_update":
		return true
	default:
		return false
	}
}

// IsSessionRequestType reports whether a request type is a sessions.* type.
func IsSessionRequestType(reqType string) bool {
	switch reqType {
	case "sessions.list",
		"sessions.get",
		"sessions.save",
		"sessions.load",
		"sessions.chat_list",
		"sessions.delete",
		"sessions.resume":
		return true
	default:
		return false
	}
}

// passthroughTypes returns known passthrough request types that can be
// registered statically. Prefix-based passthroughs (ai.conversations.*)
// are handled separately.
func passthroughTypes() []string {
	return []string{
		"system.check_update",
		"system.apply_update",
	}
}
