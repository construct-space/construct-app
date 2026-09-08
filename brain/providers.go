// Provider routing — turns a slug + model id into a concrete
// provider.Provider. Catalog-driven first; falls back to env-var
// overrides for self-hosted endpoints. The companion of wire_oauth.go:
// OAuth flows live there, the "given creds, give me a Provider" lookup
// lives here.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/construct-space/brain/agent"
	"github.com/construct-space/brain/catalog"
	"github.com/construct-space/brain/identity"
	"github.com/construct-space/brain/provider"
	"github.com/construct-space/brain/state"
)

// constructGatewayURL is brain's default base URL for the Construct
// inference gateway. Override with CONSTRUCT_GATEWAY_URL for staging or
// local development. Hits provider-api's OpenAI-compatible surface at
// /api/inference/v1/chat/completions — same auth (session token), same
// request body shape, dispatch happens server-side via Source Family
// routing.
const constructGatewayURL = "https://my.construct.space/api/inference/v1"

func constructBaseURL() string {
	if v := strings.TrimSpace(os.Getenv("CONSTRUCT_GATEWAY_URL")); v != "" {
		return v
	}
	return constructGatewayURL
}

// inferProviderFromModel guesses the provider slug from a model id when
// the caller didn't say. Catalog lookup wins; falls back to family
// prefix matching. Returns "" when nothing matches — previously this
// defaulted to "anthropic", which silently routed every unknown-model
// prompt to Anthropic and surfaced as "oauth: re-login required" for
// users who never picked Anthropic. Callers that need a default now go
// through selectFallbackProvider so the choice is credential-aware.
// codexLinked=true makes "gpt-*" route to openai-codex (ChatGPT OAuth);
// without ChatGPT linked we route to plain "openai" so the user gets a
// clear "set OPENAI_API_KEY" error instead of "ChatGPT not linked".
func inferProviderFromModel(model string, reg *catalog.Registry, codexLinked bool) string {
	model = strings.TrimSpace(model)
	if model == "" {
		return ""
	}
	// Strip an existing "provider:" prefix if the caller bundled one
	// into the model id (legacy frontend shape). A prefix containing
	// '/' is a model path, not a slug — OpenRouter ids like
	// "openai/gpt-oss-20b:free" fall through to the catalog lookup,
	// which matches the full id (":free" included) to its owner.
	if prefix, _, found := strings.Cut(model, ":"); found && !strings.Contains(prefix, "/") {
		return strings.ToLower(prefix)
	}
	// Catalog wins — it knows which provider owns each model id.
	if snap := reg.Snapshot(); snap != nil {
		for _, p := range snap.Providers {
			for _, m := range p.Models {
				if strings.EqualFold(m.ID, model) {
					return strings.ToLower(p.Slug)
				}
			}
		}
	}
	m := strings.ToLower(model)
	switch {
	case strings.HasPrefix(m, "claude-"):
		return "anthropic"
	case strings.HasPrefix(m, "gemini-"):
		return "google"
	case strings.HasPrefix(m, "gpt-"), strings.HasPrefix(m, "o1"), strings.HasPrefix(m, "o3"), strings.HasPrefix(m, "o4"):
		if codexLinked {
			return "openai-codex"
		}
		return "openai"
	case strings.HasPrefix(m, "deepseek"):
		return "deepseek"
	case strings.HasPrefix(m, "mimo") || strings.HasPrefix(m, "xiaomi"):
		return "xiaomi"
	}
	return ""
}

// tokenSourceHasCredentials reports whether a TokenSource is actually
// usable right now. Plain TokenSources (env-var-backed) are always
// "ready"; LiveTokenSource wrappers honour their Key() callback so we
// can detect "logged out" without firing a refresh that errors out.
func tokenSourceHasCredentials(src provider.TokenSource) bool {
	if src == nil {
		return false
	}
	type credentialed interface {
		HasCredentials() bool
	}
	if c, ok := src.(credentialed); ok {
		return c.HasCredentials()
	}
	// Unknown wrapper — assume usable. Concrete env-var or static
	// sources don't expose HasCredentials but are always ready by
	// construction.
	return true
}

