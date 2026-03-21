package transport

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHTTPHealthEndpoint(t *testing.T) {
	s := NewHTTPServer(":0")
	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", s.handleHealth)

	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var body map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if body["status"] != "ok" {
		t.Fatalf("expected status=ok, got %q", body["status"])
	}
}

func TestHTTPHealthMethodNotAllowed(t *testing.T) {
	s := NewHTTPServer(":0")
	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", s.handleHealth)

	req := httptest.NewRequest(http.MethodPost, "/api/health", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", w.Code)
	}
}

func TestHTTPRequestHandler(t *testing.T) {
	s := NewHTTPServer(":0")
	s.OnRequest(func(ctx context.Context, req Request) Response {
		return Response{
			ID:      req.ID,
			Success: true,
			Data:    "hello " + req.Type,
		}
	})

	mux := http.NewServeMux()
	mux.HandleFunc("/api/request", s.handleRequest)

	body, _ := json.Marshal(Request{
		ID:   "req-1",
		Type: "test.echo",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/request", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp Response
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if resp.ID != "req-1" {
		t.Errorf("expected id=req-1, got %q", resp.ID)
	}
	if !resp.Success {
		t.Errorf("expected success=true")
	}
}

func TestHTTPRequestBadJSON(t *testing.T) {
	s := NewHTTPServer(":0")
	mux := http.NewServeMux()
	mux.HandleFunc("/api/request", s.handleRequest)

	req := httptest.NewRequest(http.MethodPost, "/api/request", strings.NewReader("{invalid"))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}

	var resp Response
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Success {
		t.Errorf("expected success=false for invalid JSON")
	}
}

func TestHTTPRequestMethodNotAllowed(t *testing.T) {
	s := NewHTTPServer(":0")
	mux := http.NewServeMux()
	mux.HandleFunc("/api/request", s.handleRequest)

	req := httptest.NewRequest(http.MethodGet, "/api/request", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", w.Code)
	}
}

func TestHTTPRequestNoHandler(t *testing.T) {
	s := NewHTTPServer(":0")
	mux := http.NewServeMux()
	mux.HandleFunc("/api/request", s.handleRequest)

	body, _ := json.Marshal(Request{ID: "req-1", Type: "test"})
	req := httptest.NewRequest(http.MethodPost, "/api/request", bytes.NewReader(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", w.Code)
	}
}

func TestHTTPStreamHandler(t *testing.T) {
	s := NewHTTPServer(":0")
	s.OnStream(func(ctx context.Context, req Request, emit func(StreamChunk)) {
		emit(StreamChunk{Type: "text_delta", Data: "chunk1"})
		emit(StreamChunk{Type: "text_delta", Data: "chunk2"})
		emit(StreamChunk{Type: "done", Done: true})
	})

	mux := http.NewServeMux()
	mux.HandleFunc("/api/stream", s.handleStream)

	body, _ := json.Marshal(Request{ID: "stream-1", Type: "test_stream"})
	req := httptest.NewRequest(http.MethodPost, "/api/stream", bytes.NewReader(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	ct := w.Header().Get("Content-Type")
	if ct != "text/event-stream" {
		t.Fatalf("expected Content-Type text/event-stream, got %q", ct)
	}

	// Parse SSE events
	respBody := w.Body.String()
	events := parseSSEEvents(respBody)
	if len(events) != 3 {
		t.Fatalf("expected 3 SSE events, got %d: %q", len(events), respBody)
	}

	// Verify all chunks have the correlated request ID
	for _, ev := range events {
		var chunk StreamChunk
		if err := json.Unmarshal([]byte(ev), &chunk); err != nil {
			t.Fatalf("invalid SSE event JSON: %v", err)
		}
		if chunk.ID != "stream-1" {
			t.Errorf("expected chunk.ID=stream-1, got %q", chunk.ID)
		}
	}
}

func TestHTTPStreamFallbackToRequestHandler(t *testing.T) {
	s := NewHTTPServer(":0")
	// Only a request handler, no stream handler
	s.OnRequest(func(ctx context.Context, req Request) Response {
		return Response{ID: req.ID, Success: true, Data: "fallback"}
	})

	mux := http.NewServeMux()
	mux.HandleFunc("/api/stream", s.handleStream)

	body, _ := json.Marshal(Request{ID: "s-1", Type: "test"})
	req := httptest.NewRequest(http.MethodPost, "/api/stream", bytes.NewReader(body))
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	events := parseSSEEvents(w.Body.String())
	if len(events) != 1 {
		t.Fatalf("expected 1 SSE event for fallback, got %d", len(events))
	}

	var chunk StreamChunk
	json.Unmarshal([]byte(events[0]), &chunk)
	if !chunk.Done {
		t.Errorf("expected done=true on fallback chunk")
	}
}

func TestHTTPStreamMethodNotAllowed(t *testing.T) {
	s := NewHTTPServer(":0")
	mux := http.NewServeMux()
	mux.HandleFunc("/api/stream", s.handleStream)

	req := httptest.NewRequest(http.MethodGet, "/api/stream", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", w.Code)
	}
}

func TestCORSMiddleware(t *testing.T) {
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	handler := corsMiddleware(inner)

	// Test regular request has CORS headers
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Errorf("expected CORS origin header")
	}
	if w.Header().Get("Access-Control-Allow-Methods") == "" {
		t.Errorf("expected CORS methods header")
	}
	if w.Header().Get("Access-Control-Allow-Headers") == "" {
		t.Errorf("expected CORS headers header")
	}

	// Test OPTIONS preflight
	req = httptest.NewRequest(http.MethodOptions, "/", nil)
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Errorf("expected 204 for OPTIONS, got %d", w.Code)
	}
}

func TestHTTPServerServeAndShutdown(t *testing.T) {
	s := NewHTTPServer("127.0.0.1:0")
	s.OnRequest(func(ctx context.Context, req Request) Response {
		return Response{ID: req.ID, Success: true, Data: "pong"}
	})

	ctx, cancel := context.WithCancel(context.Background())

	errCh := make(chan error, 1)
	go func() {
		errCh <- s.Serve(ctx)
	}()

	// Give the server a moment to start
	// We cancel immediately — the server should shut down cleanly
	cancel()

	err := <-errCh
	if err != nil {
		t.Fatalf("Serve returned unexpected error: %v", err)
	}
}

func TestHTTPServerIntegration(t *testing.T) {
	s := NewHTTPServer("127.0.0.1:0")
	s.OnRequest(func(ctx context.Context, req Request) Response {
		return Response{ID: req.ID, Success: true, Data: "integrated"}
	})

	// Start real server
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Use a real listener to get the port
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	addr := ln.Addr().String()
	ln.Close()

	s.addr = addr
	go s.Serve(ctx)

	// Try health endpoint with retries
	var resp *http.Response
	for i := 0; i < 20; i++ {
		resp, err = http.Get("http://" + addr + "/api/health")
		if err == nil {
			break
		}
	}
	if err != nil {
		t.Fatalf("could not connect to server: %v", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var health map[string]string
	json.Unmarshal(body, &health)
	if health["status"] != "ok" {
		t.Errorf("expected health status ok, got %q", health["status"])
	}
}

// parseSSEEvents extracts the data payloads from an SSE response body.
func parseSSEEvents(body string) []string {
	var events []string
	for _, line := range strings.Split(body, "\n") {
		if strings.HasPrefix(line, "data: ") {
			events = append(events, strings.TrimPrefix(line, "data: "))
		}
	}
	return events
}
