package sidecar

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/construct-space/brain/bridge"
	"github.com/construct-space/brain/wire"
)

// HTTPServer wraps the same Handler registry as the TCP Server but speaks
// HTTP+SSE. Frontend code in the Tauri webview can fetch this; raw TCP
// is unreachable from JS.
//
// Endpoints:
//
//	POST /v1/request — body: WireRequest JSON. Single response (for
//	  non-streaming ops like ping/info/tools.list).
//	POST /v1/stream  — body: WireRequest JSON. SSE stream; each chunk
//	  is a wire.Response. Stream ends when {"done":true} arrives.
type HTTPServer struct {
	addr     string
	server   *Server // shares the Handler map; HTTP is just a second transport
	frontend *bridge.Frontend
	// token, when non-empty, must be presented as `Authorization: Bearer
	// <token>` on every request. Loopback binding alone is NOT a security
	// gate: any web page the user opens can `fetch` a loopback port, and
	// these endpoints drive the agent (bash/write/edit tools). The shared
	// secret — handed to us by the desktop shell via CONSTRUCT_BRIDGE_TOKEN
	// — is what actually keeps drive-by sites out. Empty token = enforcement
	// disabled (manual/dev runs that don't set the env).
	token string
}

func NewHTTP(addr string, tcp *Server, frontend *bridge.Frontend, token string) *HTTPServer {
	return &HTTPServer{addr: addr, server: tcp, frontend: frontend, token: token}
}

func (h *HTTPServer) Serve(ctx context.Context) error {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/request", h.handleRequest)
	mux.HandleFunc("POST /v1/stream", h.handleStream)
	mux.HandleFunc("POST /v1/tool_response", h.handleToolResponse)

	s := &http.Server{
		Addr:    h.addr,
		Handler: withCORS(h.token, mux),
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = s.Shutdown(shutdownCtx)
	}()
	if err := s.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		return err
	}
	return nil
}

// withCORS allows the Tauri webview (and dev Vite at localhost:60200) to
// fetch this server, and enforces the shared-secret Bearer token.
//
// CORS alone is not the security boundary: a malicious site can still fire
// a no-cors POST at a loopback port even if it can't read the response, so
// the token (checked below) is what prevents drive-by agent execution. The
// `*` origin is fine precisely because access is gated on a secret the
// attacker's page cannot know.
func withCORS(token string, h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == "OPTIONS" {
			// Private Network Access (CORS-RFC1918). Chromium-based webviews
			// (Windows/Linux WebView2/WebKitGTK) preflight any fetch from the
			// app origin (http://tauri.localhost) to a loopback address and
			// BLOCK it unless this header is echoed back. macOS WKWebView does
			// not implement PNA, which is why the desktop talks to brain fine
			// there but every request shows "unreachable" on Windows. Echo the
			// grant whenever the preflight asks for it.
			if r.Header.Get("Access-Control-Request-Private-Network") == "true" {
				w.Header().Set("Access-Control-Allow-Private-Network", "true")
			}
			// Preflight carries no Authorization header by design — answer
			// it before the token check so the real request can follow.
			w.WriteHeader(204)
			return
		}
		if token != "" {
			presented := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			if subtle.ConstantTimeCompare([]byte(presented), []byte(token)) != 1 {
				writeJSON(w, 401, map[string]any{"error": "unauthorized"})
				return
			}
		}
		h.ServeHTTP(w, r)
	})
}

func (h *HTTPServer) handleRequest(w http.ResponseWriter, r *http.Request) {
	req, err := readReq(r)
	if err != nil {
		writeJSON(w, 400, wire.Response{ID: "", Success: false, Error: err.Error(), Done: true})
		return
	}
	handler, ok := h.server.lookup(req.Type)
	if !ok {
		writeJSON(w, 404, wire.Response{ID: req.ID, Success: false, Error: "unknown type: " + req.Type, Done: true})
		return
	}
	var captured wire.Response
	var got bool
	handler(r.Context(), req, func(resp wire.Response) {
		// /v1/request is single-shot: keep the LAST chunk (stopping at
		// the first Done). Capturing the first chunk returned interim
		// events (e.g. a prompt's "session" chunk) as the final answer
		// while the real work ran on discarded.
		if got && captured.Done {
			return
		}
		captured = resp
		got = true
	})
	if !got {
		captured = wire.Response{ID: req.ID, Success: false, Error: "handler emitted no response", Done: true}
	}
	writeJSON(w, 200, captured)
}

func (h *HTTPServer) handleStream(w http.ResponseWriter, r *http.Request) {
	req, err := readReq(r)
	if err != nil {
		writeJSON(w, 400, wire.Response{ID: "", Success: false, Error: err.Error(), Done: true})
		return
	}
	handler, ok := h.server.lookup(req.Type)
	if !ok {
		writeJSON(w, 404, wire.Response{ID: req.ID, Success: false, Error: "unknown type: " + req.Type, Done: true})
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher, _ := w.(http.Flusher)

	// emit must be safe for concurrent use — the TCP transport already
	// guarantees that (writeMu); mirror it here so a handler emitting
	// from a second goroutine can't interleave SSE frames.
	var emitMu sync.Mutex
	emit := func(resp wire.Response) {
		body, err := json.Marshal(resp)
		if err != nil {
			return
		}
		emitMu.Lock()
		defer emitMu.Unlock()
		fmt.Fprintf(w, "data: %s\n\n", body)
		if flusher != nil {
			flusher.Flush()
		}
	}
	handler(r.Context(), req, emit)
}

// handleToolResponse receives the frontend's reply to a tool_request
// pushed over the active prompt's SSE stream. Body: {id, result?, error?}.
func (h *HTTPServer) handleToolResponse(w http.ResponseWriter, r *http.Request) {
	if h.frontend == nil {
		writeJSON(w, 503, map[string]any{"error": "frontend channel not enabled"})
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 8<<20))
	if err != nil {
		writeJSON(w, 400, map[string]any{"error": err.Error()})
		return
	}
	var pl struct {
		ID     string          `json:"id"`
		Result json.RawMessage `json:"result,omitempty"`
		Error  string          `json:"error,omitempty"`
	}
	if err := json.Unmarshal(body, &pl); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid JSON: " + err.Error()})
		return
	}
	if pl.ID == "" {
		writeJSON(w, 400, map[string]any{"error": "missing id"})
		return
	}
	h.frontend.Resolve(pl.ID, pl.Result, pl.Error)
	writeJSON(w, 200, map[string]any{"ok": true})
}

func readReq(r *http.Request) (wire.Request, error) {
	body, err := io.ReadAll(io.LimitReader(r.Body, 16<<20))
	if err != nil {
		return wire.Request{}, err
	}
	var req wire.Request
	if err := json.Unmarshal(body, &req); err != nil {
		return wire.Request{}, fmt.Errorf("invalid JSON: %w", err)
	}
	if strings.TrimSpace(req.Type) == "" {
		return wire.Request{}, fmt.Errorf("missing type")
	}
	return req, nil
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
