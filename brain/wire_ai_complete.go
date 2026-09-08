// One-shot LLM completion. Used by space actions that call useBrain()
// (or useBrain().chat()) — they need a single round-trip with no tools,
// no agent loop, no session persistence. The tier hint is honoured: for
// the Construct gateway it routes the Source-family chain; for BYOK
// providers the caller already resolved tier → model id client-side.
//
// Permission gating lives in the frontend (the host validates the
// space's manifest permission catalog + per-action grant before sending
// the request here). Brain treats this endpoint as a model-call primitive.

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/construct-space/brain/catalog"
	"github.com/construct-space/brain/identity"
	"github.com/construct-space/brain/oauth"
	"github.com/construct-space/brain/provider"
	"github.com/construct-space/brain/sidecar"
	"github.com/construct-space/brain/state"
	"github.com/construct-space/brain/wire"
)

type aiCompleteDeps struct {
	Reg              *catalog.Registry
	AnthropicOAuth   provider.TokenSource
	OpenAICodexOAuth *codexAuth
	OrgKeys          *provider.OrgKeyStore
	StateStore       *state.Store
	IdLoader         *identity.Loader
	OauthStore       *oauth.Storage // unused today; reserved
}

type aiCompleteMessage struct {
	Role    string `json:"role"`    // "user" | "assistant" | "system"
	Content string `json:"content"` // plain text only — multimodal lives on prompt path
}

type aiCompletePayload struct {
	Provider    string              `json:"provider"`              // e.g. "anthropic", "construct"
	Model       string              `json:"model"`                 // resolved model id
	Tier        string              `json:"tier,omitempty"`        // "small" | "medium" | "large"
	System      string              `json:"system,omitempty"`      // optional system prompt
	Prompt      string              `json:"prompt,omitempty"`      // shortcut for single-user-turn
	Messages    []aiCompleteMessage `json:"messages,omitempty"`    // OR full chat shape
	MaxTokens   int                 `json:"max_tokens,omitempty"`  // 0 → provider default
	Temperature *float64            `json:"temperature,omitempty"` // pointer so 0.0 is honoured
}

type aiCompleteResult struct {
	Text         string `json:"text"`
	Tier         string `json:"tier"`
	Provider     string `json:"provider"`
	Model        string `json:"model"`
	InputTokens  int    `json:"input_tokens,omitempty"`
	OutputTokens int    `json:"output_tokens,omitempty"`
	ElapsedMs    int64  `json:"elapsed_ms"`
	FinishReason string `json:"finish_reason"`
}

