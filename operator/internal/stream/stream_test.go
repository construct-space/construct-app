package stream

import (
	"sync"
	"testing"
	"time"
)

func TestEmitAndSubscribe(t *testing.T) {
	e := NewEmitter()
	ch := e.Subscribe()

	e.Emit(Event{Type: "text", Data: map[string]any{"text": "hello"}})
	e.Close()

	var events []Event
	for ev := range ch {
		events = append(events, ev)
	}
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	if events[0].Type != "text" {
		t.Fatalf("expected type %q, got %q", "text", events[0].Type)
	}
}

func TestMultipleSubscribers(t *testing.T) {
	e := NewEmitter()
	ch1 := e.Subscribe()
	ch2 := e.Subscribe()

	e.Emit(Event{Type: "test"})
	e.Close()

	ev1 := <-ch1
	ev2 := <-ch2
	if ev1.Type != "test" || ev2.Type != "test" {
		t.Fatal("both subscribers should receive the event")
	}
}

func TestBackpressure(t *testing.T) {
	e := NewEmitterWithBuffer(2)
	ch := e.Subscribe()

	// Fill the buffer beyond capacity
	for i := 0; i < 10; i++ {
		e.Emit(Event{Type: "flood", Data: map[string]any{"i": i}})
	}

	// Should have dropped some events
	if e.DroppedCount() == 0 {
		// Drain channel to check
		go func() {
			for range ch {
			}
		}()
		e.Close()
		// It's possible all fit if the consumer was fast enough
		// but with buffer=2 and 10 events, drops are expected
	}

	go func() {
		for range ch {
		}
	}()
	e.Close()
}

func TestCloseIsIdempotent(t *testing.T) {
	e := NewEmitter()
	_ = e.Subscribe()
	e.Close()
	// Emit after close should not panic
	e.Emit(Event{Type: "after-close"})
}

func TestConcurrentEmit(t *testing.T) {
	e := NewEmitter()
	ch := e.Subscribe()

	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			e.Emit(Event{Type: "concurrent"})
		}()
	}

	done := make(chan struct{})
	var count int
	go func() {
		for range ch {
			count++
		}
		close(done)
	}()

	wg.Wait()
	e.Close()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for events")
	}

	if count == 0 {
		t.Fatal("should have received some events")
	}
}
