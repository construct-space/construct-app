// Package bridge is brain's outbound channel to construct-app. Brain calls
// here when it needs the host to run something it can't do alone — execute
// a space action, take a screenshot, open a file dialog, etc.
//
// Wire: HTTP POST /bridge with `Authorization: Bearer <token>` and a JSON
// body `{id, method, params}`. The host listens on CONSTRUCT_BRIDGE_PORT
// (operator's existing 60101 listener — see desktop/src/bridge.rs).
package bridge

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"sync/atomic"
	"time"
)

// Client is configured once at startup; per-call HTTP requests are issued
// by Call. Safe for concurrent use.
type Client struct {
	Addr  string // "127.0.0.1:<port>"; empty = HTTP bridge disabled
	Token string // matches the host's BRIDGE_TOKEN

	// Frontend, when set and Available(), takes precedence for non-native
	// methods. Brain-native path: the call rides the live prompt's SSE
	// stream straight to the Vue webview (2 hops, no Tauri relay). The
	// HTTP bridge remains as fallback for OS-level ops (screenshots,
	// mouse, browser windows) the webview can't perform on its own.
	Frontend *Frontend

	http http.Client
	seq  uint64
}

// hostBridgeMethod reports whether a method must be dispatched through the
// desktop HTTP bridge instead of the per-prompt frontend SSE channel. Two
// reasons land a method here:
//
//  1. OS-level ops the webview can't perform itself — screenshots, mouse,
//     browser windows.
//  2. App-level ops that must act on the MAIN app window — navigation, space
//     actions/snapshots, org lookups, modals. The SSE channel is bound (per
//     prompt) to whatever webview is driving the conversation, which may be a
//     detached/operator window that never ran startBridgeListener and so has
//     no handler for these (→ "Unknown bridge method: space.navigate"). The
//     HTTP bridge routes them to dispatch_to_frontend, which emits to the
//     "main" webview specifically — the one that registers these handlers and
//     owns the real router + space registry.
//
// Everything else prefers the frontend SSE channel when an emitter is bound.
func hostBridgeMethod(method string) bool {
	switch method {
	// (1) OS-level ops.
	case "construct.mouse_move", "construct.mouse_click",
		"browser.tabs", "browser.open", "browser.close", "browser.navigate",
		"browser.snapshot", "browser.click", "browser.type", "browser.press_key",
		"browser.wait_for", "browser.screenshot", "browser.close_window",
		"space.screenshot", "space.list_windows":
		return true
	// (2) App-level ops — must target the main window, not the prompt webview.
	case "space.snapshot", "space.directory", "space.list_actions", "space.run_action",
		"space.agent",
		"space.navigate", "space.context_request",
		"space.open_runner", "space.open_preview",
		"project.create_modal",
		"org.members", "org.projects", "org.my_role":
		return true
	}
	return false
}

// FromEnv builds a Client from the bridge port + token env vars set by
// the desktop shell. Reads CONSTRUCT_BRIDGE_* (what desktop/src/brain.rs
// exports) first, falling back to BRAIN_BRIDGE_* for standalone setups.
//
// Empty is fine — Client.Available() reports false and Call returns a
// clear "bridge not available" error, so tools that need the bridge
// (space_run_action etc.) refuse cleanly outside Tauri.
func FromEnv() *Client {
	port := os.Getenv("CONSTRUCT_BRIDGE_PORT")
	tok := os.Getenv("CONSTRUCT_BRIDGE_TOKEN")
	if port == "" {
		port = os.Getenv("BRAIN_BRIDGE_PORT")
		tok = os.Getenv("BRAIN_BRIDGE_TOKEN")
	}
	if port == "" {
		return &Client{}
	}
	return &Client{
		Addr:  "127.0.0.1:" + port,
		Token: tok,
		http: http.Client{
			Timeout: 60 * time.Second,
			Transport: &http.Transport{
				DialContext:       (&net.Dialer{Timeout: 5 * time.Second}).DialContext,
				DisableKeepAlives: true,
			},
		},
	}
}

func (c *Client) Available() bool {
	if c == nil {
		return false
	}
	if c.Frontend != nil && c.Frontend.Available() {
		return true
	}
	return c.Addr != ""
}

type wireRequest struct {
	ID     string          `json:"id"`
	Method string          `json:"method"`
	Params json.RawMessage `json:"params,omitempty"`
}

type wireError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type wireResponse struct {
	ID     string          `json:"id"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *wireError      `json:"error,omitempty"`
}

// Call issues one bridge request. Default deadline is 30s; pass a ctx
// with its own deadline to override.
func (c *Client) Call(ctx context.Context, method string, params any) (json.RawMessage, error) {
	// Prefer the frontend SSE channel for prompt-webview-local methods when a
	// stream is active. Host-bridge methods (OS ops + main-window app ops) and
	// the no-stream case fall through to HTTP — see hostBridgeMethod.
	if c != nil && c.Frontend != nil && !hostBridgeMethod(method) && c.Frontend.Available() {
		return c.Frontend.Call(ctx, method, params)
	}
	if c == nil || c.Addr == "" {
		return nil, fmt.Errorf("bridge not available (no frontend stream and CONSTRUCT_BRIDGE_PORT unset)")
	}

	if _, ok := ctx.Deadline(); !ok {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
	}

	paramsRaw, err := json.Marshal(params)
	if err != nil {
		return nil, fmt.Errorf("bridge marshal params: %w", err)
	}

	id := fmt.Sprintf("brain_%d_%d", time.Now().UnixNano(), atomic.AddUint64(&c.seq, 1))
	req := wireRequest{ID: id, Method: method, Params: paramsRaw}
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("bridge marshal req: %w", err)
	}

	url := "http://" + c.Addr + "/bridge"
	httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("bridge build request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+c.Token)

	resp, err := c.http.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("bridge call: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("bridge read response: %w", err)
	}

	if resp.StatusCode == http.StatusUnauthorized {
		return nil, fmt.Errorf("bridge unauthorized (token mismatch)")
	}
	if resp.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("bridge endpoint not found")
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("bridge HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	var out wireResponse
	if err := json.Unmarshal(respBody, &out); err != nil {
		return nil, fmt.Errorf("bridge unmarshal: %w", err)
	}
	if out.Error != nil {
		msg := out.Error.Message
		if msg == "" {
			msg = out.Error.Code
		}
		if msg == "" {
			msg = "bridge call failed"
		}
		return nil, fmt.Errorf("%s", msg)
	}
	return out.Result, nil
}
