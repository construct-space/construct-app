// TCP transport — backward compatible with Construct's Tauri bridge.
// Properly frames messages and separates broadcasts from request/response pairs.
package transport

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"sync"
	"time"
)

// TCPServer implements Server over TCP with newline-delimited JSON.
type TCPServer struct {
	addr      string
	handler   Handler
	streamH   StreamHandler
	clients   map[net.Conn]bool
	clientsMu sync.Mutex
	idleTimer *time.Timer
	idleAfter time.Duration
	onIdle    func()

	// Active stream cancellation — keyed by request ID
	activeStreams   map[string]context.CancelFunc
	activeStreamMu sync.Mutex
}

func NewTCPServer(addr string) *TCPServer {
	return &TCPServer{
		addr:         addr,
		clients:      make(map[net.Conn]bool),
		activeStreams: make(map[string]context.CancelFunc),
	}
}

// CancelStream cancels an active streaming request by ID.
func (s *TCPServer) CancelStream(requestID string) bool {
	s.activeStreamMu.Lock()
	cancel, ok := s.activeStreams[requestID]
	if ok {
		delete(s.activeStreams, requestID)
	}
	s.activeStreamMu.Unlock()
	if ok {
		cancel()
	}
	return ok
}

func (s *TCPServer) OnRequest(h Handler)      { s.handler = h }
func (s *TCPServer) OnStream(h StreamHandler) { s.streamH = h }

// SetIdleShutdown configures a grace period after the last client disconnects.
// If no clients reconnect before the timer expires, onIdle is called.
func (s *TCPServer) SetIdleShutdown(after time.Duration, onIdle func()) {
	s.clientsMu.Lock()
	defer s.clientsMu.Unlock()
	s.idleAfter = after
	s.onIdle = onIdle
}

func (s *TCPServer) Serve(ctx context.Context) error {
	ln, err := net.Listen("tcp", s.addr)
	if err != nil {
		return fmt.Errorf("tcp listen: %w", err)
	}
	defer ln.Close()

	addr := ln.Addr().(*net.TCPAddr)
	fmt.Fprintf(os.Stderr, "[operator] listening on %s\n", addr.String())
	fmt.Fprintf(os.Stdout, "OPERATOR_ADDR=127.0.0.1:%d\n", addr.Port)
	os.Stdout.Sync()

	go func() {
		<-ctx.Done()
		ln.Close()
	}()

	for {
		conn, err := ln.Accept()
		if err != nil {
			select {
			case <-ctx.Done():
				return nil
			default:
				continue
			}
		}
		go s.handleConn(ctx, conn)
	}
}

func (s *TCPServer) handleConn(ctx context.Context, conn net.Conn) {
	defer conn.Close()

	s.clientsMu.Lock()
	if s.idleTimer != nil {
		s.idleTimer.Stop()
		s.idleTimer = nil
	}
	s.clients[conn] = true
	s.clientsMu.Unlock()
	defer func() {
		s.clientsMu.Lock()
		delete(s.clients, conn)
		shouldStartIdle := len(s.clients) == 0 && s.idleAfter > 0 && s.onIdle != nil
		idleAfter := s.idleAfter
		onIdle := s.onIdle
		if shouldStartIdle {
			s.idleTimer = time.AfterFunc(idleAfter, func() {
				s.clientsMu.Lock()
				idle := len(s.clients) == 0
				s.idleTimer = nil
				s.clientsMu.Unlock()
				if idle {
					onIdle()
				}
			})
		}
		s.clientsMu.Unlock()
	}()

	reader := bufio.NewReader(conn)
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return
		}

		var req Request
		if err := json.Unmarshal([]byte(line), &req); err != nil {
			s.sendJSON(conn, Response{Success: false, Error: "invalid JSON"})
			continue
		}

		// Check if this is a streaming request
		if s.isStreamRequest(req.Type) && s.streamH != nil {
			reqCtx, cancel := context.WithCancel(WithClientID(ctx, req.ClientID))

			// Track for cancellation via stream.cancel
			s.activeStreamMu.Lock()
			s.activeStreams[req.ID] = cancel
			s.activeStreamMu.Unlock()

			s.streamH(reqCtx, req, func(chunk StreamChunk) {
				chunk.ID = req.ID
				s.sendJSON(conn, chunk)
			})

			// Cleanup after stream completes
			s.activeStreamMu.Lock()
			delete(s.activeStreams, req.ID)
			s.activeStreamMu.Unlock()
			cancel()
			continue
		}

		if s.handler != nil {
			reqCtx := WithClientID(ctx, req.ClientID)
			resp := s.handler(reqCtx, req)
			resp.ID = req.ID
			// If a _stream request fell through to the regular handler,
			// wrap the response as a "done" stream chunk so the Tauri
			// stream reader knows to stop reading.
			if s.isStreamRequest(req.Type) {
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
				s.sendJSON(conn, chunk)
			} else {
				s.sendJSON(conn, resp)
			}
		}
	}
}

func (s *TCPServer) sendJSON(conn net.Conn, v any) {
	data, _ := json.Marshal(v)
	conn.Write(append(data, '\n'))
}

func (s *TCPServer) isStreamRequest(reqType string) bool {
	// Convention: streaming request types end with _stream
	return len(reqType) > 7 && reqType[len(reqType)-7:] == "_stream"
}

// Broadcast sends an event to all connected clients.
func (s *TCPServer) Broadcast(event StreamChunk) {
	s.clientsMu.Lock()
	defer s.clientsMu.Unlock()
	data, _ := json.Marshal(event)
	data = append(data, '\n')
	for conn := range s.clients {
		conn.Write(data)
	}
}
