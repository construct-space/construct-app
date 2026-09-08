// sessions.* + ai.conversations.* — chat history wire ops. brain owns
// session JSONL files; the frontend uses both shapes (sessions.* in the
// new shell, ai.conversations.* in legacy panels), so we serve both
// against the same store.
package main

import (
	"context"
	"encoding/json"

	"github.com/construct-space/brain/session"
	"github.com/construct-space/brain/sidecar"
	"github.com/construct-space/brain/wire"
)

func registerSessionHandlers(s *sidecar.Server, sessions *session.Store) {
	s.Handle("sessions.chat_list", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		list, err := sessions.List()
		if err != nil {
			emit(wire.Response{ID: req.ID, Success: false, Error: err.Error(), Done: true})
			return
		}
		emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"sessions": list}, Done: true})
	})
	s.Handle("sessions.load", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		var pl struct {
			SessionID string `json:"session_id"`
			ID        string `json:"id"`
		}
		_ = json.Unmarshal(req.Payload, &pl)
		id := pl.SessionID
		if id == "" {
			id = pl.ID
		}
		if id == "" {
			emit(wire.Response{ID: req.ID, Success: false, Error: "session_id is required", Done: true})
			return
		}
		entries, err := sessions.Load(id)
		if err != nil {
			emit(wire.Response{ID: req.ID, Success: false, Error: err.Error(), Done: true})
			return
		}
		emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"id": id, "entries": entries}, Done: true})
	})
	s.Handle("sessions.list", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		list, err := sessions.List()
		if err != nil {
			emit(wire.Response{ID: req.ID, Success: false, Error: err.Error(), Done: true})
			return
		}
		emit(wire.Response{ID: req.ID, Success: true, Data: list, Done: true})
	})
	s.Handle("sessions.get", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		var pl struct {
			SessionID string `json:"session_id"`
		}
		_ = json.Unmarshal(req.Payload, &pl)
		if pl.SessionID == "" {
			emit(wire.Response{ID: req.ID, Success: false, Error: "payload.session_id is required", Done: true})
			return
		}
		entries, err := sessions.Load(pl.SessionID)
		if err != nil {
			emit(wire.Response{ID: req.ID, Success: false, Error: err.Error(), Done: true})
			return
		}
		emit(wire.Response{ID: req.ID, Success: true, Data: entries, Done: true})
	})
	// Prompt streaming Append()s as it goes, but the UI also wants to
	// hard-replace a session (rare — usually after manual edit) and
	// delete one. Both are real disk ops.
	s.Handle("sessions.save", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		var pl struct {
			SessionID string          `json:"session_id"`
			ID        string          `json:"id"`
			Entries   []session.Entry `json:"entries"`
		}
		_ = json.Unmarshal(req.Payload, &pl)
		id := pl.SessionID
		if id == "" {
			id = pl.ID
		}
		if id == "" {
			emit(wire.Response{ID: req.ID, Success: false, Error: "session_id is required", Done: true})
			return
		}
		if err := sessions.Save(id, pl.Entries); err != nil {
			emit(wire.Response{ID: req.ID, Success: false, Error: err.Error(), Done: true})
			return
		}
		emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"id": id, "count": len(pl.Entries)}, Done: true})
	})
	s.Handle("sessions.delete", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		var pl struct {
			SessionID string `json:"session_id"`
			ID        string `json:"id"`
		}
		_ = json.Unmarshal(req.Payload, &pl)
		id := pl.SessionID
		if id == "" {
			id = pl.ID
		}
		if id == "" {
			emit(wire.Response{ID: req.ID, Success: false, Error: "session_id is required", Done: true})
			return
		}
		if err := sessions.Delete(id); err != nil {
			emit(wire.Response{ID: req.ID, Success: false, Error: err.Error(), Done: true})
			return
		}
		emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"id": id, "deleted": true}, Done: true})
	})
}

func registerAIConversationHandlers(s *sidecar.Server, sessions *session.Store) {
	s.Handle("ai.conversations.list", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		list, _ := sessions.List()
		emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"conversations": list}, Done: true})
	})
	s.Handle("ai.conversations.get", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		var pl struct {
			ID string `json:"id"`
		}
		_ = json.Unmarshal(req.Payload, &pl)
		entries, _ := sessions.Load(pl.ID)
		emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"id": pl.ID, "entries": entries}, Done: true})
	})
	s.Handle("ai.conversations.save", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		var pl struct {
			ID      string          `json:"id"`
			Entries []session.Entry `json:"entries"`
		}
		_ = json.Unmarshal(req.Payload, &pl)
		if pl.ID == "" {
			emit(wire.Response{ID: req.ID, Success: false, Error: "id is required", Done: true})
			return
		}
		if err := sessions.Save(pl.ID, pl.Entries); err != nil {
			emit(wire.Response{ID: req.ID, Success: false, Error: err.Error(), Done: true})
			return
		}
		emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"id": pl.ID, "count": len(pl.Entries)}, Done: true})
	})
	s.Handle("ai.conversations.delete", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		var pl struct {
			ID string `json:"id"`
		}
		_ = json.Unmarshal(req.Payload, &pl)
		if pl.ID == "" {
			emit(wire.Response{ID: req.ID, Success: false, Error: "id is required", Done: true})
			return
		}
		if err := sessions.Delete(pl.ID); err != nil {
			emit(wire.Response{ID: req.ID, Success: false, Error: err.Error(), Done: true})
			return
		}
		emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"id": pl.ID, "deleted": true}, Done: true})
	})
}
