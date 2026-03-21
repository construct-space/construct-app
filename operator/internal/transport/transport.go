// Package transport handles client↔operator communication.
//
// Operator supports multiple transports:
//   - TCP (backward compat with Construct app via Tauri bridge)
//   - HTTP/SSE (for web clients, AG-UI protocol compatible)
//   - stdio (for CLI/pipe usage, like Claude Code)
package transport

import (
	"context"
	"encoding/json"
)

// Request is an incoming client request.
type Request struct {
	ID       string          `json:"id"`
	Type     string          `json:"type"`
	ClientID string          `json:"client_id,omitempty"`
	Payload  json.RawMessage `json:"payload,omitempty"`
}

// Response is sent back to the client.
type Response struct {
	ID      string `json:"id"`
	Success bool   `json:"success"`
	Data    any    `json:"data,omitempty"`
	Error   string `json:"error,omitempty"`
}

// StreamChunk is a streamed event sent during long-running operations.
type StreamChunk struct {
	ID   string `json:"id"`   // Correlates to original request ID
	Type string `json:"type"` // Event type (text_delta, tool_call, etc.)
	Data any    `json:"data,omitempty"`
	Done bool   `json:"done,omitempty"` // True on final chunk
}

// Handler processes a request and returns a response.
type Handler func(ctx context.Context, req Request) Response

// StreamHandler processes a request and streams chunks back.
type StreamHandler func(ctx context.Context, req Request, emit func(StreamChunk))

// Server is a transport server that accepts connections and dispatches requests.
type Server interface {
	// Serve starts accepting connections. Blocks until ctx is cancelled.
	Serve(ctx context.Context) error

	// OnRequest registers the handler for non-streaming requests.
	OnRequest(handler Handler)

	// OnStream registers the handler for streaming requests.
	OnStream(handler StreamHandler)
}

type clientIDKey struct{}

// WithClientID attaches the logical client/app instance ID to a request context.
func WithClientID(ctx context.Context, clientID string) context.Context {
	if clientID == "" {
		return ctx
	}
	return context.WithValue(ctx, clientIDKey{}, clientID)
}

// ClientIDFromContext returns the logical client/app instance ID for a request.
func ClientIDFromContext(ctx context.Context) string {
	v, _ := ctx.Value(clientIDKey{}).(string)
	return v
}
