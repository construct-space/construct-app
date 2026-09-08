package tool

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/construct-space/brain/bridge"
	"github.com/construct-space/brain/provider"
)

// ListWindows enumerates the app's webview windows so the agent can find
// the label of the preview window it just opened (start_preview) before
// screenshotting it. Routes to the host's `space.list_windows` bridge op.
type ListWindows struct {
	Bridge *bridge.Client
}

func (ListWindows) Name() string { return "list_windows" }

func (ListWindows) Description() string {
	return "List the app's open webview windows (label, title, visible). Use after start_preview to find the preview window's label, then pass it to screenshot_window."
}

func (ListWindows) InputSchema() map[string]any {
	return map[string]any{"type": "object", "properties": map[string]any{}}
}

func (w ListWindows) Execute(ctx context.Context, _ json.RawMessage) (string, error) {
	if w.Bridge == nil || !w.Bridge.Available() {
		return "", fmt.Errorf("bridge to host is not available; this tool only works when brain runs as a Tauri sidecar")
	}
	data, err := w.Bridge.Call(ctx, "space.list_windows", map[string]any{})
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// ScreenshotWindow captures a named webview window to a PNG and returns it
// to the model as an image (not just a path) so it can visually verify the
// rendered result — e.g. confirm a preview actually renders, spot a blank
// screen or error overlay, or grade a design. Routes to `space.screenshot`.
type ScreenshotWindow struct {
	Bridge *bridge.Client
}

func (ScreenshotWindow) Name() string { return "screenshot_window" }

func (ScreenshotWindow) Description() string {
	return "Capture a webview window to a PNG and return it so you can SEE the rendered result — e.g. to screenshot the current view or a space (Mail, Calendar, …), which render in the MAIN app window. Omit window_label to capture the main window (the default); pass a label from list_windows to target a preview or popout window instead. The image is attached to the result; the file path is also returned so you can embed it as ![shot](/abs/path.png)."
}

func (ScreenshotWindow) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"window_label": map[string]any{
				"type":        "string",
				"description": "Window label from list_windows. Omit to capture the main app window (where spaces like Mail render). Pass an explicit label for a preview/popout window.",
			},
		},
	}
}

func (s ScreenshotWindow) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	if s.Bridge == nil || !s.Bridge.Available() {
		return "", fmt.Errorf("bridge to host is not available; this tool only works when brain runs as a Tauri sidecar")
	}
	var in struct {
		WindowLabel string `json:"window_label"`
	}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &in); err != nil {
			return "", fmt.Errorf("invalid input: %w", err)
		}
	}
	label := strings.TrimSpace(in.WindowLabel)
	if label == "" {
		// Default to the main app window — where the current view and spaces
		// (Mail, Calendar, …) render. Explicit preview/popout labels come
		// from list_windows.
		label = "main"
	}
	data, err := s.Bridge.Call(ctx, "space.screenshot", map[string]any{"window_label": label})
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// ResultImages reads the captured PNG off disk and hands it back to the
// model as an image block. The path comes from the host's screenshot
// response ({window_label, path, width, height}). On any failure it
// returns nil — the model still gets the path text from Execute.
func (ScreenshotWindow) ResultImages(output string) []provider.ImageBlock {
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
