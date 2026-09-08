package tool

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"

	"github.com/construct-space/brain/bridge"
	"github.com/construct-space/brain/provider"
)

// Browser automation tools drive Construct's in-app browser window through the
// host bridge (`browser.*` methods → desktop/src/browser_bridge.rs, which
// injects `window.__CONSTRUCT_AUTO__` from automation.js to act on the page).
//
// The agent's loop is: browser_open / browser_navigate → browser_snapshot
// (assigns a stable node_id to each interactable element) → browser_click /
// browser_type / browser_press_key → browser_snapshot again to confirm. Every
// op targets a `tab_id`; browser_open returns one. Elements are addressed by
// the node_id the snapshot assigns (or a CSS selector) — never by pixel
// coordinates — so the model never has to guess where to click.
//
// Scope: this drives the IN-APP Construct browser only, not arbitrary OS
// windows. The bridge also exposes OS-level mouse automation
// (construct.mouse_*), deliberately NOT surfaced here — it can click
// Construct's own UI and needs Accessibility permission, so it stays out of
// the agent's reach until there's a clear, gated use for it.

// browserCall is the shared bridge dispatch + availability guard for every
// browser tool. Forwards the model-supplied params verbatim — the JSON field
// names in each tool's InputSchema match the params browser_bridge.rs reads.
func browserCall(ctx context.Context, b *bridge.Client, method string, params map[string]any) (string, error) {
	if b == nil || !b.Available() {
		return "", fmt.Errorf("bridge to host is not available; browser tools only work when brain runs as a Tauri sidecar")
	}
	data, err := b.Call(ctx, method, params)
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// browserParams unmarshals the tool input into a forwardable param map. The
// registry already validated required fields against InputSchema before
// Execute runs, so this only needs to surface malformed JSON.
func browserParams(raw json.RawMessage) (map[string]any, error) {
	params := map[string]any{}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &params); err != nil {
			return nil, fmt.Errorf("invalid input: %w", err)
		}
	}
	return params, nil
}

func nonEmptyString(v any) bool {
	s, ok := v.(string)
	return ok && s != ""
}

// --- browser_open -----------------------------------------------------------

type BrowserOpen struct{ Bridge *bridge.Client }

func (BrowserOpen) Name() string { return "browser_open" }

func (BrowserOpen) Description() string {
	return "Open Construct's in-app browser (creating the browser window if needed) and return a tab_id. Pass that tab_id to every other browser_* tool. Omit url to open the browser home. After opening, call browser_snapshot to see the page's interactable elements."
}

func (BrowserOpen) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"url": map[string]any{
				"type":        "string",
				"description": "URL to load (e.g. https://example.com). Omit to open the browser home page.",
			},
		},
	}
}

func (t BrowserOpen) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	params, err := browserParams(raw)
	if err != nil {
		return "", err
	}
	return browserCall(ctx, t.Bridge, "browser.open", params)
}

// --- browser_tabs -----------------------------------------------------------

type BrowserTabs struct{ Bridge *bridge.Client }

func (BrowserTabs) Name() string { return "browser_tabs" }

func (BrowserTabs) Description() string {
	return "List the open browser tabs (tab_id, url, title, active). Use to recover a tab_id when you didn't open the tab yourself or lost track of it."
}

func (BrowserTabs) InputSchema() map[string]any {
	return map[string]any{"type": "object", "properties": map[string]any{}}
}

func (t BrowserTabs) Execute(ctx context.Context, _ json.RawMessage) (string, error) {
	return browserCall(ctx, t.Bridge, "browser.tabs", map[string]any{})
}

// --- browser_navigate -------------------------------------------------------

type BrowserNavigate struct{ Bridge *bridge.Client }

func (BrowserNavigate) Name() string { return "browser_navigate" }

func (BrowserNavigate) Description() string {
	return "Navigate an existing tab to a new URL. Re-snapshot after the page loads (or use browser_wait_for) before acting on it."
}

func (BrowserNavigate) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"tab_id": map[string]any{"type": "string", "description": "Tab to navigate (from browser_open / browser_tabs)."},
			"url":    map[string]any{"type": "string", "description": "URL to load."},
		},
		"required": []string{"tab_id", "url"},
	}
}

func (t BrowserNavigate) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	params, err := browserParams(raw)
	if err != nil {
		return "", err
	}
	return browserCall(ctx, t.Bridge, "browser.navigate", params)
}

// --- browser_snapshot -------------------------------------------------------

