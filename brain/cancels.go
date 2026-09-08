// cancelTracker maps prompt request id → CancelFunc so a "cancel" wire
// op can abort an in-flight prompt mid-stream. Entries are removed when
// the prompt completes naturally (success, error, or hook abort).
//
// Used by wire_prompt.go's runPrompt and wire_meta.go's cancel handler.
package main

import (
	"context"
	"sync"
)

type cancelTracker struct {
	mu sync.Mutex
	m  map[string]context.CancelFunc
}

func newCancelTracker() *cancelTracker {
	return &cancelTracker{m: map[string]context.CancelFunc{}}
}

func (t *cancelTracker) register(id string, cancel context.CancelFunc) {
	t.mu.Lock()
	t.m[id] = cancel
	t.mu.Unlock()
}

func (t *cancelTracker) done(id string) {
	t.mu.Lock()
	c, ok := t.m[id]
	delete(t.m, id)
	t.mu.Unlock()
	// Release the context on natural completion too — only-explicit-cancel
	// paths released it before, so every completed prompt leaked an
	// un-cancelled child context registered on the long-lived server ctx.
	if ok && c != nil {
		c()
	}
}

func (t *cancelTracker) cancel(id string) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	c, ok := t.m[id]
	if ok {
		c()
		delete(t.m, id)
	}
	return ok
}
