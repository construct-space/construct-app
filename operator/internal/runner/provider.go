package runner

import (
	"context"
	"fmt"
	"strings"

	"construct-operator/internal/provider"
	"construct-operator/internal/stream"
)

// resolveProvider finds a provider for the given model.
// Returns the provider and the actual model to use (may differ from input if fallback).
// Accepts both bare model names ("claude-sonnet-4-6") and composite IDs ("anthropic-oauth:claude-sonnet-4-6").
func (r *Runner) resolveProvider(model string) (provider.Provider, string, error) {
	r.providersMu.RLock()
	defer r.providersMu.RUnlock()

	// Handle composite "provider:model" format from frontend
	if parts := strings.SplitN(model, ":", 2); len(parts) == 2 {
		providerID, modelName := parts[0], parts[1]
		if p, ok := r.providers[providerID]; ok {
			for _, m := range p.Models() {
				if m == modelName {
					return p, modelName, nil
				}
			}
			return nil, "", fmt.Errorf("provider %q does not support model %q", providerID, modelName)
		}
		// Some model IDs include ":" as part of the raw model name
		// (for example OpenRouter free-tier suffixes like ":free").
		// If the provider prefix is unknown, treat the whole string as a
		// bare model ID before surfacing a registration error.
		for _, p := range r.providers {
			for _, m := range p.Models() {
				if m == model {
					return p, model, nil
				}
			}
		}
		return nil, "", fmt.Errorf("provider %q not registered (need to authenticate?)", providerID)
	}

	// Exact match on bare model name
	for _, p := range r.providers {
		for _, m := range p.Models() {
			if m == model {
				return p, model, nil
			}
		}
	}
	// No silent cross-family fallback — if we asked for claude-*, don't route to Codex
	return nil, "", fmt.Errorf("no provider supports model %q (is the provider authenticated?)", model)
}

// fallbackProvider returns a different provider than the given one,
// preferring providers from the same model family (claude->anthropic, gpt->openai).
func (r *Runner) fallbackProvider(skipID string) (provider.Provider, string, error) {
	r.providersMu.RLock()
	defer r.providersMu.RUnlock()

	// Determine the family of the skipped provider so we prefer same-family fallback
	skipFamily := providerFamily(skipID)

	// First pass: same family
	for _, p := range r.providers {
		if p.ID() == skipID {
			continue
		}
		if providerFamily(p.ID()) == skipFamily {
			if models := p.Models(); len(models) > 0 {
				return p, models[0], nil
			}
		}
	}
	return nil, "", fmt.Errorf("no fallback provider available for family %q", skipFamily)
}

// providerFamily returns "anthropic", "openai", or the raw ID.
func providerFamily(providerID string) string {
	if strings.Contains(providerID, "anthropic") {
		return "anthropic"
	}
	if strings.Contains(providerID, "openai") || strings.Contains(providerID, "codex") {
		return "openai"
	}
	return providerID
}

// isAuthError checks if an error is an authentication/authorization failure.
func isAuthError(err error) bool {
	msg := err.Error()
	return strings.Contains(msg, "auth:") ||
		strings.Contains(msg, "401") ||
		strings.Contains(msg, "403") ||
		strings.Contains(msg, "refresh failed") ||
		strings.Contains(msg, "invalid_grant")
}

func (r *Runner) streamCall(ctx context.Context, p provider.Provider, req *provider.Request, emitter *stream.Emitter) (*provider.Response, error) {
	req.Stream = true
	ch, err := p.Stream(ctx, req)
	if err != nil {
		return nil, err
	}

	var fullContent string
	var toolCalls []provider.ToolCall
	var finalResp *provider.Response

	for event := range ch {
		switch event.Type {
		case "text_delta":
			fullContent += event.Text
			emitter.Emit(stream.Event{Type: "text", Data: map[string]any{"text": event.Text}})
		case "tool_call_start", "tool_call_delta", "tool_call_done":
			if event.ToolCall != nil {
				toolCalls = append(toolCalls, *event.ToolCall)
			}
		case "done":
			finalResp = event.Response
		case "error":
			return nil, fmt.Errorf("stream error: %s", event.Error)
		}
	}

	if finalResp != nil {
		if finalResp.Content == "" && fullContent != "" {
			finalResp.Content = fullContent
		}
		if len(finalResp.ToolCalls) == 0 && len(toolCalls) > 0 {
			finalResp.ToolCalls = toolCalls
		}
		if len(finalResp.ToolCalls) > 0 && (finalResp.StopReason == "" || finalResp.StopReason == "end_turn") {
			finalResp.StopReason = "tool_use"
		}
		return finalResp, nil
	}

	return &provider.Response{
		Content:   fullContent,
		ToolCalls: toolCalls,
		StopReason: func() string {
			if len(toolCalls) > 0 {
				return "tool_use"
			}
			return "end_turn"
		}(),
	}, nil
}

// ListProviders returns info about all registered providers.
// Returns models as {id, label} objects to match frontend AIProvider type.
func (r *Runner) ListProviders() []map[string]any {
	r.providersMu.RLock()
	defer r.providersMu.RUnlock()

	result := make([]map[string]any, 0, len(r.providers))
	for _, p := range r.providers {
		// Use rich metadata if the provider supplies it
		var models []map[string]any
		if mp, ok := p.(provider.ModelMetaProvider); ok {
			meta := mp.ModelsMeta()
			models = make([]map[string]any, len(meta))
			for i, m := range meta {
				models[i] = map[string]any{
					"id":           m.ID,
					"label":        m.Label,
					"capabilities": m.Capabilities,
				}
			}
		} else {
			modelIDs := p.Models()
			models = make([]map[string]any, len(modelIDs))
			for i, m := range modelIDs {
				models[i] = map[string]any{"id": m, "label": m}
			}
		}
		result = append(result, map[string]any{
			"id":     p.ID(),
			"label":  p.ID(),
			"models": models,
		})
	}
	return result
}

// AddProvider registers a new provider at runtime (e.g. after OAuth).
func (r *Runner) AddProvider(p provider.Provider) {
	r.providersMu.Lock()
	defer r.providersMu.Unlock()
	r.providers[p.ID()] = p
}

// RemoveProvider unregisters a provider by ID (e.g. on OAuth logout).
func (r *Runner) RemoveProvider(id string) {
	r.providersMu.Lock()
	defer r.providersMu.Unlock()
	delete(r.providers, id)
}
