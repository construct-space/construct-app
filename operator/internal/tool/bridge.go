// Bridge-backed tools expose underscore-named public tool IDs while forwarding
// to dotted desktop bridge RPC methods underneath.
package tool

import (
	"construct-operator/internal/desktop"
	"construct-operator/internal/provider"
	"context"
	"encoding/json"
	"fmt"
	"os"
)

// RegisterBridgeTools adds all bridge-backed automation tools to the registry.
// If bridge is nil (no CONSTRUCT_BRIDGE_TOKEN), tools are not registered.
func RegisterBridgeTools(r *Registry, bridge *desktop.Client) {
	if bridge == nil {
		return
	}

	// --- Space tools (semantic automation) ---

	r.Register(bridgeTool(bridge, "space_snapshot", "space.snapshot",
		"Get structured state from a Construct space. Returns the space's current view, form fields, and available actions.",
		map[string]any{
			"type": "object",
			"properties": map[string]any{
				"space_id": map[string]any{
					"type":        "string",
					"description": "Space ID (defaults to active space)",
				},
			},
		},
	))

	r.Register(bridgeTool(bridge, "space_list_actions", "space.list_actions",
		"List available semantic actions for a space. Each action has an ID, description, and parameter schema.",
		map[string]any{
			"type": "object",
			"properties": map[string]any{
				"space_id": map[string]any{
					"type":        "string",
					"description": "Space ID (defaults to active space)",
				},
			},
		},
	))

	r.Register(bridgeTool(bridge, "space_run_action", "space.run_action",
		"Execute a semantic action in a Construct space (e.g. create a project, fill a form, submit).",
		map[string]any{
			"type": "object",
			"properties": map[string]any{
				"space_id": map[string]any{
					"type":        "string",
					"description": "Space ID (defaults to active space)",
				},
				"action": map[string]any{
					"type":        "string",
					"description": "Action ID from space_list_actions",
				},
				"payload": map[string]any{
					"type":        "object",
					"description": "Action parameters",
				},
			},
			"required": []string{"action"},
		},
	))

	// --- Browser tools (generic DOM automation) ---

	r.Register(bridgeTool(bridge, "browser_tabs", "browser.tabs",
		"List open browser tabs with their IDs, URLs, and titles. Last-resort DOM automation tool; prefer semantic Construct actions when available.",
		map[string]any{
			"type":       "object",
			"properties": map[string]any{},
		},
	))

	r.Register(bridgeTool(bridge, "browser_open", "browser.open",
		"Open a new browser tab. Last-resort DOM automation tool; do not use for normal Construct preview or run flows.",
		map[string]any{
			"type": "object",
			"properties": map[string]any{
				"url": map[string]any{
					"type":        "string",
					"description": "URL to open",
				},
			},
			"required": []string{"url"},
		},
	))

	r.Register(bridgeTool(bridge, "browser_close", "browser.close",
		"Close a browser tab.",
		map[string]any{
			"type": "object",
			"properties": map[string]any{
				"tab_id": map[string]any{
					"type":        "string",
					"description": "Tab ID from browser_tabs",
				},
			},
			"required": []string{"tab_id"},
		},
	))

	r.Register(bridgeTool(bridge, "browser_navigate", "browser.navigate",
		"Navigate a browser tab to a URL. Last-resort DOM automation tool; prefer semantic Construct actions when available.",
		map[string]any{
			"type": "object",
			"properties": map[string]any{
				"tab_id": map[string]any{
					"type":        "string",
					"description": "Tab ID",
				},
				"url": map[string]any{
					"type":        "string",
					"description": "URL to navigate to",
				},
			},
			"required": []string{"tab_id", "url"},
		},
	))

	r.Register(bridgeTool(bridge, "browser_snapshot", "browser.snapshot",
		"Get a structured DOM snapshot of a browser tab. Returns an accessibility-tree style node tree, not raw HTML. Use only when semantic Construct actions cannot achieve the task.",
		map[string]any{
			"type": "object",
			"properties": map[string]any{
				"tab_id": map[string]any{
					"type":        "string",
					"description": "Tab ID",
				},
			},
			"required": []string{"tab_id"},
		},
	))

	r.Register(bridgeTool(bridge, "browser_click", "browser.click",
		"Click an element in a browser tab by node ID or CSS selector. Use only when semantic Construct actions cannot achieve the task.",
		map[string]any{
			"type": "object",
			"properties": map[string]any{
				"tab_id": map[string]any{
					"type":        "string",
					"description": "Tab ID",
				},
				"node_id": map[string]any{
					"type":        "string",
					"description": "Node ID from browser_snapshot",
				},
				"selector": map[string]any{
					"type":        "string",
					"description": "CSS selector (fallback if no node_id)",
				},
			},
			"required": []string{"tab_id"},
		},
	))

	r.Register(bridgeTool(bridge, "browser_type", "browser.type",
		"Type text into an element in a browser tab. Use only when semantic Construct actions cannot achieve the task.",
		map[string]any{
			"type": "object",
			"properties": map[string]any{
				"tab_id": map[string]any{
					"type":        "string",
					"description": "Tab ID",
				},
				"node_id": map[string]any{
					"type":        "string",
					"description": "Node ID from browser_snapshot",
				},
				"selector": map[string]any{
					"type":        "string",
					"description": "CSS selector (fallback if no node_id)",
				},
				"text": map[string]any{
					"type":        "string",
					"description": "Text to type",
				},
				"clear": map[string]any{
					"type":        "boolean",
					"description": "Clear existing value first (default false)",
				},
			},
			"required": []string{"tab_id", "text"},
		},
	))

	r.Register(bridgeTool(bridge, "browser_press_key", "browser.press_key",
		"Press a key in a browser tab. Use only when semantic Construct actions cannot achieve the task.",
		map[string]any{
			"type": "object",
			"properties": map[string]any{
				"tab_id": map[string]any{
					"type":        "string",
					"description": "Tab ID",
				},
				"key": map[string]any{
					"type":        "string",
					"description": "Key name (e.g. Enter, Tab, Escape, ArrowDown)",
				},
				"modifiers": map[string]any{
					"type":        "array",
					"items":       map[string]any{"type": "string"},
					"description": "Modifier keys: Ctrl, Alt, Shift, Meta",
				},
			},
			"required": []string{"tab_id", "key"},
		},
	))

	r.Register(bridgeTool(bridge, "browser_wait_for", "browser.wait_for",
		"Wait for an element to reach a state in a browser tab. Use only when semantic Construct actions cannot achieve the task.",
		map[string]any{
			"type": "object",
			"properties": map[string]any{
				"tab_id": map[string]any{
					"type":        "string",
					"description": "Tab ID",
				},
				"selector": map[string]any{
					"type":        "string",
					"description": "CSS selector to wait for",
				},
				"state": map[string]any{
					"type":        "string",
					"enum":        []string{"visible", "hidden", "attached"},
					"description": "Target state (default: visible)",
				},
				"timeout_ms": map[string]any{
					"type":        "integer",
					"description": "Timeout in milliseconds (default: 5000)",
				},
			},
			"required": []string{"tab_id", "selector"},
		},
	))

	r.Register(bridgeTool(bridge, "browser_screenshot", "browser.screenshot",
		"Take a screenshot of a browser tab. Returns the file path to the screenshot image.",
		map[string]any{
			"type": "object",
			"properties": map[string]any{
				"tab_id": map[string]any{
					"type":        "string",
					"description": "Tab ID",
				},
				"full_page": map[string]any{
					"type":        "boolean",
					"description": "Capture full page, not just viewport (default false)",
				},
			},
			"required": []string{"tab_id"},
		},
	))

	// --- Construct lifecycle ---

	r.Register(bridgeTool(bridge, "construct_open_dev", "construct.open_dev",
		"Launch Construct DEV — an isolated dev instance for testing spaces. Spaces installed via 'construct dev' appear here without affecting the production app.",
		map[string]any{
			"type":       "object",
			"properties": map[string]any{},
		},
	))
}

