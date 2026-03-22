package oauth

import "sync"

// Registry holds all registered OAuth providers.
type Registry struct {
	mu        sync.RWMutex
	providers map[string]Provider
}

// NewRegistry creates a registry with all built-in providers.
func NewRegistry() *Registry {
	r := &Registry{providers: make(map[string]Provider)}
	r.RegisterBuiltins()
	return r
}

// RegisterBuiltins adds all built-in OAuth providers.
func (r *Registry) RegisterBuiltins() {
	r.Register(&AnthropicProvider{})
	r.Register(&OpenAICodexProvider{})
	r.Register(&GitHubCopilotProvider{})
	r.Register(&GoogleGeminiProvider{})
}

// Register adds a provider to the registry.
func (r *Registry) Register(p Provider) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.providers[p.ID()] = p
}

// Get returns a provider by ID.
func (r *Registry) Get(id string) (Provider, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	p, ok := r.providers[id]
	return p, ok
}

// All returns all registered providers.
func (r *Registry) All() []Provider {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make([]Provider, 0, len(r.providers))
	for _, p := range r.providers {
		result = append(result, p)
	}
	return result
}

// IDs returns all provider IDs.
func (r *Registry) IDs() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	ids := make([]string, 0, len(r.providers))
	for id := range r.providers {
		ids = append(ids, id)
	}
	return ids
}
