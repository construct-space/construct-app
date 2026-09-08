package tool

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// SpaceRuntimeClient talks to the headless space-runtime service (POST /run),
// the executor that runs a space's actions with no webview. It's the
// capability router's fallback: on the desktop the frontend bridge runs
// actions (app open), but when there's no bridge (cloud executor, or a
// headless desktop run) actions route here instead.
type SpaceRuntimeClient struct {
	URL   string // e.g. http://127.0.0.1:60190
	Token string // user bearer; the runtime resolves user+org from it
}

func (c *SpaceRuntimeClient) Available() bool {
	return c != nil && c.URL != "" && c.Token != ""
}

// RunAction posts {spaceId, action, params, token} to the runtime and returns
// the action result JSON. The runtime resolves the space by id.
func (c *SpaceRuntimeClient) RunAction(ctx context.Context, spaceID, action string, args json.RawMessage) (string, error) {
	body := map[string]any{"spaceId": spaceID, "action": action, "token": c.Token}
	if len(args) > 0 {
		var p any
		if err := json.Unmarshal(args, &p); err == nil {
			body["params"] = p
		}
	}
	b, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, "POST", c.URL+"/run", bytes.NewReader(b))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: 90 * time.Second}).Do(req)
	if err != nil {
		return "", fmt.Errorf("space-runtime unreachable: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	var out struct {
		OK     bool            `json:"ok"`
		Result json.RawMessage `json:"result"`
		Error  string          `json:"error"`
	}
	_ = json.Unmarshal(raw, &out)
	if resp.StatusCode != 200 || !out.OK {
		if out.Error != "" {
			return "", fmt.Errorf("space-runtime: %s", out.Error)
		}
		return "", fmt.Errorf("space-runtime: HTTP %d", resp.StatusCode)
	}
	return string(out.Result), nil
}