// codexHasCredentials reports whether the ChatGPT-Plus OAuth pair is
// actually present on disk. Lets buildProvider distinguish "codex link
// is live" from "codex wrapper exists but is empty" without firing a
// refresh.
func codexHasCredentials(c *codexAuth) bool {
	if c == nil || c.Tokens == nil {
		return false
	}
	return tokenSourceHasCredentials(c.Tokens)
}

// providerHasModel checks whether `model` appears in the catalog
// entry for `slug`. Used by handlePrompt to decide whether to keep the
// caller's model id after the provider was substituted by the fallback
// chain — see the comment in handlePrompt for why this matters.
// Returns false on unknown providers so the caller falls back to the
// substituted provider's default rather than passing through an id
// that won't resolve upstream.
func providerHasModel(reg *catalog.Registry, slug, model string) bool {
	if reg == nil {
		return false
	}
	snap := reg.Snapshot()
	if snap == nil {
		return false
	}
	model = strings.TrimSpace(model)
	if model == "" {
		return false
	}
	for _, p := range snap.Providers {
		if !strings.EqualFold(p.Slug, slug) {
			continue
		}
		for _, m := range p.Models {
			if strings.EqualFold(m.ID, model) {
				return true
			}
		}
		return false
	}
	return false
}

// localRuntimeBaseURL returns the base URL for an OpenAI-compatible
// local runtime (lmstudio, ollama, …). Reads `provider_url:<slug>` from
// the state KV first so the user's Settings entry wins; falls back to
// each runtime's well-known port. Matches the resolution that
// `wire_live_models.go` does for the /models probe.
func localRuntimeBaseURL(stateStore *state.Store, slug string) string {
	if stateStore != nil {
		if v, ok := stateStore.SettingsGet("provider_url:" + slug); ok {
			var s string
			if err := json.Unmarshal(v, &s); err == nil && s != "" {
				return s
			}
		}
		if v, ok := stateStore.KVGet("provider_url:" + slug); ok {
			var s string
			if err := json.Unmarshal(v, &s); err == nil && s != "" {
				return s
			}
		}
	}
	switch slug {
	case "lmstudio", "lm-studio":
		return "http://localhost:1234/v1"
	case "ollama":
		return "http://localhost:11434/v1"
	}
	return ""
}

// providerHasCredentials reports whether buildProvider would succeed for
// `slug` without firing any network calls. Used by the prompt path to
// decide whether to honour the caller's choice or substitute a
// usable fallback.
func providerHasCredentials(
	slug string,
	anthropicOAuth provider.TokenSource,
	codex *codexAuth,
	orgKeys *provider.OrgKeyStore,
	reg *catalog.Registry,
	stateStore *state.Store,
	idLoader *identity.Loader,
) bool {
	_, err := buildProvider(slug, anthropicOAuth, codex, orgKeys, reg, stateStore, idLoader)
	return err == nil
}

// selectFallbackProvider picks a provider to use when the caller didn't
// specify one (or specified an unknown model). Priority:
//
//  1. Catalog's default model's provider, if its credentials are present.
//  2. "construct" — the gateway-backed free tier; always works when the
//     user has a valid identity token (the gateway routes by user, not
//     by provider key).
//  3. Any catalog provider with credentials, in catalog order.
//
// Returns "" when nothing is usable. The caller emits a clean
// "no provider configured" error rather than letting the prompt path
// fall into a provider it can't satisfy.
func selectFallbackProvider(
	reg *catalog.Registry,
	anthropicOAuth provider.TokenSource,
	codex *codexAuth,
	orgKeys *provider.OrgKeyStore,
	stateStore *state.Store,
	idLoader *identity.Loader,
) string {
	hasCreds := func(slug string) bool {
		_, err := buildProvider(slug, anthropicOAuth, codex, orgKeys, reg, stateStore, idLoader)
		return err == nil
	}
	// 1. Construct gateway first: its identity token is verifiable
	//    locally, unlike OAuth-backed catalog defaults whose refresh
	//    token can be present-but-revoked ("re-login required" on the
	//    first fallback-routed prompt of every boot). The fallback only
	//    fires when the caller expressed no provider preference, so the
	//    platform's free lane is the honest default.
	if hasCreds("construct") {
		return "construct"
	}
	snap := reg.Snapshot()
	if snap != nil {
		// 2. Catalog default → its provider (if usable).
		for _, p := range snap.Providers {
			for _, m := range p.Models {
				if m.Default {
					slug := strings.ToLower(p.Slug)
					if hasCreds(slug) {
						return slug
					}
				}
			}
		}
		// 3. First catalog provider that has credentials.
		for _, p := range snap.Providers {
			slug := strings.ToLower(p.Slug)
			if hasCreds(slug) {
				return slug
			}
		}
	}
	return ""
}

