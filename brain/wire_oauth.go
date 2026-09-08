// OAuth wire handlers + login-flow state. Pulled out of main.go to keep
// that file focused on lifecycle and registration. Everything here is
// package main; importable surface is intentionally none — the handlers
// are wired through registerBuiltins.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/construct-space/brain/catalog"
	"github.com/construct-space/brain/identity"
	"github.com/construct-space/brain/oauth"
	"github.com/construct-space/brain/provider"
	"github.com/construct-space/brain/state"
	"github.com/construct-space/brain/wire"
)

// pendingLogin tracks one in-flight OAuth login. Created on oauth.login,
// drained by oauth.poll once the browser callback completes, aborted by
// oauth.cancel.
type pendingLogin struct {
	cancel   context.CancelFunc
	cancelCh chan struct{}
	done     chan loginResult
}

type loginResult struct {
	creds *oauth.Credentials
	err   error
}

type loginRegistry struct {
	mu sync.Mutex
	m  map[string]*pendingLogin
}

func newLoginRegistry() *loginRegistry {
	return &loginRegistry{m: map[string]*pendingLogin{}}
}

type oauthLoginPayload struct {
	Provider string `json:"provider"`
}

func handleOAuthLogin(parent context.Context, req wire.Request, emit func(wire.Response), logins *loginRegistry, store *oauth.Storage, idLoader *identity.Loader) {
	var pl oauthLoginPayload
	_ = json.Unmarshal(req.Payload, &pl)
	if pl.Provider == "" {
		emit(wire.Response{ID: req.ID, Success: false, Error: "payload.provider is required", Done: true})
		return
	}
	// Per-provider login dispatch. Each fn runs PKCE + a local callback
	// server + token exchange; only URLs and ports differ.
	type loginFn func(context.Context, func(string), <-chan struct{}) (*oauth.Credentials, error)
	loginFor := map[string]loginFn{
		"claude":       oauth.AnthropicLogin,
		"anthropic":    oauth.AnthropicLogin,
		"openai-codex": oauth.OpenAICodexLogin,
	}
	login, ok := loginFor[pl.Provider]
	if !ok {
		emit(wire.Response{ID: req.ID, Success: false, Error: "provider not supported yet: " + pl.Provider, Done: true})
		return
	}
	logins.mu.Lock()
	if stale, busy := logins.m[pl.Provider]; busy {
		// Self-heal a stale/abandoned flow: the user closed the browser tab,
		// it opened in the wrong profile, or a prior attempt timed out without
		// completing. Abort it and start fresh instead of dead-ending on
		// "already pending; call oauth.cancel first" — clicking "Sign in"
		// again should just work. The callback server binds a FIXED port
		// (53692) and only releases it (deferred server.Close) once login()
		// returns and writes `done`, so we must wait for that before the new
		// flow tries to bind the same port.
		delete(logins.m, pl.Provider)
		logins.mu.Unlock()
		close(stale.cancelCh)
		stale.cancel()
		select {
		case <-stale.done:
		case <-time.After(3 * time.Second):
		}
		logins.mu.Lock()
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	cancelCh := make(chan struct{})
	done := make(chan loginResult, 1)
	logins.m[pl.Provider] = &pendingLogin{cancel: cancel, cancelCh: cancelCh, done: done}
	logins.mu.Unlock()

	providerID := pl.Provider
	go func() {
		defer cancel()
		creds, err := login(ctx, func(authURL string) {
			fmt.Fprintf(os.Stderr, "[oauth] %s: browser opened (%s)\n", providerID, authURL)
		}, cancelCh)
		if err == nil {
			if storeErr := store.Save(providerID, creds); storeErr != nil {
				fmt.Fprintf(os.Stderr, "[oauth] %s: save failed: %v\n", providerID, storeErr)
			} else {
				idLoader.Load() // refresh in-memory identity so subscriptions list updates
				fmt.Fprintf(os.Stderr, "[oauth] %s: login successful\n", providerID)
			}
		} else {
			fmt.Fprintf(os.Stderr, "[oauth] %s: login failed: %v\n", providerID, err)
		}
		done <- loginResult{creds: creds, err: err}
	}()

	emit(wire.Response{
		ID:      req.ID,
		Success: true,
		Data:    map[string]any{"provider": providerID, "pending": true},
		Done:    true,
	})
	_ = parent
}

func handleOAuthPoll(req wire.Request, emit func(wire.Response), logins *loginRegistry) {
	var pl oauthLoginPayload
	_ = json.Unmarshal(req.Payload, &pl)
	logins.mu.Lock()
	pending, ok := logins.m[pl.Provider]
	logins.mu.Unlock()
	if !ok {
		emit(wire.Response{ID: req.ID, Success: false, Error: "no pending OAuth flow for " + pl.Provider, Done: true})
		return
	}
	select {
	case r := <-pending.done:
		logins.mu.Lock()
		delete(logins.m, pl.Provider)
		logins.mu.Unlock()
		if r.err != nil {
			emit(wire.Response{ID: req.ID, Success: false, Error: r.err.Error(), Done: true})
			return
		}
		emit(wire.Response{
			ID: req.ID, Success: true,
			Data: map[string]any{"provider": pl.Provider, "status": "success", "success": true},
			Done: true,
		})
	default:
		emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"status": "pending"}, Done: true})
	}
}

