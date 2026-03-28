package main

import (
	"encoding/json"
	"strings"

	"construct-operator/internal/chatsession"
	"construct-operator/internal/transport"
)

func isSessionRequestType(reqType string) bool {
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

func isPassthroughRequestType(reqType string) bool {
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

func (rt *operatorRuntime) handleSessionRequest(req transport.Request) transport.Response {
	switch {
	case req.Type == "sessions.list":
		sessions := rt.runner.ListSessions()
		return transport.Response{
			ID: req.ID, Success: true,
			Data: map[string]any{"sessions": sessions, "count": len(sessions)},
		}

	case req.Type == "sessions.get":
		var payload struct {
			SessionID string `json:"session_id"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		sess, ok := rt.runner.GetSession(payload.SessionID)
		if !ok {
			return transport.Response{ID: req.ID, Success: false, Error: "session not found"}
		}
		return transport.Response{
			ID: req.ID, Success: true,
			Data: map[string]any{"session": sess},
		}

	case req.Type == "sessions.save":
		var payload struct {
			Session chatsession.Session `json:"session"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		if payload.Session.ID == "" {
			return transport.Response{ID: req.ID, Success: false, Error: "session.id is required"}
		}
		if err := rt.chatSessionStore.Save(&payload.Session); err != nil {
			return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
		}
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}

	case req.Type == "sessions.load":
		var payload struct {
			ID string `json:"id"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		if payload.ID == "" {
			return transport.Response{ID: req.ID, Success: false, Error: "id is required"}
		}
		sess, err := rt.chatSessionStore.Load(payload.ID)
		if err != nil {
			return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
		}
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"session": sess}}

	case req.Type == "sessions.chat_list":
		metas, err := rt.chatSessionStore.List()
		if err != nil {
			return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
		}
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{
			"sessions": metas, "count": len(metas),
		}}

	case req.Type == "sessions.delete":
		var payload struct {
			ID string `json:"id"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		if payload.ID == "" {
			return transport.Response{ID: req.ID, Success: false, Error: "id is required"}
		}
		if err := rt.chatSessionStore.Delete(payload.ID); err != nil {
			return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
		}
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}

	case req.Type == "sessions.resume":
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
		sess, err := rt.chatSessionStore.FindByAgent(payload.AgentID, payload.ProjectID)
		if err != nil {
			return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
		}
		if sess == nil {
			return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"session": nil}}
		}
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"session": sess}}

	case isPassthroughRequestType(req.Type):
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{}}

	default:
		return transport.Response{ID: req.ID, Success: false, Error: "unknown session request type: " + req.Type}
	}
}
