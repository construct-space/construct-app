// Package catalog is brain's client of Construct's provider catalog.
// Source of truth is my.construct.space/api/providers; we cache locally
// with ETag so brain works offline and refreshes cheaply.
package catalog

import (
	"encoding/json"
	"slices"
)

// Catalog is the parsed snapshot brain looks up against.
type Catalog struct {
	Version   string          `json:"version"`
	Providers []ProviderEntry `json:"data"`
}

// ProviderEntry mirrors what the public /api/source/providers catalog
// returns. The gateway groups auth-related fields under nested objects
// (api_key, monthly) — we flatten the ones brain cares about for
// ergonomic access while preserving the originals.
type ProviderEntry struct {
	ID           string          `json:"id,omitempty"`
	Slug         string          `json:"slug"`
	Name         string          `json:"name"`
	APIKey       APIKeyAuth      `json:"api_key,omitempty"`
	Monthly      MonthlyAuth     `json:"monthly,omitempty"`
	Enabled      bool            `json:"enabled"`
	Capabilities json.RawMessage `json:"capabilities,omitempty"`
	Models       []ModelEntry    `json:"models,omitempty"`
}

// APIKeyAuth carries the api-key auth shape: whether the provider
// supports a user-supplied API key, what base URL to call, whether an
// org-shared key is available upstream.
type APIKeyAuth struct {
	Enabled      bool     `json:"enabled"`
	BaseURL      string   `json:"base_url,omitempty"`
	EnvKeys      []string `json:"env_keys,omitempty"`
	HasSharedKey bool     `json:"has_shared_key,omitempty"`
}

// MonthlyAuth is the subscription / OAuth auth shape (Claude Pro,
// ChatGPT Plus). When Enabled the user can sign in via OAuth instead
// of supplying an API key.
type MonthlyAuth struct {
	Enabled  bool   `json:"enabled"`
	AuthType string `json:"auth_type,omitempty"`
}

// BaseURL returns the api_key base URL — the canonical accessor brain
// uses when building an OpenAI-compatible provider against this entry.
func (p ProviderEntry) BaseURLForKey() string { return p.APIKey.BaseURL }

// EnvKeysForKey returns the env vars brain should probe for an API key.
func (p ProviderEntry) EnvKeysForKey() []string { return p.APIKey.EnvKeys }

// ModelEntry is one model under a provider. Gateway shape: id, name,
// capabilities (array), context/output limits, availability flags per
// auth method. `Enabled` is a virtual flag derived from
// available_on_api_key / available_on_monthly so callers don't need to
// pick one — if it's reachable via any auth method, treat as enabled.
type ModelEntry struct {
	ID                 string          `json:"id"`
	Name               string          `json:"name"`
	Capabilities       json.RawMessage `json:"capabilities,omitempty"`
	ContextWindow      int             `json:"context_window,omitempty"`
	MaxOutputTokens    int             `json:"max_output_tokens,omitempty"`
	AvailableOnAPIKey  bool            `json:"available_on_api_key,omitempty"`
	AvailableOnMonthly bool            `json:"available_on_monthly,omitempty"`
	InputCostPer1M     float64         `json:"input_cost_per_1m,omitempty"`
	OutputCostPer1M    float64         `json:"output_cost_per_1m,omitempty"`
	Deprecated         bool            `json:"deprecated,omitempty"`
	Default            bool            `json:"default,omitempty"`
	ReplacedBy         string          `json:"replaced_by,omitempty"`
	MinAppVersion      string          `json:"min_app_version,omitempty"`
	// TierHint ('large'|'medium'|'small') pre-populates the desktop's
	// L/M/S tier slots and the assistant panel's session-tier chip.
	// Brain doesn't route by it — it must round-trip models.list
	// verbatim; omitting it here silently pinned every model to the
	// frontend's 'medium' fallback.
	TierHint string `json:"tier_hint,omitempty"`
}

// Enabled reports whether a model is reachable via at least one auth
// method. Callers used `m.Enabled` against the old schema; this method
// preserves that surface across the rename.
func (m ModelEntry) Enabled() bool {
	return m.AvailableOnAPIKey || m.AvailableOnMonthly
}

// Caps is the decoded capability list for one model. Strings come from the
// catalog (e.g. "tools", "structured", "vision", "caching", "reasoning").
type Caps struct {
	Flags []string
}

func (c Caps) Has(flag string) bool { return slices.Contains(c.Flags, flag) }

// Caps decodes a model's capability list. Returns empty Caps on parse
// failure rather than erroring — degraded mode (no fancy features) is
// preferable to refusing to call the model.
func (m ModelEntry) Caps() Caps {
	var flags []string
	if len(m.Capabilities) > 0 {
		_ = json.Unmarshal(m.Capabilities, &flags)
	}
	return Caps{Flags: flags}
}