// bridgeTool creates a tool that forwards its input to the desktop bridge.
// Public tool IDs use underscore naming; the desktop bridge method can keep its
// dotted RPC-style identifier independently.
func bridgeTool(bridge *desktop.Client, name, method, description string, schema map[string]any) *Tool {
	return &Tool{
		Def: provider.ToolDef{
			Name:        name,
			Description: description,
			InputSchema: schema,
		},
		Executor: &bridgeExec{bridge: bridge, method: method},
		Source:   "builtin",
	}
}

type bridgeExec struct {
	bridge *desktop.Client
	method string
}

func (b *bridgeExec) Execute(ctx context.Context, input string) (*Result, error) {
	var params map[string]any
	if input != "" && input != "{}" {
		if err := json.Unmarshal([]byte(input), &params); err != nil {
			return &Result{Content: fmt.Sprintf("invalid input: %v", err), IsError: true}, nil
		}
	}

	result, err := b.bridge.Call(ctx, b.method, params)
	if err != nil {
		return &Result{Content: fmt.Sprintf("bridge error: %v", err), IsError: true}, nil
	}

	return &Result{Content: string(result)}, nil
}

// RegisterSpaceActionTools queries each space for its actions via the bridge
// and registers each action as a dedicated tool: {spaceId}_{actionId}.
// This runs async after the bridge is connected.
func RegisterSpaceActionTools(r *Registry, bridge *desktop.Client, spaceIDs []string) {
	if bridge == nil {
		return
	}

	for _, spaceID := range spaceIDs {
		sid := spaceID
		// Query space for its actions
		result, err := bridge.Call(context.Background(), "space.list_actions", map[string]any{
			"space_id": sid,
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "[tools] space %q list_actions failed: %v\n", sid, err)
			continue
		}

		var resp struct {
			SpaceID string `json:"space_id"`
			Actions []struct {
				ID          string         `json:"id"`
				Description string         `json:"description"`
				Params      map[string]any `json:"params"`
			} `json:"actions"`
		}
		if err := json.Unmarshal(result, &resp); err != nil {
			continue
		}

		for _, action := range resp.Actions {
			act := action
			toolName := fmt.Sprintf("%s_%s", sid, act.ID)
			// Skip if already registered
			if _, exists := r.Get(toolName); exists {
				continue
			}
			schema := act.Params
			if schema == nil {
				schema = map[string]any{"type": "object", "properties": map[string]any{}}
			}

			r.Register(&Tool{
				Def: provider.ToolDef{
					Name:        toolName,
					Description: fmt.Sprintf("[%s] %s", sid, act.Description),
					InputSchema: schema,
				},
				Executor: &spaceActionExec{
					bridge:  bridge,
					spaceID: sid,
					action:  act.ID,
				},
				Source: "space:" + sid,
			})
		}

		if len(resp.Actions) > 0 {
			fmt.Fprintf(os.Stderr, "[tools] registered %d actions for space %q\n", len(resp.Actions), sid)
		}
	}
}

// spaceActionExec calls space.run_action for a specific space + action.
type spaceActionExec struct {
	bridge  *desktop.Client
	spaceID string
	action  string
}

func (e *spaceActionExec) Execute(ctx context.Context, input string) (*Result, error) {
	var payload map[string]any
	if input != "" && input != "{}" {
		json.Unmarshal([]byte(input), &payload)
	}

	params := map[string]any{
		"space_id": e.spaceID,
		"action":   e.action,
	}
	if payload != nil {
		params["payload"] = payload
	}

	result, err := e.bridge.Call(ctx, "space.run_action", params)
	if err != nil {
		return &Result{Content: fmt.Sprintf("action error: %v", err), IsError: true}, nil
	}

	return &Result{Content: string(result)}, nil
}
