// Scheduled cross-space automations. A user writes a rule in plain English
// ("when I get a meeting invite, add it to my calendar") + an interval; a
// background ticker fires a forked "reactor" agent on that schedule. The
// reactor runs with the space-action tools (space_run_action etc.) plus read/
// web/memory — but NOT write/edit/bash/git — and interprets the rule each run.
//
// Idempotency is prompt-driven for now: the reactor is told when it last ran
// and to act only on what's new. Storage is per-profile (live dir, like
// memory), file <BrainDir>/automations.json.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime/debug"
	"sync"
	"time"

	"github.com/construct-space/brain/agent"
	"github.com/construct-space/brain/identity"
	"github.com/construct-space/brain/provider"
	"github.com/construct-space/brain/tool"
)

// Automation is one user-defined rule.
type Automation struct {
	ID          string `json:"id"`
	Instruction string `json:"instruction"`  // natural-language rule
	IntervalMin int    `json:"interval_min"` // run cadence in minutes
	Enabled     bool   `json:"enabled"`
	LastRunAt   int64  `json:"last_run_at,omitempty"` // unix seconds
	LastResult  string `json:"last_result,omitempty"` // one-line summary of the last run
	CreatedAt   int64  `json:"created_at,omitempty"`
}

// AutomationStore is file-backed, per-profile (DirFn resolves live).
type AutomationStore struct {
	mu    sync.Mutex
	DirFn func() string
}

func (s *AutomationStore) path() string { return filepath.Join(s.DirFn(), "automations.json") }

func (s *AutomationStore) List() []Automation {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.read()
}

func (s *AutomationStore) read() []Automation {
	b, err := os.ReadFile(s.path())
	if err != nil {
		return nil
	}
	var out []Automation
	_ = json.Unmarshal(b, &out)
	return out
}

func (s *AutomationStore) write(list []Automation) error {
	if err := os.MkdirAll(filepath.Dir(s.path()), 0o755); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(list, "", "  ")
	return os.WriteFile(s.path(), b, 0o644)
}

// Save upserts a rule by ID (assigns one if empty) and returns it.
func (s *AutomationStore) Save(a Automation) (Automation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	list := s.read()
	if a.ID == "" {
		a.ID = newAutomationID()
		a.CreatedAt = time.Now().Unix()
	}
	found := false
	for i := range list {
		if list[i].ID == a.ID {
			// preserve run state across edits
			a.LastRunAt, a.LastResult, a.CreatedAt = list[i].LastRunAt, list[i].LastResult, list[i].CreatedAt
			list[i] = a
			found = true
			break
		}
	}
	if !found {
		list = append(list, a)
	}
	return a, s.write(list)
}

func (s *AutomationStore) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	list := s.read()
	out := list[:0]
	for _, a := range list {
		if a.ID != id {
			out = append(out, a)
		}
	}
	return s.write(out)
}

func (s *AutomationStore) markRun(id, result string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	list := s.read()
	for i := range list {
		if list[i].ID == id {
			list[i].LastRunAt = time.Now().Unix()
			list[i].LastResult = result
			break
		}
	}
	_ = s.write(list)
}

func newAutomationID() string {
	return fmt.Sprintf("auto-%d", time.Now().UnixNano())
}

// automationRuntime owns the store + the deps needed to fork a reactor agent.
// It reuses subagentDeps (same provider/tool/identity bag).
type automationRuntime struct {
	store *AutomationStore
	deps  *subagentDeps
}

// reactorTools builds the curated toolset the reactor may use: space actions
// + read + web + memory, fetched from the main registry (so the bridge wiring
// is reused). Deliberately excludes write/edit/bash/git — an automation
// shouldn't mutate the filesystem or run code.
func (r *automationRuntime) reactorTools() *tool.Registry {
	rt := tool.NewRegistry()
	for _, name := range []string{"space_list_actions", "space_run_action", "read", "web_fetch", "web_search", "memory", "list_skills", "load_skill"} {
		if t, ok := r.deps.Tools.Get(name); ok {
			rt.Register(t)
		}
	}
	return rt
}

