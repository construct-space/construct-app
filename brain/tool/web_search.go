package tool

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"
)

// WebSearch returns search-result snippets for a query. Hits DuckDuckGo's
// HTML-lite endpoint by default (no API key, public). Override with
// BRAIN_SEARCH_URL — brain POSTs `q=<query>` and parses anchors with
// `result__a` class, so any compatible endpoint works.
//
// Results are list-shaped: `1. <title>\n   <url>\n   <snippet>`. Capped
// at 10 entries.
type WebSearch struct{}

func (WebSearch) Name() string { return "web_search" }

func (WebSearch) Description() string {
	return "Search the web. Returns up to 10 results with title, URL, and snippet. Use this when you need current information not in the training data. Follow up with web_fetch on promising URLs."
}

func (WebSearch) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"query": map[string]any{
				"type":        "string",
				"description": "Search query.",
			},
			"limit": map[string]any{
				"type":        "integer",
				"description": "Max results (default 10, cap 20).",
			},
		},
		"required": []string{"query"},
	}
}

var webSearchClient = &http.Client{Timeout: 20 * time.Second}

func (WebSearch) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		Query string `json:"query"`
		Limit int    `json:"limit"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fmt.Errorf("invalid input: %w", err)
	}
	if strings.TrimSpace(in.Query) == "" {
		return "", fmt.Errorf("query is required")
	}
	if in.Limit <= 0 || in.Limit > 20 {
		in.Limit = 10
	}

	endpoint := getenv("BRAIN_SEARCH_URL", "https://html.duckduckgo.com/html/")
	form := url.Values{"q": {in.Query}}
	req, err := http.NewRequestWithContext(ctx, "POST", endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36")

	resp, err := webSearchClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 500<<10))
	if err != nil {
		return "", err
	}

	results := parseDDG(string(body), in.Limit)
	if len(results) == 0 {
		return "no results", nil
	}
	var b strings.Builder
	for i, r := range results {
		fmt.Fprintf(&b, "%d. %s\n   %s\n", i+1, r.Title, r.URL)
		if r.Snippet != "" {
			fmt.Fprintf(&b, "   %s\n", r.Snippet)
		}
	}
	return b.String(), nil
}

type searchResult struct {
	Title, URL, Snippet string
}

// DuckDuckGo HTML lite layout:
//
//	<a class="result__a" href="<url>">title text</a>
//	...
//	<a class="result__snippet" ...>snippet text</a>
var (
	reDDGTitle   = regexp.MustCompile(`(?is)<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>(.+?)</a>`)
	reDDGSnippet = regexp.MustCompile(`(?is)<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>(.+?)</a>`)
)

func parseDDG(body string, limit int) []searchResult {
	titles := reDDGTitle.FindAllStringSubmatch(body, -1)
	snippets := reDDGSnippet.FindAllStringSubmatch(body, -1)
	out := make([]searchResult, 0, len(titles))
	for i, m := range titles {
		if i >= limit {
			break
		}
		r := searchResult{
			URL:   decodeDDGRedirect(m[1]),
			Title: strings.TrimSpace(stripTags(m[2])),
		}
		if i < len(snippets) {
			r.Snippet = strings.TrimSpace(stripTags(snippets[i][1]))
		}
		out = append(out, r)
	}
	return out
}

// decodeDDGRedirect unwraps DuckDuckGo's /l/?uddg=<encoded-url> redirect.
func decodeDDGRedirect(u string) string {
	if !strings.Contains(u, "uddg=") {
		if strings.HasPrefix(u, "//") {
			return "https:" + u
		}
		return u
	}
	if idx := strings.Index(u, "uddg="); idx >= 0 {
		tail := u[idx+len("uddg="):]
		if amp := strings.Index(tail, "&"); amp >= 0 {
			tail = tail[:amp]
		}
		if dec, err := url.QueryUnescape(tail); err == nil {
			return dec
		}
	}
	return u
}

var reAnyTag = regexp.MustCompile(`<[^>]+>`)

func stripTags(s string) string {
	s = reAnyTag.ReplaceAllString(s, "")
	repl := strings.NewReplacer("&nbsp;", " ", "&amp;", "&", "&lt;", "<", "&gt;", ">", "&quot;", `"`, "&#39;", "'")
	return repl.Replace(s)
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
