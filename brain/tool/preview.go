package tool

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/construct-space/brain/bridge"
	"github.com/construct-space/brain/state"
)

// StartPreview tells the host to start the in-app dev-server preview
// for the current project. Mirrors operator's thin contract: the tool
// just routes through the SSE bridge as `space.open_preview`, and the
// frontend's BuilderPage stream handler does the actual classification
// + spawn + URL detection.
type StartPreview struct {
	Frontend *bridge.Frontend
}

func (StartPreview) Name() string { return "start_preview" }

func (StartPreview) Description() string {
	return "Start the in-app dev-server preview for this project and open it. Works for JS/TS (Vite, Next, etc.), Go HTTP servers, Python (Flask/Django/FastAPI), Rust (Axum/Actix), and static sites. Call this when the user asks to run, start, preview, or open the project."
}

func (StartPreview) InputSchema() map[string]any {
	return map[string]any{"type": "object", "properties": map[string]any{}}
}

func (s StartPreview) Execute(ctx context.Context, _ json.RawMessage) (string, error) {
	if s.Frontend != nil && s.Frontend.Available() {
		out, err := s.Frontend.Call(ctx, "space.open_preview", map[string]any{"type": "web"})
		if err == nil {
			return string(out), nil
		}
		// Fall through to action-token shape so the agent gets a usable response.
	}
	out, _ := json.Marshal(map[string]string{"action": "preview_start"})
	return string(out), nil
}

// RequestProjectSetup asks the host to open its New Project modal. Used
// on turn 1 when the agent has no active project to work in.
// Blocks until the user confirms or cancels via the modal. On confirm,
// brain also updates state.RuntimeState so the next turn sees the new
// active project without the frontend re-pushing it.
type RequestProjectSetup struct {
	Frontend *bridge.Frontend
	State    *state.Store
}

func (RequestProjectSetup) Name() string { return "request_project_setup" }

func (RequestProjectSetup) Description() string {
	return "Ask the host to open its New Project modal so the user can create a project. Call ONLY on turn 1 when no active project exists. Pass a kebab-case suggested_name derived from the user's prompt. Blocks until the user confirms or cancels."
}

func (RequestProjectSetup) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"suggested_name":        map[string]any{"type": "string", "description": "kebab-case e.g. 'slides-space'"},
			"suggested_description": map[string]any{"type": "string"},
		},
		"required": []string{"suggested_name"},
	}
}

func (r RequestProjectSetup) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		SuggestedName        string `json:"suggested_name"`
		SuggestedDescription string `json:"suggested_description"`
	}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &in); err != nil {
			return "", fmt.Errorf("invalid input: %w", err)
		}
	}
	if in.SuggestedName == "" {
		return "", fmt.Errorf("suggested_name is required")
	}
	if r.Frontend == nil || !r.Frontend.Available() {
		return "", fmt.Errorf("New Project modal can only be opened from inside the Construct app. Ask the user to create the project manually.")
	}
	out, err := r.Frontend.Call(ctx, "project.create_modal", map[string]any{
		"suggested_name":        in.SuggestedName,
		"suggested_description": in.SuggestedDescription,
	})
	if err != nil {
		return "", err
	}
	// Parse the response and update active-project runtime state so
	// subsequent tool calls in this session see the new project.
	var resp struct {
		Path      string `json:"path"`
		Name      string `json:"name"`
		Cancelled bool   `json:"cancelled"`
	}
	_ = json.Unmarshal(out, &resp)
	if !resp.Cancelled && resp.Path != "" && r.State != nil {
		rt := r.State.RuntimeGet()
		rt.ActiveProjectPath = resp.Path
		_ = r.State.RuntimeSet(rt)
	}
	return string(out), nil
}