const automationSystemPrompt = `You are a SCHEDULED AUTOMATION running on the user's behalf — there is no human in this conversation. You act on their spaces (mail, calendar, board, etc.) via space_list_actions and space_run_action, and you can read files and search the web.

Your rule:
%s

Context: it is now %s. You last ran %s.

Rules of engagement:
- Act IDEMPOTENTLY. Only act on items that are NEW since you last ran; never repeat an action you've already taken on a previous run.
- Be conservative. Take only the actions your rule clearly calls for. Don't improvise extra changes.
- If there is nothing new to do, do nothing.
When finished, reply with ONE short line summarizing what you did, or "Nothing to do."`

// runOne fires the reactor for a single rule and returns its summary line.
func (r *automationRuntime) runOne(ctx context.Context, a Automation) (string, error) {
	d := r.deps
	// No provider preference on automations — resolveModelRoute walks
	// the fallback chain (construct first) and fills the model default,
	// including the construct "source"→source-medium mapping this path
	// used to miss (raw sentinel 404'd at the gateway).
	route, err := resolveModelRoute("", "", d.Reg, d.AnthropicOAuth, d.OpenAICodexOAuth, d.OrgKeys, d.StateStore, d.IdLoader)
	if err != nil {
		return "", err
	}
	providerSlug, model := route.Slug, route.Model
	prov, err := buildProvider(providerSlug, d.AnthropicOAuth, d.OpenAICodexOAuth, d.OrgKeys, d.Reg, d.StateStore, d.IdLoader)
	if err != nil {
		return "", err
	}
	prov = provider.BuildDebugLogger(prov, d.Paths.LogsDir)

	last := "never"
	if a.LastRunAt > 0 {
		last = time.Unix(a.LastRunAt, 0).Format(time.RFC1123)
	}
	system := fmt.Sprintf(automationSystemPrompt, a.Instruction, time.Now().Format(time.RFC1123), last)
	if block := identity.CurrentUserBlock(d.IdLoader); block != "" {
		system = block + "\n" + system
	}

	var capFlags []string
	if resolved, ok := d.Reg.Lookup(providerSlug, model); ok {
		capFlags = resolved.Caps.Flags
	}
	h := &tool.SilentHandler{}
	run := agent.New(prov, r.reactorTools()).
		WithSummarizer(buildSummarizer(providerSlug, model, d.Reg, d.AnthropicOAuth, d.OpenAICodexOAuth, d.OrgKeys, d.StateStore, d.IdLoader))
	// Unattended runs get the same safety hooks as interactive chat —
	// without them the surface with no human watching had FEWER
	// guardrails than the one with a human present.
	if d.Hooks != nil {
		run = run.WithHooks(d.Hooks)
	}
	run.Run(ctx, agent.Options{
		Model:         model,
		System:        system,
		Prompt:        "Execute your automation rule now.",
		MaxIterations: 20,
		CapFlags:      capFlags,
	}, h)
	// SilentHandler used to discard OnError, so a dead provider (expired
	// OAuth, no credentials) recorded an empty "success" every interval
	// with zero audit trail. Surface it so markRun / conductorReport
	// carry the real reason.
	if err := h.Err(); err != nil {
		return "", err
	}
	return h.Result(), nil
}

// runDue runs every enabled rule whose interval has elapsed.
func (r *automationRuntime) runDue() {
	now := time.Now().Unix()
	for _, a := range r.store.List() {
		if !a.Enabled || a.IntervalMin <= 0 {
			continue
		}
		if a.LastRunAt != 0 && now-a.LastRunAt < int64(a.IntervalMin)*60 {
			continue
		}
		func() {
			defer func() {
				if rec := recover(); rec != nil {
					// A silent recover turned a recurring panic into an
					// invisible hot loop (no markRun → refires every tick).
					log.Printf("[automations] %s panicked: %v\n%s", a.ID, rec, debug.Stack())
					r.store.markRun(a.ID, fmt.Sprintf("error: panic: %v", rec))
				}
			}()
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
			defer cancel()
			res, err := r.runOne(ctx, a)
			if err != nil {
				res = "error: " + err.Error()
			}
			r.store.markRun(a.ID, res)
		}()
	}
}