// modelRoute is the resolved (provider, model) pair for one turn.
type modelRoute struct {
	Slug  string // provider slug with usable credentials
	Model string // bare model id (no "provider:" prefix)
}

// resolveModelRoute is the single source of truth for "which provider
// serves which model" on every dispatch path — chat prompt, ai.complete,
// automations, subagents. Rules:
//
//  1. A provider the caller NAMED — explicitly, via a composite
//     "provider:model" id, or via an inferrable model id — is honored
//     or errors. No silent substitution: a user who picked NVIDIA
//     without a key gets "nvidia: API key is required (set in
//     Settings → LLMs)", not a reply from a different model wearing
//     the same chat bubble. (The silent reroute is how an expired
//     Claude OAuth kept answering for NVIDIA picks, and how prompts
//     landed on the dead source-medium lane unasked.)
//  2. Only a request with NO provider signal at all uses the fallback
//     chain (selectFallbackProvider): construct first — its identity
//     token is verifiable locally, unlike OAuth freshness — then the
//     catalog default, then the first provider with credentials.
//  3. Model defaults come from the catalog; the construct slug maps
//     the legacy "source" sentinel onto source-medium.
func resolveModelRoute(
	providerArg, modelArg string,
	reg *catalog.Registry,
	anthropicOAuth provider.TokenSource,
	codex *codexAuth,
	orgKeys *provider.OrgKeyStore,
	stateStore *state.Store,
	idLoader *identity.Loader,
) (modelRoute, error) {
	slug := strings.ToLower(strings.TrimSpace(providerArg))
	model := strings.TrimSpace(modelArg)
	codexLinked := codexHasCredentials(codex)

	// Composite peel — the one choke point. Guards: a prefix containing
	// '/' is a model path (OpenRouter's "openai/gpt-oss-20b:free" must
	// not split); with an explicit provider, strip only an exact match.
	if idx := strings.Index(model, ":"); idx >= 0 {
		prefix := strings.ToLower(strings.TrimSpace(model[:idx]))
		validSlug := prefix != "" && !strings.Contains(prefix, "/")
		switch {
		case slug == "" && validSlug:
			slug = prefix
			model = model[idx+1:]
		case slug != "" && prefix == slug:
			model = model[idx+1:]
		}
	}
	named := slug != ""
	if slug == "" {
		if slug = inferProviderFromModel(model, reg, codexLinked); slug != "" {
			// Named via the model id — still the caller's pick.
			named = true
		}
	}

	if slug != "" {
		_, err := buildProvider(slug, anthropicOAuth, codex, orgKeys, reg, stateStore, idLoader)
		if err == nil {
			return finishModelRoute(slug, model, reg), nil
		}
		if named {
			// buildProvider errors are already actionable ("set X in
			// Settings → LLMs", "sign in via …") — surface them instead
			// of silently answering from a different provider.
			return modelRoute{}, err
		}
	}

	fallback := selectFallbackProvider(reg, anthropicOAuth, codex, orgKeys, stateStore, idLoader)
	if fallback == "" {
		return modelRoute{}, fmt.Errorf("no AI provider configured — sign in via Settings → Providers or set an API key")
	}
	// The model id belonged to the unusable slug's catalog; keep it only
	// if the fallback provider also carries it (some ids legitimately
	// appear across providers).
	if model != "" && !providerHasModel(reg, fallback, model) {
		model = ""
	}
	return finishModelRoute(fallback, model, reg), nil
}