type BrowserSnapshot struct{ Bridge *bridge.Client }

func (BrowserSnapshot) Name() string { return "browser_snapshot" }

func (BrowserSnapshot) Description() string {
	return "Capture an interactable snapshot of the tab's DOM: each clickable/editable element gets a stable node_id plus its role, text, and key attributes (href, placeholder, aria-label, …). Pass those node_ids to browser_click / browser_type / browser_press_key. Re-snapshot after any action that changes the page — node_ids are rebuilt each call."
}

func (BrowserSnapshot) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"tab_id": map[string]any{"type": "string", "description": "Tab to snapshot (from browser_open / browser_tabs)."},
		},
		"required": []string{"tab_id"},
	}
}

func (t BrowserSnapshot) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	params, err := browserParams(raw)
	if err != nil {
		return "", err
	}
	return browserCall(ctx, t.Bridge, "browser.snapshot", params)
}

// --- browser_click ----------------------------------------------------------

type BrowserClick struct{ Bridge *bridge.Client }

func (BrowserClick) Name() string { return "browser_click" }

func (BrowserClick) Description() string {
	return "Click an element in the tab, addressed by node_id (from browser_snapshot, preferred) or a CSS selector. Re-snapshot afterward to observe the result."
}

func (BrowserClick) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"tab_id":   map[string]any{"type": "string", "description": "Target tab."},
			"node_id":  map[string]any{"type": "string", "description": "node_id from browser_snapshot (preferred)."},
			"selector": map[string]any{"type": "string", "description": "CSS selector, as an alternative to node_id."},
		},
		"required": []string{"tab_id"},
	}
}

func (t BrowserClick) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	params, err := browserParams(raw)
	if err != nil {
		return "", err
	}
	if !nonEmptyString(params["node_id"]) && !nonEmptyString(params["selector"]) {
		return "", fmt.Errorf("provide node_id (from browser_snapshot) or selector")
	}
	return browserCall(ctx, t.Bridge, "browser.click", params)
}

// --- browser_type -----------------------------------------------------------

type BrowserType struct{ Bridge *bridge.Client }

func (BrowserType) Name() string { return "browser_type" }

func (BrowserType) Description() string {
	return "Type text into an input/textarea, addressed by node_id (from browser_snapshot, preferred) or a CSS selector. Set clear:true to replace existing content. To submit, follow with browser_press_key key:\"Enter\"."
}

func (BrowserType) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"tab_id":   map[string]any{"type": "string", "description": "Target tab."},
			"text":     map[string]any{"type": "string", "description": "Text to type."},
			"node_id":  map[string]any{"type": "string", "description": "node_id from browser_snapshot (preferred)."},
			"selector": map[string]any{"type": "string", "description": "CSS selector, as an alternative to node_id."},
			"clear":    map[string]any{"type": "boolean", "description": "Clear the field before typing (default false)."},
		},
		"required": []string{"tab_id", "text"},
	}
}

func (t BrowserType) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	params, err := browserParams(raw)
	if err != nil {
		return "", err
	}
	if !nonEmptyString(params["node_id"]) && !nonEmptyString(params["selector"]) {
		return "", fmt.Errorf("provide node_id (from browser_snapshot) or selector")
	}
	return browserCall(ctx, t.Bridge, "browser.type", params)
}

// --- browser_press_key ------------------------------------------------------

type BrowserPressKey struct{ Bridge *bridge.Client }

func (BrowserPressKey) Name() string { return "browser_press_key" }

func (BrowserPressKey) Description() string {
	return "Press a key (e.g. \"Enter\", \"Escape\", \"Tab\") on an element or the page, with optional modifiers. Pressing Enter inside a form field submits the form."
}

func (BrowserPressKey) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"tab_id":   map[string]any{"type": "string", "description": "Target tab."},
			"key":      map[string]any{"type": "string", "description": "Key name, e.g. \"Enter\", \"Escape\", \"Tab\", \"ArrowDown\"."},
			"node_id":  map[string]any{"type": "string", "description": "node_id to target (optional; defaults to the focused element)."},
			"selector": map[string]any{"type": "string", "description": "CSS selector to target (optional)."},
			"modifiers": map[string]any{
				"type":        "array",
				"items":       map[string]any{"type": "string"},
				"description": "Modifier keys held during the press, e.g. [\"Meta\"], [\"Shift\",\"Alt\"].",
			},
		},
		"required": []string{"tab_id", "key"},
	}
}