func handleOAuthCancel(req wire.Request, emit func(wire.Response), logins *loginRegistry) {
	var pl oauthLoginPayload
	_ = json.Unmarshal(req.Payload, &pl)
	logins.mu.Lock()
	pending, ok := logins.m[pl.Provider]
	if ok {
		delete(logins.m, pl.Provider)
	}
	logins.mu.Unlock()
	if ok {
		close(pending.cancelCh)
		pending.cancel()
	}
	emit(wire.Response{
		ID: req.ID, Success: true,
		Data: map[string]any{"provider": pl.Provider, "cancelled": ok},
		Done: true,
	})
}

// handleOAuthProviders returns the list of provider connection state for
// the LLM Settings page. Enumerates the catalog for friendly names and
// marks each provider connected when there's a matching auth.json entry.
func handleOAuthProviders(req wire.Request, emit func(wire.Response), store *oauth.Storage, reg *catalog.Registry) {
	connected := store.Connected()

	type entry struct {
		ID        string   `json:"id"`
		Name      string   `json:"name,omitempty"`
		Connected bool     `json:"connected"`
		Models    []string `json:"models,omitempty"`
		Runtime   bool     `json:"runtime,omitempty"`
	}
	entries := []entry{}
	seen := map[string]bool{}

	if snap := reg.Snapshot(); snap != nil {
		for _, p := range snap.Providers {
			models := make([]string, 0, len(p.Models))
			for _, m := range p.Models {
				if m.Enabled() && !m.Deprecated {
					models = append(models, m.ID)
				}
			}
			entries = append(entries, entry{ID: p.Slug, Name: p.Name, Connected: connected[p.Slug], Models: models})
			seen[p.Slug] = true
		}
	}
	// Anything in auth.json the catalog didn't list (e.g. "claude" alias).
	for slug := range connected {
		if seen[slug] {
			continue
		}
		entries = append(entries, entry{ID: slug, Connected: true})
	}
	emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"providers": entries}, Done: true})
}

func handleOAuthLogout(req wire.Request, emit func(wire.Response), store *oauth.Storage, idLoader *identity.Loader) {
	var pl oauthLoginPayload
	_ = json.Unmarshal(req.Payload, &pl)
	if pl.Provider == "" {
		emit(wire.Response{ID: req.ID, Success: false, Error: "payload.provider is required", Done: true})
		return
	}
	if err := store.Delete(pl.Provider); err != nil {
		emit(wire.Response{ID: req.ID, Success: false, Error: err.Error(), Done: true})
		return
	}
	idLoader.Load()
	emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"cleared": true}, Done: true})
}

// handleProviderStatus reports per-provider readiness for the LLM
// settings page: a provider counts as "configured" when there's either
// an OAuth entry stored or one of its known env vars is set.
func handleProviderStatus(req wire.Request, emit func(wire.Response), store *oauth.Storage, reg *catalog.Registry) {
	status := map[string]bool{}
	connected := store.Connected()
	for slug := range connected {
		status[slug] = true
	}
	if snap := reg.Snapshot(); snap != nil {
		for _, p := range snap.Providers {
			if status[p.Slug] {
				continue
			}
			for _, env := range p.APIKey.EnvKeys {
				if os.Getenv(env) != "" {
					status[p.Slug] = true
					break
				}
			}
		}
	}
	emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"providers": status}, Done: true})
}