// finishModelRoute fills in the model default for a resolved slug: the
// catalog default first, the legacy sentinel otherwise, and construct's
// sentinel mapped onto the gateway's real id.
func finishModelRoute(slug, model string, reg *catalog.Registry) modelRoute {
	if model == "" || model == defaultModel {
		if def := reg.DefaultModel(slug); def != "" {
			model = def
		} else {
			model = defaultModel
		}
	}
	// The Construct gateway validates model ids and doesn't accept the
	// bare "source" auto-route sentinel — map onto the medium tier.
	if slug == "construct" && (model == "" || model == defaultModel) {
		model = "source-medium"
	}
	return modelRoute{Slug: slug, Model: model}
}

// buildSummarizer returns an agent.Summarizer that asks a cheap model to
// summarise a chunk of compacted-away messages. Reuses the caller's
// provider so OAuth/API-key already in scope is honoured. Returns nil
// for unknown providers so compaction falls back to the lossy sentinel.
func buildSummarizer(providerSlug, fallbackModel string, reg *catalog.Registry, anthropicOAuth provider.TokenSource, openaiCodexOAuth *codexAuth, orgKeys *provider.OrgKeyStore, stateStore *state.Store, idLoader *identity.Loader) agent.Summarizer {
	prov, err := buildProvider(providerSlug, anthropicOAuth, openaiCodexOAuth, orgKeys, reg, stateStore, idLoader)
	if err != nil {
		return nil
	}
	model := fallbackModel
	if def := reg.DefaultModel(providerSlug); def != "" {
		// Prefer a cheap default — the catalog's "default" tends to be the
		// flash/haiku tier for each provider, which is what we want.
		model = def
	}
	return func(ctx context.Context, msgs []provider.Message) (string, error) {
		// Flatten the elided slice into a single user prompt — the
		// summariser doesn't need turn-by-turn structure.
		var flat strings.Builder
		for _, m := range msgs {
			flat.WriteString(strings.ToUpper(m.Role))
			flat.WriteString(": ")
			for _, b := range m.Content {
				switch b.Type {
				case "text":
					flat.WriteString(b.Text)
				case "tool_use":
					if b.ToolUse != nil {
						fmt.Fprintf(&flat, "[called %s]", b.ToolUse.Name)
					}
				case "tool_result":
					if b.ToolResult != nil {
						out := b.ToolResult.Content
						if len(out) > 400 {
							out = out[:400] + "…"
						}
						fmt.Fprintf(&flat, "[tool result: %s]", out)
					}
				}
			}
			flat.WriteByte('\n')
		}
		req := provider.Request{
			Model:     model,
			System:    "You are a context-window summarizer. Produce ONE paragraph (≤200 words) capturing: what the user asked, what was tried, what worked or failed, and any decisions or state the next turn must remember. No preamble.",
			MaxTokens: 400,
			Messages: []provider.Message{{
				Role: "user",
				Content: []provider.Block{{
					Type: "text",
					Text: "Summarise this conversation slice:\n\n" + flat.String(),
				}},
			}},
		}
		var summary strings.Builder
		err := prov.Stream(ctx, req, func(ev provider.Event) {
			if ev.Type == "text_delta" {
				summary.WriteString(ev.TextDelta)
			}
		})
		if err != nil {
			return "", err
		}
		return strings.TrimSpace(summary.String()), nil
	}
}

