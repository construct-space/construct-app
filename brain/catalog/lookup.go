package catalog

import "strings"

// Resolved is what a provider implementation needs to build a request.
// Empty Caps means "we don't know" — the provider should fall back to
// conservative defaults (no strict tools, no cache_control).
type Resolved struct {
	Provider ProviderEntry
	Model    ModelEntry
	Caps     Caps
}

// Lookup finds a model by provider slug + model id. Matching is exact on
// slug, exact-or-prefix on model id (so "claude-sonnet-4-5" matches a
// catalog entry of "claude-sonnet-4-5" or "claude-sonnet-4-5-20251201").
// Returns ok=false if either the catalog is empty or no match is found.
func (r *Registry) Lookup(providerSlug, modelID string) (Resolved, bool) {
	r.mu.RLock()
	snap := r.snap
	r.mu.RUnlock()
	if snap == nil {
		return Resolved{}, false
	}

	for _, p := range snap.Providers {
		if !strings.EqualFold(p.Slug, providerSlug) {
			continue
		}
		for _, m := range p.Models {
			// Exact match on the catalog id is the common case; prefix
			// match falls through for dated upstream ids (e.g. agent
			// says "claude-haiku-4-5", catalog row is
			// "claude-haiku-4-5-20251001").
			if m.ID == modelID {
				return Resolved{Provider: p, Model: m, Caps: m.Caps()}, true
			}
			if modelID != "" && strings.HasPrefix(m.ID, modelID) {
				return Resolved{Provider: p, Model: m, Caps: m.Caps()}, true
			}
		}
		// No match within this provider — fall through; another provider
		// entry with the same slug is unlikely but possible (BYOK vs Construct).
	}
	return Resolved{}, false
}

// DefaultModel returns the model flagged default for a provider, or empty
// string if the provider has no default (or isn't in the catalog).
func (r *Registry) DefaultModel(providerSlug string) string {
	r.mu.RLock()
	snap := r.snap
	r.mu.RUnlock()
	if snap == nil {
		return ""
	}
	for _, p := range snap.Providers {
		if !strings.EqualFold(p.Slug, providerSlug) {
			continue
		}
		for _, m := range p.Models {
			if m.Default && m.Enabled() {
				return m.ID
			}
		}
	}
	return ""
}