// handleAIProviders returns the legacy ai.providers shape: per-provider
// metadata + which auth method is currently usable. The UI keys
// connected/api_key_present off this for the picker badges.
//
// Local OpenAI-compatible runtimes (LM Studio, Ollama) are appended after
// the remote catalog so the frontend's `activeById` map knows they exist;
// otherwise picking an LMStudio model from Settings has no effect on
// `useBrainSession.send` — the unknown provider gets dropped and
// `selectFallbackProvider` substitutes the catalog default (Mistral).
func handleAIProviders(req wire.Request, emit func(wire.Response), reg *catalog.Registry, store *oauth.Storage, stateStore *state.Store, orgKeys *provider.OrgKeyStore) {
	type model struct {
		ID    string `json:"id"`
		Label string `json:"label,omitempty"`
	}
	type entry struct {
		ID            string   `json:"id"`
		Name          string   `json:"name,omitempty"`
		BaseURL       string   `json:"base_url,omitempty"`
		EnvKeys       []string `json:"env_keys,omitempty"`
		APIKeyPresent bool     `json:"api_key_present"`
		OAuthLinked   bool     `json:"oauth_linked"`
		Connected     bool     `json:"connected"`
		Kind          string   `json:"kind,omitempty"`
		Models        []model  `json:"models,omitempty"`
	}
	connected := store.Connected()
	var providers []entry
	if snap := reg.Snapshot(); snap != nil {
		for _, p := range snap.Providers {
			e := entry{ID: p.Slug, Name: p.Name, BaseURL: p.APIKey.BaseURL, EnvKeys: p.APIKey.EnvKeys}
			// Mirror buildProvider's credential sources so a provider
			// configured by ANY of them shows as connected — not just env
			// vars. This covers user-pasted keys (settings store) and
			// org-managed shared keys, which were previously usable by
			// buildProvider yet reported disconnected here, so they never
			// appeared in the model picker.
			for _, env := range p.APIKey.EnvKeys {
				if os.Getenv(env) != "" {
					e.APIKeyPresent = true
					break
				}
			}
			if !e.APIKeyPresent && stateStore != nil {
				if v, ok := stateStore.SettingsGet("provider_key:" + p.Slug); ok {
					var s string
					if json.Unmarshal(v, &s) == nil && s != "" {
						e.APIKeyPresent = true
					}
				}
			}
			if !e.APIKeyPresent && orgKeys != nil {
				if ok, found := orgKeys.Get(p.Slug); found && ok.APIKey != "" {
					e.APIKeyPresent = true
				}
			}
			e.OAuthLinked = connected[p.Slug] || (p.Slug == "anthropic" && connected["claude"])
			e.Connected = e.APIKeyPresent || e.OAuthLinked
			for _, m := range p.Models {
				if m.Enabled() && !m.Deprecated {
					e.Models = append(e.Models, model{ID: m.ID, Label: m.Name})
				}
			}
			providers = append(providers, e)
		}
	}

	// Local runtimes — no credentials, just a base URL. Always surfaced so
	// the picker can route to them; the live model list is populated
	// lazily via `provider.list-live-models`.
	for _, lr := range []struct{ id, name string }{
		{"lmstudio", "LM Studio"},
		{"ollama", "Ollama"},
	} {
		baseURL, _ := resolveLocalBaseURL(stateStore, lr.id)
		providers = append(providers, entry{
			ID:        lr.id,
			Name:      lr.name,
			BaseURL:   baseURL,
			Kind:      "local",
			Connected: true,
		})
	}
	emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{"providers": providers}, Done: true})
}

