// OpenRouter provider — fetches available models dynamically from the
// OpenRouter /api/v1/models endpoint and exposes only free-tier models
// that support tool calling.
// Inference uses the standard OpenAI-compatible chat completions API.
package connectors

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"

	"construct-operator/internal/provider"
)

const openRouterBaseURL = "https://openrouter.ai/api/v1"

// NewOpenRouter creates an OpenRouter provider that dynamically discovers
// free models. It makes a single HTTP call to /api/v1/models at construction
// time; if that call fails, the provider is still usable but starts with an
// empty model list that can be refreshed later via RefreshModels().
func NewOpenRouter(apiKey string) *OpenRouterProvider {
	p := &OpenRouterProvider{
		apiKey: apiKey,
		compat: NewOpenAICompat(OpenAICompatConfig{
			Name:    "OpenRouter",
			Key:     "openrouter",
			BaseURL: openRouterBaseURL,
			APIKey:  apiKey,
			Models:  nil, // populated by fetchFreeModels
		}),
	}
	// Best-effort fetch at construction — don't block forever.
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if meta, err := p.fetchFreeModels(ctx); err == nil && len(meta) > 0 {
		ids := make([]string, len(meta))
		for i, m := range meta {
			ids[i] = m.ID
		}
		p.compat.config.Models = ids
		p.meta = meta
	}
	return p
}

type OpenRouterProvider struct {
	apiKey string
	compat *OpenAICompatProvider
	meta   []provider.ModelMeta
}

func (p *OpenRouterProvider) ID() string       { return "openrouter" }
func (p *OpenRouterProvider) Models() []string { return p.compat.Models() }

// ModelsMeta implements ModelMetaProvider — returns per-model capabilities.
func (p *OpenRouterProvider) ModelsMeta() []provider.ModelMeta { return p.meta }

func (p *OpenRouterProvider) Complete(ctx context.Context, req *provider.Request) (*provider.Response, error) {
	return p.compat.Complete(ctx, req)
}

func (p *OpenRouterProvider) Stream(ctx context.Context, req *provider.Request) (<-chan provider.StreamEvent, error) {
	return p.compat.Stream(ctx, req)
}

// RefreshModels re-fetches the model list from OpenRouter.
func (p *OpenRouterProvider) RefreshModels() error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	meta, err := p.fetchFreeModels(ctx)
	if err != nil {
		return err
	}
	ids := make([]string, len(meta))
	for i, m := range meta {
		ids[i] = m.ID
	}
	p.compat.config.Models = ids
	p.meta = meta
	return nil
}

// openRouterModel is the subset of the /api/v1/models response we care about.
type openRouterModel struct {
	ID                  string   `json:"id"`
	Name                string   `json:"name"`
	SupportedParameters []string `json:"supported_parameters"`
	Architecture        struct {
		InputModalities []string `json:"input_modalities"`
	} `json:"architecture"`
	Pricing struct {
		Prompt     string `json:"prompt"`
		Completion string `json:"completion"`
	} `json:"pricing"`
}

func (p *OpenRouterProvider) fetchFreeModels(ctx context.Context) ([]provider.ModelMeta, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", openRouterBaseURL+"/models", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+p.apiKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("openrouter /models returned %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		Data []openRouterModel `json:"data"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("openrouter /models parse error: %w", err)
	}

	var models []provider.ModelMeta
	for _, m := range result.Data {
		if !isFreeModel(m) {
			continue
		}
		models = append(models, provider.ModelMeta{
			ID:           m.ID,
			Label:        m.Name,
			Capabilities: extractCapabilities(m),
		})
	}

	sort.Slice(models, func(i, j int) bool { return models[i].ID < models[j].ID })
	return models, nil
}

// extractCapabilities derives capability tags from the OpenRouter model metadata.
func extractCapabilities(m openRouterModel) []string {
	var caps []string
	for _, p := range m.SupportedParameters {
		switch p {
		case "tools":
			caps = append(caps, "tools")
		case "reasoning":
			caps = append(caps, "reasoning")
		case "structured_outputs":
			caps = append(caps, "structured")
		}
	}
	for _, mod := range m.Architecture.InputModalities {
		if mod == "image" {
			caps = append(caps, "vision")
			break
		}
	}
	return caps
}

// isFreeModel returns true when both prompt and completion pricing are zero.
func isFreeModel(m openRouterModel) bool {
	return isZeroPrice(m.Pricing.Prompt) && isZeroPrice(m.Pricing.Completion)
}

// isZeroPrice treats "", "0", and "0.0…" as free.
func isZeroPrice(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" || s == "0" {
		return true
	}
	// Handle "0.00", "0.000000" etc.
	s = strings.TrimLeft(s, "0")
	if s == "" || s == "." {
		return true
	}
	s = strings.TrimLeft(s, ".")
	s = strings.TrimLeft(s, "0")
	return s == ""
}