func (t BrowserPressKey) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	params, err := browserParams(raw)
	if err != nil {
		return "", err
	}
	return browserCall(ctx, t.Bridge, "browser.press_key", params)
}

// --- browser_wait_for -------------------------------------------------------

type BrowserWaitFor struct{ Bridge *bridge.Client }

func (BrowserWaitFor) Name() string { return "browser_wait_for" }

func (BrowserWaitFor) Description() string {
	return "Wait until an element matching a CSS selector reaches a state (visible | hidden | attached) or the timeout elapses. Use after navigation or a click that triggers async content before snapshotting again."
}

func (BrowserWaitFor) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"tab_id":   map[string]any{"type": "string", "description": "Target tab."},
			"selector": map[string]any{"type": "string", "description": "CSS selector to wait for."},
			"state": map[string]any{
				"type":        "string",
				"enum":        []string{"visible", "hidden", "attached"},
				"description": "State to wait for (default visible).",
			},
			"timeout_ms": map[string]any{"type": "integer", "description": "Max wait in milliseconds (default host value)."},
		},
		"required": []string{"tab_id", "selector"},
	}
}

func (t BrowserWaitFor) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	params, err := browserParams(raw)
	if err != nil {
		return "", err
	}
	return browserCall(ctx, t.Bridge, "browser.wait_for", params)
}

// --- browser_screenshot -----------------------------------------------------

type BrowserScreenshot struct{ Bridge *bridge.Client }

func (BrowserScreenshot) Name() string { return "browser_screenshot" }

func (BrowserScreenshot) Description() string {
	return "Capture a screenshot of a browser tab and return it as an image so you can SEE the rendered page (snapshots give you the DOM; this gives you the pixels). Defaults to the active tab; set full_page:true for the entire scrollable page."
}

func (BrowserScreenshot) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"tab_id":    map[string]any{"type": "string", "description": "Tab to capture (defaults to the active tab)."},
			"full_page": map[string]any{"type": "boolean", "description": "Capture the full scrollable page instead of the viewport (default false)."},
		},
	}
}

func (t BrowserScreenshot) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	params, err := browserParams(raw)
	if err != nil {
		return "", err
	}
	return browserCall(ctx, t.Bridge, "browser.screenshot", params)
}

// ResultImages reads the captured PNG off disk and hands it to the model as an
// image block. The host's browser.screenshot response is {tab_id, path,
// data_uri, width, height}; we read `path` (same approach as ScreenshotWindow).
func (BrowserScreenshot) ResultImages(output string) []provider.ImageBlock {
	var resp struct {
		Path string `json:"path"`
	}
	if err := json.Unmarshal([]byte(output), &resp); err != nil || resp.Path == "" {
		return nil
	}
	bytes, err := os.ReadFile(resp.Path)
	if err != nil || len(bytes) == 0 {
		return nil
	}
	return []provider.ImageBlock{{
		MediaType: "image/png",
		Data:      base64.StdEncoding.EncodeToString(bytes),
	}}
}

// --- browser_reset ----------------------------------------------------------

type BrowserReset struct{ Bridge *bridge.Client }

func (BrowserReset) Name() string { return "browser_reset" }

func (BrowserReset) Description() string {
	return "Force-close the entire in-app browser window (not just a tab) to recover when it's wedged — e.g. browser_open/navigate/snapshot all time out. Use this when browser tools stop responding, then browser_open a fresh tab. Pure window close, so it works even when the browser's eval channel is stuck."
}

func (BrowserReset) InputSchema() map[string]any {
	return map[string]any{"type": "object", "properties": map[string]any{}}
}

func (t BrowserReset) Execute(ctx context.Context, _ json.RawMessage) (string, error) {
	return browserCall(ctx, t.Bridge, "browser.close_window", map[string]any{})
}

// --- browser_close ----------------------------------------------------------

type BrowserClose struct{ Bridge *bridge.Client }

func (BrowserClose) Name() string { return "browser_close" }

func (BrowserClose) Description() string {
	return "Close a browser tab by tab_id when you're done with it."
}

func (BrowserClose) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"tab_id": map[string]any{"type": "string", "description": "Tab to close."},
		},
		"required": []string{"tab_id"},
	}
}

func (t BrowserClose) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	params, err := browserParams(raw)
	if err != nil {
		return "", err
	}
	return browserCall(ctx, t.Bridge, "browser.close", params)
}
