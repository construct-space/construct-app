package tool

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/construct-space/brain/bridge"
)

// SpaceListActions asks the host for the action manifest of a space.
// Returns name + description + JSON schema per action, so the model can
// pick the right one and construct args. Cheap on-demand discovery —
// avoids shipping every action's schema in tools[] every turn.
type SpaceListActions struct {
	Bridge *bridge.Client
}

func (SpaceListActions) Name() string { return "space_list_actions" }

func (SpaceListActions) Description() string {
	return "List the actions a space exposes. Call this once when you decide a space is relevant; it returns action names, descriptions, and JSON schemas you can then invoke via space_run_action."
}

func (SpaceListActions) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"space": map[string]any{
				"type":        "string",
				"description": "Space id, e.g. 'board', 'calendar', 'canvas'.",
			},
		},
		"required": []string{"space"},
	}
}

func (s SpaceListActions) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	if s.Bridge == nil || !s.Bridge.Available() {
		return "", fmt.Errorf("bridge to host is not available; this tool only works when brain runs as a Tauri sidecar")
	}
	var in struct {
		Space string `json:"space"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fmt.Errorf("invalid input: %w", err)
	}
	if in.Space == "" {
		return "", fmt.Errorf("space is required")
	}
	// Bridge handler reads `space_id` (operator-era naming). Brain's tool
	// surface uses the shorter `space` for the model; translate here.
	data, err := s.Bridge.Call(ctx, "space.list_actions", map[string]string{"space_id": in.Space})
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// NavigateSpace navigates the main app window to an installed space — the
// "go to Mail / open Calendar" verb. Distinct from the browser_* tools (which
// drive the in-app WEB browser) and from start_preview (which opens a dev
// preview window): this just routes the user to a space they already have.
// Routes to the frontend's `space.navigate` handler over the SSE channel.
type NavigateSpace struct {
	Bridge *bridge.Client
}

func (NavigateSpace) Name() string { return "navigate_space" }

func (NavigateSpace) Description() string {
	return "Navigate the app to an installed space (e.g. Mail, Calendar, Board, Notes) or a well-known app destination. Use this whenever the user asks to open/go to a space or screen — that space's own agent has the right tools and context. Pick space_id from list_spaces for spaces; never invent a space id. Well-known destinations you can also pass as space_id: \"marketplace\" (the Space Store, where users browse/install spaces). Optionally pass `prompt` to forward the user's question so the destination space's agent can pick up the conversation. This is NOT the web browser (browser_open) — it switches the main app view. To capture what you navigated to, follow with screenshot_window."
}

func (NavigateSpace) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"space_id": map[string]any{
				"type":        "string",
				"description": "Installed space id from list_spaces, e.g. 'mail', 'calendar', 'board'.",
			},
			"page": map[string]any{
				"type":        "string",
				"description": "Optional sub-page within the space.",
			},
			"prompt": map[string]any{
				"type":        "string",
				"description": "Optional — the user's question, forwarded so the destination space's agent can answer immediately.",
			},
		},
		"required": []string{"space_id"},
	}
}

func (s NavigateSpace) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	if s.Bridge == nil || !s.Bridge.Available() {
		return "", fmt.Errorf("bridge to host is not available; this tool only works when brain runs as a Tauri sidecar")
	}
	var in struct {
		SpaceID string `json:"space_id"`
		Page    string `json:"page"`
		Prompt  string `json:"prompt"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fmt.Errorf("invalid input: %w", err)
	}
	if in.SpaceID == "" {
		return "", fmt.Errorf("space_id is required; call list_spaces to find it")
	}
	params := map[string]any{"space_id": in.SpaceID}
	if in.Page != "" {
		params["page"] = in.Page
	}
	if in.Prompt != "" {
		params["prompt"] = in.Prompt
	}
	data, err := s.Bridge.Call(ctx, "space.navigate", params)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// SpaceRunAction invokes one named action on a space with structured args.
// Implementation lives in the host (Tauri/Vue) — brain just proxies.
type SpaceRunAction struct {
	Bridge  *bridge.Client
	Runtime *SpaceRuntimeClient // headless fallback when no frontend bridge
}

func (SpaceRunAction) Name() string { return "space_run_action" }

func (SpaceRunAction) Description() string {
	return "Run one action on a space. Call space_list_actions first to learn names and arg shapes. Returns whatever the action returns (often a JSON object); is_error=true means the action failed and the message body explains why."
}

func (SpaceRunAction) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"space": map[string]any{
				"type":        "string",
				"description": "Space id, e.g. 'board'.",
			},
			"action": map[string]any{
				"type":        "string",
				"description": "Action name from space_list_actions, e.g. 'createTicket'.",
			},
			"args": map[string]any{
				"type":        "object",
				"description": "Action arguments matching the action's input schema.",
			},
		},
		"required": []string{"space", "action"},
	}
}

func (s SpaceRunAction) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	bridgeUp := s.Bridge != nil && s.Bridge.Available()
	if !bridgeUp && !s.Runtime.Available() {
		return "", fmt.Errorf("no execution path: neither the host bridge nor the space-runtime is available")
	}
	// Accept both schemas. Canonical is `space` + `args`, but models often
	// hallucinate `space_id` + `params` (the operator-era shape) despite
	// the system prompt explicitly saying otherwise. Tolerate both so a
	// single instruction-following slip doesn't waste a turn.
	var in struct {
		Space   string          `json:"space"`
		SpaceID string          `json:"space_id"`
		Action  string          `json:"action"`
		Args    json.RawMessage `json:"args"`
		Params  json.RawMessage `json:"params"`
		Payload json.RawMessage `json:"payload"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fmt.Errorf("invalid input: %w", err)
	}
	if in.Space == "" {
		in.Space = in.SpaceID
	}
	if len(in.Args) == 0 {
		if len(in.Params) > 0 {
			in.Args = in.Params
		} else if len(in.Payload) > 0 {
			in.Args = in.Payload
		}
	}
	if in.Space == "" || in.Action == "" {
		return "", fmt.Errorf("space and action are required")
	}
	// Capability router: prefer the frontend bridge (desktop, app open — runs
	// the action in the webview, unchanged). When there's no bridge (cloud
	// executor, or a headless desktop run) fall back to the space-runtime,
	// which runs the same action with no webview.
	if bridgeUp {
		// Bridge handler expects `space_id` + `payload` (operator-era naming).
		payload := map[string]any{"space_id": in.Space, "action": in.Action}
		if len(in.Args) > 0 {
			payload["payload"] = in.Args
		}
		data, err := s.Bridge.Call(ctx, "space.run_action", payload)
		if err != nil {
			return "", err
		}
		return string(data), nil
	}
	return s.Runtime.RunAction(ctx, in.Space, in.Action, in.Args)
}