// buildLiveAnthropicOAuth returns a TokenSource that rebuilds itself when
// the on-disk refresh token changes. handleOAuthLogin only has to save +
// idLoader.Load(); the next prompt picks up the new credentials with no
// callback wiring back to main. Initial build can be nil-result (no
// credentials at boot) — the Live wrapper handles that gracefully.
func buildLiveAnthropicOAuth(idLoader *identity.Loader, store *oauth.Storage) provider.TokenSource {
	return &oauth.LiveTokenSource{
		Build: func() provider.TokenSource {
			return buildAnthropicOAuth(idLoader, store)
		},
		Key: func() string {
			// Reload from disk first: credentials written by the desktop
			// app (or a login that happened after brain booted) are
			// invisible in the cached Current() snapshot — the exact
			// "signed in via the app but brain says no credentials"
			// class of bug. The construct provider already reloads per
			// request; auth.json is tiny, so this is cheap.
			idLoader.Load()
			c, ok := idLoader.Current().Credentials["claude"]
			if !ok {
				return ""
			}
			return c.Refresh
		},
	}
}

// buildLiveOpenAICodexOAuth wraps the codexAuth struct so it rebuilds on
// credential rotation. Returns nil only if you want a permanent "no
// codex" state — otherwise the wrapper handles missing creds at call time.
func buildLiveOpenAICodexOAuth(idLoader *identity.Loader, store *oauth.Storage) *codexAuth {
	live := &oauth.LiveTokenSource{
		Build: func() provider.TokenSource {
			inner := buildOpenAICodexOAuth(idLoader, store)
			if inner == nil {
				return nil
			}
			return inner.Tokens
		},
		Key: func() string {
			// Reload from disk — same staleness fix as the Anthropic
			// wrapper above: app-side logins after brain boot must be
			// visible without a restart.
			idLoader.Load()
			c, ok := idLoader.Current().Credentials["openai-codex"]
			if !ok {
				return ""
			}
			return c.Refresh
		},
	}
	// codexAuth.AccountID is read per-prompt; we re-extract from the
	// current credential's access token so a re-login that switches
	// accounts gets the right header without restart.
	return &codexAuth{Tokens: live, AccountID: ""}
}

func buildAnthropicOAuth(idLoader *identity.Loader, store *oauth.Storage) provider.TokenSource {
	creds := idLoader.Current().Credentials
	c, ok := creds["claude"]
	if !ok || c.Refresh == "" {
		return nil
	}
	fmt.Fprintln(os.Stderr, "[brain] anthropic OAuth available (Claude subscription linked)")
	src := oauth.NewAnthropicTokenSource(c.Refresh)
	src.OnRotate = func(creds *oauth.Credentials) error {
		if err := store.Save("claude", creds); err != nil {
			fmt.Fprintf(os.Stderr, "[brain] anthropic OAuth rotation: persist failed: %v\n", err)
			return err
		}
		fmt.Fprintln(os.Stderr, "[brain] anthropic OAuth refresh token rotated and persisted")
		idLoader.Load() // refresh in-memory copy too
		return nil
	}
	src.OnReload = func() (string, error) {
		return store.ReloadRefresh("claude")
	}
	return src
}

// codexAuth pairs a token source with the ChatGPT-Account-Id parsed from
// the access token's JWT. AccountID can be empty — Codex tolerates the
// header being absent — but supplying it speeds up routing and matches
// the ChatGPT desktop client's wire shape.
type codexAuth struct {
	Tokens    provider.TokenSource
	AccountID string
}

func buildOpenAICodexOAuth(idLoader *identity.Loader, store *oauth.Storage) *codexAuth {
	creds := idLoader.Current().Credentials
	c, ok := creds["openai-codex"]
	if !ok || c.Refresh == "" {
		return nil
	}
	fmt.Fprintln(os.Stderr, "[brain] openai-codex OAuth available (ChatGPT subscription linked)")
	src := oauth.NewOpenAICodexTokenSource(c.Refresh)
	src.OnRotate = func(creds *oauth.Credentials) error {
		if err := store.Save("openai-codex", creds); err != nil {
			fmt.Fprintf(os.Stderr, "[brain] openai-codex OAuth rotation: persist failed: %v\n", err)
			return err
		}
		fmt.Fprintln(os.Stderr, "[brain] openai-codex OAuth refresh token rotated and persisted")
		idLoader.Load()
		return nil
	}
	src.OnReload = func() (string, error) {
		return store.ReloadRefresh("openai-codex")
	}
	accountID := ""
	if c.Access != "" {
		accountID, _ = oauth.ExtractOpenAICodexIdentity(c.Access)
	}
	return &codexAuth{Tokens: src, AccountID: accountID}
}
