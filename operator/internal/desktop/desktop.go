// Package desktop provides the reverse bridge client for Operator -> Tauri communication.
// Tauri runs an HTTP server on 127.0.0.1:60101. Operator sends typed requests
// and receives JSON responses. See docs/desktop-bridge.md for the current contract.
package desktop

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync/atomic"
	"time"

	"construct-operator/internal/config"
)

var reqCounter atomic.Int64

func nextID() string {
	return fmt.Sprintf("bridge_%d", reqCounter.Add(1))
}

// Request is sent from operator to Tauri bridge.
type Request struct {
	ID     string         `json:"id"`
	Method string         `json:"method"`
	Params map[string]any `json:"params,omitempty"`
}

// Response is returned from Tauri bridge to operator.
type Response struct {
	ID     string          `json:"id"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *BridgeError    `json:"error,omitempty"`
}

// BridgeError describes a bridge-side failure.
type BridgeError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *BridgeError) Error() string {
	return fmt.Sprintf("bridge %s: %s", e.Code, e.Message)
}

// Client talks to the Tauri desktop bridge.
type Client struct {
	addr  string
	token string
	http  *http.Client
}

// NewClient creates a bridge client. Token is the CONSTRUCT_BRIDGE_TOKEN value.
// Always connects to 127.0.0.1:{PortDesktopBridge}.
func NewClient(token string) *Client {
	return &Client{
		addr:  fmt.Sprintf("http://127.0.0.1:%d/bridge", config.PortDesktopBridge),
		token: token,
		http: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// SetAddrForTest overrides the bridge address (for use in tests with httptest).
func (c *Client) SetAddrForTest(addr string) {
	c.addr = addr
	if c.http == nil {
		c.http = http.DefaultClient
	}
}

// SetTokenForTest overrides the bridge token (for use in tests).
func (c *Client) SetTokenForTest(token string) { c.token = token }

// Call sends a typed request to the Tauri bridge and returns the result.
func (c *Client) Call(ctx context.Context, method string, params map[string]any) (json.RawMessage, error) {
	req := Request{
		ID:     nextID(),
		Method: method,
		Params: params,
	}

	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("desktop bridge: marshal: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", c.addr, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("desktop bridge: request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+c.token)

	httpResp, err := c.http.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("desktop bridge: %w", err)
	}
	defer httpResp.Body.Close()

	if httpResp.StatusCode == http.StatusUnauthorized {
		return nil, fmt.Errorf("desktop bridge: unauthorized (bad token)")
	}
	if httpResp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("desktop bridge: HTTP %d", httpResp.StatusCode)
	}

	var resp Response
	if err := json.NewDecoder(httpResp.Body).Decode(&resp); err != nil {
		return nil, fmt.Errorf("desktop bridge: decode: %w", err)
	}

	if resp.Error != nil {
		return nil, resp.Error
	}

	return resp.Result, nil
}

// Ping checks if the bridge is reachable.
func (c *Client) Ping(ctx context.Context) error {
	_, err := c.Call(ctx, "ping", nil)
	return err
}
