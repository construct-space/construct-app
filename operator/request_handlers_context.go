package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"construct-operator/internal/runner"
	"construct-operator/internal/transport"
)

func (rt *operatorRuntime) handleContextRequest(reqCtx context.Context, req transport.Request) (transport.Response, bool) {
	switch req.Type {
	case "context.set_project":
		var proj runner.ProjectContext
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &proj)
		}
		clientID := clientKey(req.ClientID)
		rt.setProject(clientID, &proj)
		fmt.Fprintf(os.Stderr, "[operator] project set (%s): %s (%s)\n", clientID, proj.Name, proj.RootPath)
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}, true

	case "context.set_mode":
		var payload struct {
			Mode string `json:"mode"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		rt.setClientMode(clientKey(req.ClientID), payload.Mode)
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}, true

	case "context.set_component":
		var payload map[string]any
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		rt.setClientComponent(clientKey(req.ClientID), payload)
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}, true

	case "context.set_selection":
		var payload map[string]any
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		rt.setClientSelection(clientKey(req.ClientID), payload)
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}, true

	case "context.clear_project":
		rt.clearProject(clientKey(req.ClientID))
		return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}, true

	case "context.get":
		return transport.Response{ID: req.ID, Success: true, Data: rt.contextData(reqCtx)}, true

	default:
		return transport.Response{}, false
	}
}
