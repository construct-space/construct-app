// provider.list-live-models — proxy /models against the user's configured
// local-runtime base URL so the Settings UI can render the live model
// list returned by Ollama / LM Studio / any OpenAI-compatible server.
//
// Today only the local connectors are implemented (lmstudio, ollama).
// Remote connectors (OpenAI, Anthropic, etc.) need their stored API key
// or OAuth token threaded in; that lands when the provider auth surface
// catches up with the rest of brain.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/construct-space/brain/sidecar"
	"github.com/construct-space/brain/state"
	"github.com/construct-space/brain/wire"
)

type liveModelsDeps struct {
	State *state.Store
	HTTP  *http.Client
}

func registerLiveModelsHandler(s *sidecar.Server, deps liveModelsDeps) {
	if deps.HTTP == nil {
		deps.HTTP = &http.Client{Timeout: 5 * time.Second}
	}
	s.Handle("provider.list-live-models", func(_ context.Context, req wire.Request, emit func(wire.Response)) {
		var pl struct {
			ConnectorID string `json:"connector_id"`
			ID          string `json:"id"` // tolerated alias
		}
		_ = json.Unmarshal(req.Payload, &pl)
		id := strings.TrimSpace(pl.ConnectorID)
		if id == "" {
			id = strings.TrimSpace(pl.ID)
		}
		if id == "" {
			emit(wire.Response{ID: req.ID, Success: false, Error: "connector_id is required", Done: true})
			return
		}

		baseURL, defaultURL := resolveLocalBaseURL(deps.State, id)
		if baseURL == "" {
			// Connector isn't a local runtime — nothing brain can probe
			// without provider credentials yet. Return an empty list with
			// a hint instead of a hard error so the UI renders the empty
			// state cleanly rather than the "is X running?" banner.
			emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{
				"models": []any{},
				"source": "unsupported",
				"hint":   fmt.Sprintf("brain has no live /models probe for %q yet", id),
			}, Done: true})
			return
		}
		if !card.isLikelyURL(baseURL) {
			baseURL = defaultURL
		}

		models, err := fetchOpenAIModels(deps.HTTP, baseURL)
		if err != nil {
			emit(wire.Response{ID: req.ID, Success: false, Error: err.Error(), Done: true})
			return
		}
		emit(wire.Response{ID: req.ID, Success: true, Data: map[string]any{
			"models": models,
			"source": "live",
		}, Done: true})
	})
}

// resolveLocalBaseURL returns (user-configured-or-default, default).
// Returns ("", "") if the connector isn't a known local runtime.
func resolveLocalBaseURL(store *state.Store, id string) (string, string) {
	var defaultURL string
	switch id {
	case "lmstudio", "lm-studio":
		defaultURL = "http://localhost:1234/v1"
	case "ollama":
		defaultURL = "http://localhost:11434/v1"
	default:
		return "", ""
	}
	if store != nil {
		if raw, ok := store.KVGet("provider_url:" + id); ok {
			var url string
			if json.Unmarshal(raw, &url) == nil {
				url = strings.TrimSpace(url)
				if url != "" {
					return url, defaultURL
				}
			}
		}
	}
	return defaultURL, defaultURL
}

type liveModel struct {
	ID    string `json:"id"`
	Label string `json:"label,omitempty"`
}

func fetchOpenAIModels(client *http.Client, baseURL string) ([]liveModel, error) {
	url := strings.TrimRight(baseURL, "/") + "/models"
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		// Surface a frontend-friendly message rather than the raw
		// connection-refused string — the LocalCard wraps the error
		// into a banner the user can act on.
		return nil, fmt.Errorf("local runtime unreachable at %s (%w)", baseURL, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("local runtime returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var parsed struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, fmt.Errorf("parse /models response: %w", err)
	}
	out := make([]liveModel, 0, len(parsed.Data))
	for _, m := range parsed.Data {
		out = append(out, liveModel{ID: m.ID, Label: m.ID})
	}
	return out, nil
}

// card is a tiny namespace for url-shape heuristics; keeps the call site
// at the top of this file readable.
var card = struct {
	isLikelyURL func(string) bool
}{
	isLikelyURL: func(s string) bool {
		s = strings.TrimSpace(s)
		return strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://")
	},
}
