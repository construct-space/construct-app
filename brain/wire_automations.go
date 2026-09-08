// Automation rule CRUD + run-now for the Settings UI.
package main

import (
	"context"
	"encoding/json"

	"github.com/construct-space/brain/sidecar"
	"github.com/construct-space/brain/wire"
)

func registerAutomationHandlers(s *sidecar.Server, rt *automationRuntime) {
	s.Handle("automations.list", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"automations": rt.store.List()}, Done: true})
	})

	s.Handle("automations.save", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		var a Automation
		if err := json.Unmarshal(req.Payload, &a); err != nil {
			emit(wire.Response{ID: req.ID, Success: false, Error: "invalid body", Done: true})
			return
		}
		saved, err := rt.store.Save(a)
		if err != nil {
			emit(wire.Response{ID: req.ID, Success: false, Error: err.Error(), Done: true})
			return
		}
		emit(wire.Response{ID: req.ID, Success: true, Data: saved, Done: true})
	})

	s.Handle("automations.delete", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		var pl struct {
			ID string `json:"id"`
		}
		_ = json.Unmarshal(req.Payload, &pl)
		if err := rt.store.Delete(pl.ID); err != nil {
			emit(wire.Response{ID: req.ID, Success: false, Error: err.Error(), Done: true})
			return
		}
		emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}, Done: true})
	})

	// Run a rule immediately (test button). Runs synchronously and returns the
	// reactor's summary.
	s.Handle("automations.run", func(ctx context.Context, req wire.Request, emit func(wire.Response)) {
		var pl struct {
			ID string `json:"id"`
		}
		_ = json.Unmarshal(req.Payload, &pl)
		var rule *Automation
		for _, a := range rt.store.List() {
			if a.ID == pl.ID {
				a := a
				rule = &a
				break
			}
		}
		if rule == nil {
			emit(wire.Response{ID: req.ID, Success: false, Error: "automation not found", Done: true})
			return
		}
		res, err := rt.runOne(ctx, *rule)
		if err != nil {
			emit(wire.Response{ID: req.ID, Success: false, Error: err.Error(), Done: true})
			return
		}
		rt.store.markRun(rule.ID, res)
		emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"result": res}, Done: true})
	})
}
