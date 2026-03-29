// Package ctxmod implements the context module for Operator.
// The package is named ctxmod to avoid conflicts with the stdlib context package.
package ctxmod

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"construct-operator/internal/module"
	"construct-operator/internal/runner"
	"construct-operator/internal/transport"
)

// ContextModule handles all context.* requests: setting project, mode,
// component, selection, and retrieving the current context snapshot.
type ContextModule struct {
	module.DefaultModule
	appState *module.AppState
	workDir  string
}

// NewModule creates a ContextModule from the shared dependency bag.
func NewModule(deps module.Dependencies) module.Module {
	return &ContextModule{
		appState: deps.AppState,
		workDir:  deps.WorkDir,
	}
}

// ID returns the module identifier.
func (m *ContextModule) ID() string { return "context" }

// Routes registers all context.* request handlers.
func (m *ContextModule) Routes(r *module.Router) {
	r.Handle("context.set_project", m.handleSetProject)
	r.Handle("context.set_mode", m.handleSetMode)
	r.Handle("context.set_component", m.handleSetComponent)
	r.Handle("context.set_selection", m.handleSetSelection)
	r.Handle("context.clear_project", m.handleClearProject)
	r.Handle("context.get", m.handleGet)
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

func (m *ContextModule) handleSetProject(_ context.Context, req transport.Request) transport.Response {
	var proj runner.ProjectContext
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &proj)
	}
	cID := clientKey(req.ClientID)
	m.appState.SetProject(cID, &proj)
	fmt.Fprintf(os.Stderr, "[operator] project set (%s): %s (%s)\n", cID, proj.Name, proj.RootPath)
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}
}

func (m *ContextModule) handleSetMode(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		Mode string `json:"mode"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	m.appState.UpdateClient(clientKey(req.ClientID), func(c *module.ClientContext) {
		c.Mode = payload.Mode
	})
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}
}

func (m *ContextModule) handleSetComponent(_ context.Context, req transport.Request) transport.Response {
	var payload map[string]any
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	m.appState.UpdateClient(clientKey(req.ClientID), func(c *module.ClientContext) {
		c.Component = cloneMap(payload)
	})
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}
}

func (m *ContextModule) handleSetSelection(_ context.Context, req transport.Request) transport.Response {
	var payload map[string]any
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	m.appState.UpdateClient(clientKey(req.ClientID), func(c *module.ClientContext) {
		c.Selection = cloneMap(payload)
	})
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}
}

func (m *ContextModule) handleClearProject(_ context.Context, req transport.Request) transport.Response {
	m.appState.ClearProject(clientKey(req.ClientID))
	return transport.Response{ID: req.ID, Success: true, Data: map[string]any{"ok": true}}
}

func (m *ContextModule) handleGet(reqCtx context.Context, req transport.Request) transport.Response {
	data := m.contextData(reqCtx)
	return transport.Response{ID: req.ID, Success: true, Data: data}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func (m *ContextModule) contextData(reqCtx context.Context) map[string]any {
	clientID := transport.ClientIDFromContext(reqCtx)

	data := map[string]any{
		"workDir":   m.projectDir(clientID),
		"mode":      "code",
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	}
	if project, ok := m.appState.Project(clientID).(*runner.ProjectContext); ok && project != nil {
		data["project"] = project
	}
	if clientCtx := m.appState.Client(clientID); clientCtx != nil {
		rCtx := runnerContextFromClientState(clientCtx)
		for key, value := range rCtx {
			data[key] = value
		}
		if clientCtx.Timestamp != "" {
			data["timestamp"] = clientCtx.Timestamp
		}
	}
	return data
}

func (m *ContextModule) projectDir(clientID string) string {
	if proj, ok := m.appState.Project(clientID).(*runner.ProjectContext); ok && proj != nil && proj.RootPath != "" {
		return proj.RootPath
	}
	return m.workDir
}

func runnerContextFromClientState(state *module.ClientContext) map[string]any {
	if state == nil {
		return nil
	}
	result := map[string]any{}
	if state.Mode != "" {
		result["mode"] = state.Mode
	}
	if len(state.Component) > 0 {
		result["component"] = cloneMap(state.Component)
	}
	if len(state.Selection) > 0 {
		result["selection"] = cloneMap(state.Selection)
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func clientKey(clientID string) string {
	if clientID == "" {
		return "default"
	}
	return clientID
}

func cloneMap(input map[string]any) map[string]any {
	if len(input) == 0 {
		return nil
	}
	result := make(map[string]any, len(input))
	for key, value := range input {
		result[key] = value
	}
	return result
}
