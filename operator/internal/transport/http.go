// HTTP/SSE transport — for web clients and AG-UI protocol compatibility.
// POST /api/request for request/response, POST /api/stream for SSE streaming,
// GET /api/health for health checks.
package transport

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
)

// HTTPServer implements Server over HTTP with SSE streaming.
type HTTPServer struct {
	addr    string
	handler Handler
	streamH StreamHandler
}

// NewHTTPServer creates a new HTTP transport server.
func NewHTTPServer(addr string) *HTTPServer {
	return &HTTPServer{addr: addr}
}

func (s *HTTPServer) OnRequest(h Handler)      { s.handler = h }
func (s *HTTPServer) OnStream(h StreamHandler) { s.streamH = h }

// Serve starts the HTTP server. Blocks until ctx is cancelled.
func (s *HTTPServer) Serve(ctx context.Context) error {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", s.handleHealth)
	mux.HandleFunc("/api/request", s.handleRequest)
	mux.HandleFunc("/api/stream", s.handleStream)

	ln, err := net.Listen("tcp", s.addr)
	if err != nil {
		return fmt.Errorf("http listen: %w", err)
	}
	defer ln.Close()

	fmt.Fprintf(os.Stderr, "[operator] http listening on %s\n", ln.Addr().String())

	srv := &http.Server{Handler: corsMiddleware(mux)}

	go func() {
		<-ctx.Done()
		srv.Close()
	}()

	if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
		return err
	}
	return nil
}

// corsMiddleware adds CORS headers to all responses.
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func (s *HTTPServer) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"status":"ok"}`))
}

func (s *HTTPServer) handleRequest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(Response{Success: false, Error: "invalid JSON: " + err.Error()})
		return
	}

	if s.handler == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(Response{ID: req.ID, Success: false, Error: "no handler registered"})
		return
	}

	resp := s.handler(r.Context(), req)
	resp.ID = req.ID

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (s *HTTPServer) handleStream(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req Request
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(Response{Success: false, Error: "invalid JSON: " + err.Error()})
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	// If we have a stream handler, use it
	if s.streamH != nil {
		s.streamH(r.Context(), req, func(chunk StreamChunk) {
			chunk.ID = req.ID
			data, err := json.Marshal(chunk)
			if err != nil {
				return
			}
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		})
		return
	}

	// Fallback: use request handler and send result as a single SSE event
	if s.handler != nil {
		resp := s.handler(r.Context(), req)
		resp.ID = req.ID
		chunk := StreamChunk{
			ID:   req.ID,
			Type: "done",
			Data: resp.Data,
			Done: true,
		}
		if resp.Error != "" {
			chunk.Type = "error"
			chunk.Data = map[string]any{"error": resp.Error}
		}
		data, _ := json.Marshal(chunk)
		fmt.Fprintf(w, "data: %s\n\n", data)
		flusher.Flush()
		return
	}

	// No handlers
	errChunk := StreamChunk{ID: req.ID, Type: "error", Data: map[string]any{"error": "no handler registered"}, Done: true}
	data, _ := json.Marshal(errChunk)
	fmt.Fprintf(w, "data: %s\n\n", data)
	flusher.Flush()
}
