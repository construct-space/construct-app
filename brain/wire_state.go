// Wire handlers backed by brain/state — KV, settings, runtime, and
// project-scoped settings. Each register* function attaches all the
// ops in its group to the sidecar; main.go just calls them.
package main

import (
	"context"
	"encoding/json"

	"github.com/construct-space/brain/sidecar"
	"github.com/construct-space/brain/state"
	"github.com/construct-space/brain/wire"
)

func registerKVHandlers(s *sidecar.Server, store *state.Store) {
	s.Handle("kv.get", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		var pl struct {
			Key string `json:"key"`
		}
		_ = json.Unmarshal(req.Payload, &pl)
		v, ok := store.KVGet(pl.Key)
		if !ok {
			emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"value": nil}, Done: true})
			return
		}
		emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"value": v}, Done: true})
	})
	s.Handle("kv.set", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		var pl struct {
			Key   string          `json:"key"`
			Value json.RawMessage `json:"value"`
		}
		_ = json.Unmarshal(req.Payload, &pl)
		if pl.Key == "" {
			emit(wire.Response{ID: req.ID, Success: false, Error: "key is required", Done: true})
			return
		}
		if err := store.KVSet(pl.Key, pl.Value); err != nil {
			emit(wire.Response{ID: req.ID, Success: false, Error: err.Error(), Done: true})
			return
		}
		emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}, Done: true})
	})
	s.Handle("kv.delete", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		var pl struct {
			Key string `json:"key"`
		}
		_ = json.Unmarshal(req.Payload, &pl)
		if err := store.KVDelete(pl.Key); err != nil {
			emit(wire.Response{ID: req.ID, Success: false, Error: err.Error(), Done: true})
			return
		}
		emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}, Done: true})
	})
	s.Handle("kv.list", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"keys": store.KVList()}, Done: true})
	})
}

func registerSettingsHandlers(s *sidecar.Server, store *state.Store) {
	s.Handle("settings.get", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		var pl struct {
			Key string `json:"key"`
		}
		_ = json.Unmarshal(req.Payload, &pl)
		if pl.Key == "" {
			emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"value": store.SettingsAll()}, Done: true})
			return
		}
		v, ok := store.SettingsGet(pl.Key)
		if !ok {
			emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"value": nil}, Done: true})
			return
		}
		emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"value": v}, Done: true})
	})
	s.Handle("settings.set", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		var pl struct {
			Key   string          `json:"key"`
			Value json.RawMessage `json:"value"`
		}
		_ = json.Unmarshal(req.Payload, &pl)
		if pl.Key == "" {
			emit(wire.Response{ID: req.ID, Success: false, Error: "key is required", Done: true})
			return
		}
		if err := store.SettingsSet(pl.Key, pl.Value); err != nil {
			emit(wire.Response{ID: req.ID, Success: false, Error: err.Error(), Done: true})
			return
		}
		emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}, Done: true})
	})
}

// registerRuntimeHandlers wires construct_projects_root + runtime.set +
// project_settings.{get,set}. cwdFn is injected so tests can override
// the "no active project → fall back to CWD" lookup.
func registerRuntimeHandlers(s *sidecar.Server, store *state.Store, cwdFn func() string) {
	s.Handle("construct_projects_root", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		rt := store.RuntimeGet()
		root := rt.ActiveProjectPath
		if root == "" {
			root = cwdFn()
		}
		emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{
			"root":              root,
			"active_project_id": rt.ActiveProjectID,
			"active_org_id":     rt.ActiveOrgID,
			"active_space_id":   rt.ActiveSpaceID,
		}, Done: true})
	})
	s.Handle("runtime.set", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		var rt state.RuntimeState
		if err := json.Unmarshal(req.Payload, &rt); err != nil {
			emit(wire.Response{ID: req.ID, Success: false, Error: err.Error(), Done: true})
			return
		}
		if err := store.RuntimeSet(rt); err != nil {
			emit(wire.Response{ID: req.ID, Success: false, Error: err.Error(), Done: true})
			return
		}
		emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}, Done: true})
	})
	s.Handle("project_settings.get", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		var pl struct {
			ProjectID string `json:"project_id"`
		}
		_ = json.Unmarshal(req.Payload, &pl)
		emit(wire.Response{ID: req.ID, Success: true, Data: store.ProjectSettingsGet(pl.ProjectID), Done: true})
	})
	s.Handle("project_settings.set", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		var pl struct {
			ProjectID string          `json:"project_id"`
			Key       string          `json:"key"`
			Value     json.RawMessage `json:"value"`
		}
		_ = json.Unmarshal(req.Payload, &pl)
		if err := store.ProjectSettingsSet(pl.ProjectID, pl.Key, pl.Value); err != nil {
			emit(wire.Response{ID: req.ID, Success: false, Error: err.Error(), Done: true})
			return
		}
		emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}, Done: true})
	})
}
