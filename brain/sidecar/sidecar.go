// Package sidecar runs brain's TCP server. One connection serves many
// sequential requests; each request is a single JSON line. Responses are
// JSON lines tagged with the request ID. Streaming requests emit many
// chunks ending with {"done": true}.
package sidecar

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"runtime/debug"
	"strings"
	"sync"

	"github.com/construct-space/brain/wire"
)

// Handler processes a request. For streaming responses, emit calls writeLine
// repeatedly and the final chunk must have Done=true.
type Handler func(ctx context.Context, req wire.Request, emit func(wire.Response))

type Server struct {
	addr     string
	handlers map[string]Handler
	mu       sync.RWMutex
	listener net.Listener
}

func New(addr string) *Server {
	return &Server{
		addr:     addr,
		handlers: make(map[string]Handler),
	}
}

// Handle registers a handler for a request type. Replaces any prior handler
// for the same type.
func (s *Server) Handle(reqType string, h Handler) {
	s.mu.Lock()
	s.handlers[reqType] = h
	s.mu.Unlock()
}

// lookup is used by the HTTP transport (same package).
func (s *Server) lookup(reqType string) (Handler, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	h, ok := s.handlers[reqType]
	return h, ok
}

func (s *Server) Serve(ctx context.Context) error {
	ln, err := net.Listen("tcp", s.addr)
	if err != nil {
		return fmt.Errorf("listen %s: %w", s.addr, err)
	}
	s.listener = ln

	go func() {
		<-ctx.Done()
		_ = ln.Close()
	}()

	for {
		conn, err := ln.Accept()
		if err != nil {
			if errors.Is(err, net.ErrClosed) {
				return nil
			}
			return err
		}
		go s.handleConn(ctx, conn)
	}
}

// Addr returns the actual listening address (useful when addr was :0).
func (s *Server) Addr() string {
	if s.listener == nil {
		return s.addr
	}
	return s.listener.Addr().String()
}

func (s *Server) handleConn(ctx context.Context, conn net.Conn) {
	defer conn.Close()
	scanner := bufio.NewScanner(conn)
	scanner.Buffer(make([]byte, 1<<20), 1<<24) // 16 MiB max line
	writeMu := &sync.Mutex{}

	emit := func(resp wire.Response) {
		writeMu.Lock()
		defer writeMu.Unlock()
		b, err := json.Marshal(resp)
		if err != nil {
			return
		}
		b = append(b, '\n')
		_, _ = conn.Write(b)
	}

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var req wire.Request
		if err := json.Unmarshal([]byte(line), &req); err != nil {
			emit(wire.Response{Success: false, Error: "invalid JSON: " + err.Error(), Done: true})
			continue
		}

		s.mu.RLock()
		h, ok := s.handlers[req.Type]
		s.mu.RUnlock()
		if !ok {
			emit(wire.Response{ID: req.ID, Success: false, Error: "unknown type: " + req.Type, Done: true})
			continue
		}
		// Recover handler panics into an error response — net/http's
		// transport recovers automatically, but a panic on this path
		// killed the whole brain process and every active session.
		func() {
			defer func() {
				if rec := recover(); rec != nil {
					fmt.Fprintf(os.Stderr, "[sidecar] handler %s panicked: %v\n%s", req.Type, rec, debug.Stack())
					emit(wire.Response{ID: req.ID, Success: false, Error: fmt.Sprintf("internal error: %v", rec), Done: true})
				}
			}()
			h(ctx, req, emit)
		}()
	}
	if err := scanner.Err(); err != nil {
		// A >16MiB line or read error used to kill the connection with
		// zero signal to the client.
		emit(wire.Response{Success: false, Error: "connection read error: " + err.Error(), Done: true})
	}
}
