// Package stream handles real-time event emission from agent runs.
// Uses a clean event emitter pattern inspired by AG-UI protocol.
package stream

import "sync"

// Event is an agent execution event streamed to the client.
type Event struct {
	Type string         `json:"type"` // session.start, text, tool.call, tool.result, turn.start, turn.end, token.usage, status, error, done
	Data map[string]any `json:"data,omitempty"`
}

// Status event states — emitted as type "status" with data.state set to one of these.
const (
	StatusThinking    = "thinking"     // Waiting for LLM response
	StatusToolRunning = "tool_running" // Executing a tool
	StatusToolDone    = "tool_done"    // Tool execution finished
	StatusComplete    = "complete"     // Agent run finished
)

// DefaultBufferSize is the channel buffer for subscribers.
const DefaultBufferSize = 256

// Emitter sends events to subscribers with backpressure handling.
type Emitter struct {
	mu         sync.RWMutex
	subs       []*subscriber
	bufferSize int
	closed     bool
}

type subscriber struct {
	ch      chan Event
	dropped int64
}

func NewEmitter() *Emitter {
	return &Emitter{bufferSize: DefaultBufferSize}
}

// NewEmitterWithBuffer creates an emitter with a custom buffer size.
func NewEmitterWithBuffer(size int) *Emitter {
	if size < 1 {
		size = DefaultBufferSize
	}
	return &Emitter{bufferSize: size}
}

// Subscribe returns a channel that receives events.
func (e *Emitter) Subscribe() <-chan Event {
	ch := make(chan Event, e.bufferSize)
	sub := &subscriber{ch: ch}
	e.mu.Lock()
	e.subs = append(e.subs, sub)
	e.mu.Unlock()
	return ch
}

// Emit sends an event to all subscribers.
// Slow subscribers get events dropped (oldest first via channel overflow).
func (e *Emitter) Emit(ev Event) {
	e.mu.RLock()
	defer e.mu.RUnlock()
	if e.closed {
		return
	}
	for _, sub := range e.subs {
		select {
		case sub.ch <- ev:
		default:
			// Channel full — drop oldest event to make room
			select {
			case <-sub.ch: // drain one
				sub.dropped++
			default:
			}
			// Try again
			select {
			case sub.ch <- ev:
			default:
				sub.dropped++
			}
		}
	}
}

// Close closes all subscriber channels.
func (e *Emitter) Close() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.closed = true
	for _, sub := range e.subs {
		close(sub.ch)
	}
	e.subs = nil
}

// DroppedCount returns the total number of dropped events across all subscribers.
func (e *Emitter) DroppedCount() int64 {
	e.mu.RLock()
	defer e.mu.RUnlock()
	var total int64
	for _, sub := range e.subs {
		total += sub.dropped
	}
	return total
}