func registerAICompleteHandler(s *sidecar.Server, deps aiCompleteDeps) {
	s.Handle("ai.complete", func(ctx context.Context, req wire.Request, emit func(wire.Response)) {
		var pl aiCompletePayload
		if err := json.Unmarshal(req.Payload, &pl); err != nil {
			emit(wire.Response{ID: req.ID, Success: false, Error: "invalid payload: " + err.Error(), Done: true})
			return
		}

		if strings.TrimSpace(pl.Provider) == "" {
			emit(wire.Response{ID: req.ID, Success: false, Error: "provider is required", Done: true})
			return
		}
		if strings.TrimSpace(pl.Model) == "" {
			emit(wire.Response{ID: req.ID, Success: false, Error: "model is required", Done: true})
			return
		}
		// Peel a composite "provider:model" id — SDK/headless callers pass
		// the picker's composite shape here, and forwarding it verbatim
		// 404s upstream (this handler pre-dates wire_prompt's choke-point
		// peel). Only strip an exactly-matching provider prefix so ids
		// like OpenRouter's "openai/gpt-oss-20b:free" stay intact.
		if prefix := strings.ToLower(strings.TrimSpace(pl.Provider)) + ":"; strings.HasPrefix(strings.ToLower(pl.Model), prefix) {
			pl.Model = pl.Model[len(prefix):]
		}

		messages, err := buildAICompleteMessages(pl)
		if err != nil {
			emit(wire.Response{ID: req.ID, Success: false, Error: err.Error(), Done: true})
			return
		}

		prov, err := buildProvider(pl.Provider, deps.AnthropicOAuth, deps.OpenAICodexOAuth, deps.OrgKeys, deps.Reg, deps.StateStore, deps.IdLoader)
		if err != nil {
			emit(wire.Response{ID: req.ID, Success: false, Error: "provider build: " + err.Error(), Done: true})
			return
		}

		var capFlags []string
		if resolved, ok := deps.Reg.Lookup(pl.Provider, pl.Model); ok {
			capFlags = resolved.Caps.Flags
		}

		maxTokens := pl.MaxTokens
		if maxTokens <= 0 {
			maxTokens = 1024
		}

		preq := provider.Request{
			Model:       pl.Model,
			System:      pl.System,
			Messages:    messages,
			MaxTokens:   maxTokens,
			CapFlags:    capFlags,
			Tier:        normalizeTier(pl.Tier),
			Temperature: pl.Temperature,
		}

		start := time.Now()
		var (
			textBuf      strings.Builder
			finalUsage   provider.Usage
			finishReason string
		)
		err = prov.Stream(ctx, preq, func(ev provider.Event) {
			switch ev.Type {
			case "text_delta":
				textBuf.WriteString(ev.TextDelta)
			case "usage":
				finalUsage = ev.Usage
			case "stop":
				if ev.StopReason != "" {
					finishReason = ev.StopReason
				}
			}
		})
		elapsed := time.Since(start)

		if err != nil {
			emit(wire.Response{ID: req.ID, Success: false, Error: "stream: " + err.Error(), Done: true})
			return
		}
		if finishReason == "" {
			finishReason = "stop"
		}

		result := aiCompleteResult{
			Text:         textBuf.String(),
			Tier:         normalizeTier(pl.Tier),
			Provider:     pl.Provider,
			Model:        pl.Model,
			InputTokens:  finalUsage.InputTokens,
			OutputTokens: finalUsage.OutputTokens,
			ElapsedMs:    elapsed.Milliseconds(),
			FinishReason: finishReason,
		}
		emit(wire.Response{ID: req.ID, Success: true, Data: result, Done: true})
	})
}

// buildAICompleteMessages accepts either pl.Prompt (single user turn) or
// pl.Messages (full chat) and returns provider.Message values. System
// content moves to pl.System; messages with role "system" are coalesced
// into the system prompt because most providers reject inline system
// turns.
func buildAICompleteMessages(pl aiCompletePayload) ([]provider.Message, error) {
	usingShortcut := strings.TrimSpace(pl.Prompt) != ""
	usingMessages := len(pl.Messages) > 0
	if !usingShortcut && !usingMessages {
		return nil, fmt.Errorf("either prompt or messages is required")
	}
	if usingShortcut && usingMessages {
		return nil, fmt.Errorf("set prompt OR messages, not both")
	}

	if usingShortcut {
		return []provider.Message{{
			Role:    "user",
			Content: []provider.Block{{Type: "text", Text: pl.Prompt}},
		}}, nil
	}

	out := make([]provider.Message, 0, len(pl.Messages))
	for _, m := range pl.Messages {
		role := strings.ToLower(strings.TrimSpace(m.Role))
		switch role {
		case "system":
			// Coalesce into the top-level System prompt.
			if pl.System != "" {
				pl.System += "\n\n"
			}
			// NB: we mutate a local copy. Caller doesn't observe.
			pl.System += m.Content
		case "user", "assistant":
			out = append(out, provider.Message{
				Role:    role,
				Content: []provider.Block{{Type: "text", Text: m.Content}},
			})
		default:
			return nil, fmt.Errorf("unknown message role: %q", m.Role)
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("messages must include at least one user or assistant turn")
	}
	if out[len(out)-1].Role != "user" {
		return nil, fmt.Errorf("last message must be role:'user'")
	}
	return out, nil
}

// normalizeTier maps anything that's not a recognised tier to "medium".
// Unknown / empty → medium so the gateway has a default to dispatch.
func normalizeTier(t string) string {
	switch strings.ToLower(strings.TrimSpace(t)) {
	case "small", "medium", "large":
		return strings.ToLower(strings.TrimSpace(t))
	}
	return "medium"
}
