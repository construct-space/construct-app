// Package module defines the modular architecture for Operator.
// Same philosophy as base-core: each domain is a self-contained module
// that registers its own request handlers.
package module

import (
	"context"
	"fmt"
	"os"
	"sync"

	"construct-operator/internal/transport"
)

// HandlerFunc handles a request and returns a response.
type HandlerFunc func(ctx context.Context, req transport.Request) transport.Response

// StreamHandlerFunc handles a streaming request.
type StreamHandlerFunc func(ctx context.Context, req transport.Request, emit func(transport.StreamChunk))

// Module is the interface every domain module implements.
type Module interface {
	ID() string
	Init() error
	Routes(r *Router)
}

// DefaultModule provides no-op defaults for optional methods.
type DefaultModule struct{}

func (DefaultModule) Init() error      { return nil }
func (DefaultModule) Routes(r *Router) {}

// Dependencies contains everything a module might need.
// Each module takes only what it uses.
//
// Fields typed as `any` break import cycles — concrete packages (runner, hook,
// tool, skill, mcp, oauth, agent, etc.) import this package for
// DefaultModule/Router, so this package cannot import them back.
// Modules type-assert at construction time.
type Dependencies struct {
	Runner           any // *runner.Runner
	StateStore       any // *state.Store
	SessionStore     any // *session.Store
	ChatSessionStore any // *chatsession.Store
	Tools            any // *tool.Registry
	Skills           any // *skill.Registry
	Hooks            any // *hook.Registry
	Plugins          any // *plugin.Manager
	MCP              any // *mcp.Client
	OAuthRegistry    any // *oauth.Registry
	OAuthStorage     any // *oauth.Storage
	Bridge           any // *desktop.Client
	Agents           any // []*agent.Config
	FallbackAgent    any // *agent.Config
	WorkDir           string
	UserMCPConfigPath string
	AppState          *AppState
}

// AppState holds shared mutable state across modules.
type AppState struct {
	mu       sync.RWMutex
	projects map[string]any // values are *runner.ProjectContext
	clients  map[string]*ClientContext
}

// ClientContext stores per-client UI context.
type ClientContext struct {
	Mode      string
	Component map[string]any
	Selection map[string]any
	Timestamp string
}

// NewAppState creates initialized app state.
func NewAppState() *AppState {
	return &AppState{
		projects: make(map[string]any),
		clients:  make(map[string]*ClientContext),
	}
}

// SetProject stores a project context for the given client.
// The value should be *runner.ProjectContext.
func (s *AppState) SetProject(clientID string, p any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.projects[clientKey(clientID)] = p
}

// Project returns the stored project context for the given client.
// The caller should type-assert to *runner.ProjectContext.
func (s *AppState) Project(clientID string) any {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.projects[clientKey(clientID)]
}

// ClearProject removes the project context for the given client.
func (s *AppState) ClearProject(clientID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.projects, clientKey(clientID))
}

// Client returns the per-client UI context for the given client.
func (s *AppState) Client(clientID string) *ClientContext {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.clients[clientKey(clientID)]
}

// UpdateClient updates the per-client UI context atomically.
func (s *AppState) UpdateClient(clientID string, fn func(*ClientContext)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := clientKey(clientID)
	c := s.clients[key]
	if c == nil {
		c = &ClientContext{}
		s.clients[key] = c
	}
	fn(c)
}

func clientKey(id string) string {
	if id == "" {
		return "default"
	}
	return id
}

// Router dispatches requests by type to registered handlers.
type Router struct {
	handlers map[string]HandlerFunc
	streams  map[string]StreamHandlerFunc
}

// NewRouter creates a request router.
func NewRouter() *Router {
	return &Router{
		handlers: make(map[string]HandlerFunc),
		streams:  make(map[string]StreamHandlerFunc),
	}
}

// Handle registers a handler for an exact request type.
func (r *Router) Handle(reqType string, handler HandlerFunc) {
	r.handlers[reqType] = handler
}

// HandleStream registers a stream handler for a request type.
func (r *Router) HandleStream(reqType string, handler StreamHandlerFunc) {
	r.streams[reqType] = handler
}

// Dispatch routes a request to the matching handler.
func (r *Router) Dispatch(ctx context.Context, req transport.Request) transport.Response {
	if h, ok := r.handlers[req.Type]; ok {
		return h(ctx, req)
	}
	fmt.Fprintf(os.Stderr, "[operator] unknown request type: %s\n", req.Type)
	return transport.Response{ID: req.ID, Success: false, Error: "unknown request type: " + req.Type}
}

// DispatchStream routes a stream request to the matching handler.
func (r *Router) DispatchStream(ctx context.Context, req transport.Request, emit func(transport.StreamChunk)) {
	if h, ok := r.streams[req.Type]; ok {
		h(ctx, req, emit)
		return
	}
	emit(transport.StreamChunk{ID: req.ID, Type: "error", Data: map[string]any{"error": "unknown stream type: " + req.Type}, Done: true})
}

// ModuleFactory creates a module from dependencies.
type ModuleFactory func(deps Dependencies) Module

// Initialize registers and initializes a set of modules.
func Initialize(modules map[string]ModuleFactory, deps Dependencies) *Router {
	router := NewRouter()

	for name, factory := range modules {
		mod := factory(deps)
		if err := mod.Init(); err != nil {
			fmt.Fprintf(os.Stderr, "[operator] module %s init failed: %v\n", name, err)
			continue
		}
		mod.Routes(router)
		fmt.Fprintf(os.Stderr, "[operator] module loaded: %s\n", name)
	}

	return router
}
