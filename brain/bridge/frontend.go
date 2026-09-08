// Frontend is brain's direct back-channel to the Vue webview. It piggy-
// backs on the active prompt's SSE stream — brain emits a "tool_request"
// chunk, the frontend executes the call against live Pinia/DOM state,
// then POSTs the result to /v1/tool_response.
//
// This is the brain-native replacement for the HTTP bridge into the
// desktop shell. The HTTP bridge stays around for native ops (screenshots,
// mouse/keyboard, browser child window) that need OS APIs the webview
// can't reach; everything `space.*`, `org.*`, `project.*` goes here.
package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

// ToolRequestEmitter is called by Frontend.Call to push the request out
// over the active SSE stream. Brain binds one of these per prompt via
// Frontend.BindEmitter; tools that fire when no emitter is bound get a
// clean "frontend not connected" error.
type ToolRequestEmitter func(callID, method string, params json.RawMessage)

type Frontend struct {
	emitter atomic.Value // ToolRequestEmitter; nil-typed when unbound

	mu      sync.Mutex
	pending map[string]chan frontendResp
	seq     uint64
}

type frontendResp struct {
	result json.RawMessage
	err    error
}

func NewFrontend() *Frontend {
	return &Frontend{pending: map[string]chan frontendResp{}}
}

// BindEmitter installs the emit fn for the current prompt and returns a
// release fn the caller must defer. Each prompt's handler binds before
// running and releases on return — so Call() routes to the live SSE
// stream and any in-flight tool requests get cancelled by Resolve when
// the prompt ends.
//
// The release fn only clears the slot if it still holds THIS binding.
// With two concurrent prompts (main chat + a space panel), prompt B's
// bind overwrites A's; when A finished first its unconditional release
// nil'd B's live emitter, and every remaining frontend call in B failed
// "not connected". Last-writer-wins for the bind is unchanged (a known
// limitation); the release just can't clobber someone else's binding.
func (f *Frontend) BindEmitter(emit ToolRequestEmitter) func() {
	b := &emitterBinding{fn: emit}
	f.emitter.Store(b)
	return func() {
		f.emitter.CompareAndSwap(b, (*emitterBinding)(nil))
	}
}

// emitterBinding wraps the func so atomic.Value holds a consistent
// concrete type and CompareAndSwap can match by pointer identity.
type emitterBinding struct{ fn ToolRequestEmitter }

func (f *Frontend) currentEmitter() ToolRequestEmitter {
	b, _ := f.emitter.Load().(*emitterBinding)
	if b == nil {
		return nil
	}
	return b.fn
}

// Available reports whether a prompt is currently bound and can route
// tool requests to the frontend.
func (f *Frontend) Available() bool {
	return f.currentEmitter() != nil
}

// Call ships method + params to the frontend over the current SSE stream
// and waits for the response. Mirrors bridge.Client.Call so it can plug
// into the same tool wiring.
func (f *Frontend) Call(ctx context.Context, method string, params any) (json.RawMessage, error) {
	emit := f.currentEmitter()
	if emit == nil {
		return nil, errors.New("frontend not connected (no active prompt stream)")
	}
	paramsRaw, err := json.Marshal(params)
	if err != nil {
		return nil, fmt.Errorf("frontend marshal params: %w", err)
	}

	callID := fmt.Sprintf("fc_%d_%d", time.Now().UnixNano(), atomic.AddUint64(&f.seq, 1))
	ch := make(chan frontendResp, 1)

	f.mu.Lock()
	f.pending[callID] = ch
	f.mu.Unlock()
	defer func() {
		f.mu.Lock()
		delete(f.pending, callID)
		f.mu.Unlock()
	}()

	emit(callID, method, paramsRaw)

	// Defensive timeout — if the frontend has no handler registered for
	// this method the request would otherwise hang the agent loop forever.
	// Caller's ctx timeout still wins if it's tighter. Interactive
	// methods are exempt: a user thinking >30s on a permission modal or
	// an ask_user question is normal, and auto-failing them denied
	// destructive-action confirmations with a misleading "handler not
	// registered" reason. Those rely on ctx (prompt cancel) instead.
	interactive := method == "permission.request" || method == "user.ask"
	var timeout <-chan time.Time
	if !interactive {
		timer := time.NewTimer(30 * time.Second)
		defer timer.Stop()
		timeout = timer.C
	}

	select {
	case r := <-ch:
		return r.result, r.err
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-timeout:
		return nil, fmt.Errorf("frontend.Call(%s): no response in 30s (handler likely not registered)", method)
	}
}

// Resolve is called by the HTTP /v1/tool_response endpoint with the
// frontend's reply. Unknown ids are dropped — they're either stale
// (timed out) or duplicate responses.
func (f *Frontend) Resolve(callID string, result json.RawMessage, errStr string) {
	f.mu.Lock()
	ch, ok := f.pending[callID]
	if ok {
		delete(f.pending, callID)
	}
	f.mu.Unlock()
	if !ok {
		return
	}
	if errStr != "" {
		ch <- frontendResp{err: errors.New(errStr)}
	} else {
		ch <- frontendResp{result: result}
	}
}
