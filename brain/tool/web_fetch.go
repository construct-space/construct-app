package tool

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

// WebFetch retrieves a URL and returns either the raw body (for JSON /
// plain text) or a stripped-text rendering for HTML pages. Capped to
// 200 KB so a runaway page doesn't blow the context budget.
type WebFetch struct{}

func (WebFetch) Name() string { return "web_fetch" }

func (WebFetch) Description() string {
	return "Fetch a URL over HTTP(S). HTML pages are stripped to plain text (no tags, scripts, or styles). JSON and text responses are returned verbatim. 200KB cap; only http/https schemes; 20s timeout."
}

func (WebFetch) InputSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"url": map[string]any{
				"type":        "string",
				"description": "Full URL including scheme. Only http and https are allowed.",
			},
			"raw": map[string]any{
				"type":        "boolean",
				"description": "Return body verbatim even if HTML (default false).",
			},
		},
		"required": []string{"url"},
	}
}

var webFetchClient = &http.Client{Timeout: 20 * time.Second}

func (WebFetch) Execute(ctx context.Context, raw json.RawMessage) (string, error) {
	var in struct {
		URL string `json:"url"`
		Raw bool   `json:"raw"`
	}
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fmt.Errorf("invalid input: %w", err)
	}
	if in.URL == "" {
		return "", fmt.Errorf("url is required")
	}
	if !strings.HasPrefix(in.URL, "http://") && !strings.HasPrefix(in.URL, "https://") {
		return "", fmt.Errorf("only http(s) URLs allowed")
	}

	req, err := http.NewRequestWithContext(ctx, "GET", in.URL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "construct-brain/0.0.1 (+https://construct.space)")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")

	resp, err := webFetchClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 200<<10))
	if err != nil {
		return "", err
	}
	ct := resp.Header.Get("Content-Type")
	header := fmt.Sprintf("HTTP %d %s\n%s\n\n", resp.StatusCode, in.URL, ct)
	text := string(body)
	if !in.Raw && strings.Contains(ct, "html") {
		text = stripHTML(text)
	}
	return header + text, nil
}

var (
	reScriptStyle = regexp.MustCompile(`(?is)<(script|style)[^>]*>.*?</(script|style)>`)
	reTag         = regexp.MustCompile(`(?s)<[^>]+>`)
	reWhitespace  = regexp.MustCompile(`[ \t]+`)
	reBlankLines  = regexp.MustCompile(`\n{3,}`)
)

// stripHTML drops scripts/styles, replaces tags with whitespace, decodes
// the common entities. Good enough for "let me see what's on this page";
// not a full DOM parser — that'd pull a dep we don't need.
func stripHTML(s string) string {
	s = reScriptStyle.ReplaceAllString(s, " ")
	s = reTag.ReplaceAllString(s, " ")
	repl := strings.NewReplacer(
		"&nbsp;", " ", "&amp;", "&", "&lt;", "<", "&gt;", ">",
		"&quot;", `"`, "&#39;", "'", "&apos;", "'",
	)
	s = repl.Replace(s)
	s = reWhitespace.ReplaceAllString(s, " ")
	// Compress runs of blank lines.
	var b strings.Builder
	for _, line := range strings.Split(s, "\n") {
		b.WriteString(strings.TrimSpace(line))
		b.WriteByte('\n')
	}
	return reBlankLines.ReplaceAllString(b.String(), "\n\n")
}
