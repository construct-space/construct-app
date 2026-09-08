// marketplace_search — public Construct marketplace lookup. Compact
// projection (id, name, description, category, author, version, scopes)
// keeps the tool result small enough that a cheap model can scan all
// hits without burning context on install counts and dates.
package tool

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const marketplaceURL = "https://my.construct.space/api/marketplace/spaces"

type marketplaceRow struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Category    string   `json:"category,omitempty"`
	Author      string   `json:"author,omitempty"`
	Version     string   `json:"version,omitempty"`
	Scopes      []string `json:"scopes,omitempty"`
}

type MarketplaceSearch struct{}

func (MarketplaceSearch) Name() string { return "marketplace_search" }

func (MarketplaceSearch) Description() string {
	return "Search the Construct marketplace for spaces. Use when the user asks 'what spaces are available', 'find me a X space', or you need to confirm a space exists before suggesting an install. Returns a compact list — do NOT call more than once per conversation; cache the result."
}

func (MarketplaceSearch) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"q":        map[string]any{"type": "string", "description": "Free-text search (name + description)"},
			"category": map[string]any{"type": "string"},
			"limit":    map[string]any{"type": "integer", "description": "Default 50, cap 100"},
		},
	}
}

func (MarketplaceSearch) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		Q        string `json:"q"`
		Category string `json:"category"`
		Limit    int    `json:"limit"`
	}
	_ = json.Unmarshal(raw, &in)
	limit := in.Limit
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	qs := url.Values{}
	if strings.TrimSpace(in.Q) != "" {
		qs.Set("q", strings.TrimSpace(in.Q))
	}
	if strings.TrimSpace(in.Category) != "" {
		qs.Set("category", strings.TrimSpace(in.Category))
	}
	qs.Set("limit", fmt.Sprintf("%d", limit))

	reqCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, "GET", marketplaceURL+"?"+qs.Encode(), nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "construct-brain/0.0.1")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("marketplace unreachable: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("marketplace returned %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	// Envelope shape drifts across API versions — accept any of items/spaces/data.
	var env struct {
		Items  []marketplaceRow `json:"items"`
		Spaces []marketplaceRow `json:"spaces"`
		Data   []marketplaceRow `json:"data"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		return "", fmt.Errorf("decode: %w", err)
	}
	rows := env.Items
	if len(rows) == 0 {
		rows = env.Spaces
	}
	if len(rows) == 0 {
		rows = env.Data
	}
	out := struct {
		Total  int              `json:"total"`
		Spaces []marketplaceRow `json:"spaces"`
	}{Total: len(rows), Spaces: rows}
	compact, _ := json.MarshalIndent(out, "", "  ")
	return string(compact), nil
}