// buildProvider routes a slug to a concrete Provider implementation.
//
// Catalog-driven: when the slug matches a ProviderEntry in catalog
// (the gateway-published list), brain uses that entry's BaseURL +
// EnvKeys + a Settings-store API key under "provider_key:<slug>"
// (operator's storage convention — same path the Settings → LLMs page
// writes to). Special-cased on top: anthropic / google / openai-codex
// use bespoke clients because their APIs aren't OpenAI-compatible.
//
// Key resolution order:
//  1. Enforced org key (admin's "bill everything to us" lever)
//  2. Settings store key "provider_key:<slug>"  ← user-set in UI
//  3. Env var (one of EnvKeys[] from catalog, or explicit list)
//  4. Non-enforced org key
//  5. nothing → "API key is required" error
func buildProvider(name string, anthropicOAuth provider.TokenSource, codex *codexAuth, orgKeys *provider.OrgKeyStore, reg *catalog.Registry, stateStore *state.Store, idLoader *identity.Loader) (provider.Provider, error) {
	if name == "" {
		name = "anthropic"
	}
	name = strings.ToLower(name)

	resolveKey := func(slug string, envNames ...string) string {
		// 1. Enforced org key wins outright.
		if orgKeys != nil {
			if ok, found := orgKeys.Get(slug); found && ok.Enforced {
				return ok.APIKey
			}
		}
		// 2. User-saved key in settings (matches operator's wire convention).
		if stateStore != nil {
			if v, ok := stateStore.SettingsGet("provider_key:" + slug); ok {
				var s string
				if err := json.Unmarshal(v, &s); err == nil && s != "" {
					return s
				}
			}
		}
		// 3. Env var.
		for _, env := range envNames {
			if v := os.Getenv(env); v != "" {
				return v
			}
		}
		// 4. Non-enforced org key as final fallback.
		if orgKeys != nil {
			if ok, found := orgKeys.Get(slug); found {
				return ok.APIKey
			}
		}
		return ""
	}

	// Special-cased providers — bespoke clients, can't use OpenAI-compat.
	switch name {
	case "anthropic", "claude", "claude-oauth":
		// "claude-oauth" is the frontend's connector id for the Claude
		// Pro/Max subscription (vs "anthropic" for a pay-per-token API
		// key). Both resolve to the same Anthropic client here — the case
		// below already prefers OAuth credentials when present and falls
		// back to an API key — so the OpenAI side's "openai-oauth" alias
		// has a symmetric partner instead of falling through to the
		// catalog branch (which would demand an API key the Pro/Max user
		// never set).
		key := resolveKey("anthropic", "ANTHROPIC_API_KEY")
		hasOAuth := tokenSourceHasCredentials(anthropicOAuth)
		if key == "" && !hasOAuth {
			return nil, fmt.Errorf("anthropic: no credentials (set ANTHROPIC_API_KEY in Settings → LLMs, or sign in via Claude OAuth)")
		}
		p := provider.NewAnthropic(key)
		// Only attach OAuth when we actually have an unexpired refresh
		// token. Attaching an empty LiveTokenSource guarantees that
		// `a.Tokens.Token()` returns ErrReauthRequired the first time
		// the agent loop runs, surfacing as the misleading
		// "anthropic: oauth token: oauth: re-login required" even
		// when the user never picked Anthropic.
		if hasOAuth {
			p = p.WithOAuth(anthropicOAuth)
		}
		return p, nil
	case "google", "gemini":
		key := resolveKey("google", "GEMINI_API_KEY", "GOOGLE_API_KEY")
		if key == "" {
			return nil, fmt.Errorf("google: no credentials (set GEMINI_API_KEY in Settings → LLMs)")
		}
		return provider.NewGoogle(key), nil
	case "openai-codex", "openai-oauth", "chatgpt":
		if !codexHasCredentials(codex) {
			return nil, fmt.Errorf("openai-codex: not linked — sign in via Settings → Providers → ChatGPT")
		}
		return provider.NewOpenAICodex(codex.Tokens, codex.AccountID), nil
	case "openai":
		if key := resolveKey("openai", "OPENAI_API_KEY"); key != "" {
			return provider.NewOpenAI("openai", "https://api.openai.com/v1", key), nil
		}
		if codexHasCredentials(codex) {
			return provider.NewOpenAICodex(codex.Tokens, codex.AccountID), nil
		}
		return nil, fmt.Errorf("openai: no credentials (set OPENAI_API_KEY in Settings → LLMs, or sign in via ChatGPT)")
	case "construct":
		// Construct gateway: free models routed via llm.construct.space.
		// Auth is the user's identity token from auth.json (NOT an API
		// key); gateway middleware exchanges it for the upstream
		// Together AI key server-side. Reuses provider.NewOpenAI since
		// the gateway exposes a /v1/chat/completions alias of its
		// /api/chat/stream handler.
		if idLoader == nil {
			return nil, fmt.Errorf("construct: identity loader not wired (internal — file a bug)")
		}
		// Refresh from auth.json — brain may have booted before the user
		// signed in, so Current() can be stale (empty Token) even when
		// the file on disk holds a valid cat_* identity token.
		idLoader.Load()
		token := strings.TrimSpace(idLoader.Current().Token)
		if token == "" {
			return nil, fmt.Errorf("construct: not signed in — sign in via the app menu to use the free Construct gateway")
		}
		return provider.NewOpenAI("construct", constructBaseURL(), token), nil
	case "lmstudio", "lm-studio", "ollama":
		// Local OpenAI-compat runtimes don't need an API key. The base
		// URL comes from the user-configured `provider_url:<slug>`
		// settings KV (so Settings → LM Studio Base URL is honoured),
		// falling back to each runtime's well-known port.
		baseURL := localRuntimeBaseURL(stateStore, name)
		if baseURL == "" {
			return nil, fmt.Errorf("%s: no base URL configured", name)
		}
		// `resolveKey` returns "" when no key is set — fine, the local
		// servers accept anything (LM Studio + Ollama ignore the header).
		// Pass through any custom key in case the user is running a
		// proxy that does check it.
		key := resolveKey(name)
		return provider.NewOpenAI(name, baseURL, key), nil
	}

	// Everything else: catalog-driven OpenAI-compatible client.
	if entry, baseURL, envKeys, ok := lookupCatalogProvider(reg, name); ok {
		key := resolveKey(entry, envKeys...)
		if key == "" {
			return nil, fmt.Errorf("%s: API key is required (set in Settings → LLMs → %s)", entry, entry)
		}
		if baseURL == "" {
			return nil, fmt.Errorf("%s: catalog entry has no BaseURL — provider misconfigured upstream", entry)
		}
		return provider.NewOpenAI(entry, baseURL, key), nil
	}

	// Truly unknown — last-chance env-var override for self-hosted /
	// custom OpenAI-compatible endpoints not in the catalog.
	envSlug := strings.ToUpper(strings.ReplaceAll(name, "-", "_"))
	base := os.Getenv(envSlug + "_BASE_URL")
	key := resolveKey(name, envSlug+"_API_KEY")
	if base != "" && key != "" {
		return provider.NewOpenAI(name, base, key), nil
	}
	return nil, fmt.Errorf("unknown provider: %s (not in catalog; set %s_BASE_URL + %s_API_KEY to bring your own endpoint)", name, envSlug, envSlug)
}

// lookupCatalogProvider finds a provider entry by slug (case-insensitive)
// and returns its canonical slug, base URL, and env keys. The frontend
// surfaces names like "Ali Baba" but writes settings + sends provider
// payloads using the catalog slug; we case-fold here so capitalization
// can't desync the two paths.
func lookupCatalogProvider(reg *catalog.Registry, slug string) (canonicalSlug, baseURL string, envKeys []string, found bool) {
	if reg == nil {
		return "", "", nil, false
	}
	snap := reg.Snapshot()
	if snap == nil {
		return "", "", nil, false
	}
	want := strings.ToLower(slug)
	for _, p := range snap.Providers {
		if strings.ToLower(p.Slug) == want {
			return p.Slug, p.APIKey.BaseURL, p.APIKey.EnvKeys, true
		}
	}
	return "", "", nil, false
}