// defaultConductorURL is the hosted control plane. The brain claims from it by
// default: automation rules live in Conductor now (the settings UI writes
// there), so the legacy in-brain ticker has nothing to run. Override with
// CONDUCTOR_URL, or set CONDUCTOR_URL=off to force the legacy local ticker
// (e.g. offline/dev with no control plane).
const defaultConductorURL = "https://conductor.construct.space"

// start launches the automation loop. As a CONDUCTOR EXECUTOR the brain claims
// due rules from the control plane, runs them, and reports — so the desktop is
// the preferred worker and the cloud fallback can take over when it's offline
// (lease prevents double-runs).
func (r *automationRuntime) start() {
	url := os.Getenv("CONDUCTOR_URL")
	if url == "" {
		url = defaultConductorURL
	}
	if url == "off" {
		log.Printf("[automations] CONDUCTOR_URL=off — using legacy local ticker")
		go func() {
			t := time.NewTicker(60 * time.Second)
			defer t.Stop()
			for range t.C {
				r.runDue()
			}
		}()
		return
	}
	log.Printf("[automations] claiming from conductor %s as %q", url, conductorExecutorID)
	r.startConductor(url)
}

const conductorExecutorID = "desktop"

// startConductor polls the control plane for a due automation, runs it via the
// reactor, and reports the result. Desktop polls briskly so it claims fresh
// rules first (local-first); the cloud executor uses a grace window so it only
// steps in when the desktop hasn't.
func (r *automationRuntime) startConductor(conductorURL string) {
	go func() {
		t := time.NewTicker(20 * time.Second)
		defer t.Stop()
		for range t.C {
			r.claimAndRun(conductorURL)
		}
	}()
}

func (r *automationRuntime) claimAndRun(conductorURL string) {
	defer func() {
		if rec := recover(); rec != nil {
			// Log + let the lease expire visibly instead of a silent
			// re-claim/re-panic loop with no diagnostic trail.
			log.Printf("[automations] claimAndRun panicked: %v\n%s", rec, debug.Stack())
		}
	}()
	token := ""
	if r.deps != nil && r.deps.IdLoader != nil {
		token = r.deps.IdLoader.Current().Token
	}
	if token == "" {
		return
	}
	a := conductorClaim(conductorURL, token)
	if a == nil {
		return
	}
	log.Printf("[automations] claimed %q (%s)", a.Instruction, a.ID)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	res, err := r.runOne(ctx, *a)
	if err != nil {
		res = "error: " + err.Error()
	}
	log.Printf("[automations] %s -> %s", a.ID, res)
	conductorReport(conductorURL, token, a.ID, res)
}

func conductorPost(url, token string, body any) ([]byte, bool) {
	b, _ := json.Marshal(body)
	req, err := http.NewRequest("POST", url, bytes.NewReader(b))
	if err != nil {
		return nil, false
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return nil, false
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, false
	}
	out, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	return out, true
}

// conductorClaim asks the control plane for one due automation to run.
func conductorClaim(conductorURL, token string) *Automation {
	out, ok := conductorPost(conductorURL+"/api/claim", token, map[string]any{
		"executor_id": conductorExecutorID,
		// Comfortably above the 3-minute run timeout. When the lease
		// exactly equalled the timeout, a run using its full window
		// finished after lease expiry and the cloud fallback could claim
		// and re-run the same firing (duplicate sends).
		"lease_secs": 300,
	})
	if !ok {
		return nil
	}
	var resp struct {
		Automation *Automation `json:"automation"`
	}
	if json.Unmarshal(out, &resp) != nil {
		return nil
	}
	return resp.Automation
}

func conductorReport(conductorURL, token, id, result string) {
	_, _ = conductorPost(conductorURL+"/api/report", token, map[string]any{
		"id":          id,
		"executor_id": conductorExecutorID,
		"result":      result,
	})
}
