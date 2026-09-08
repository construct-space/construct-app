// Org-scoped memory client — the shared half of the "grows with you" loop.
// Unlike user/project memory (local files), org memory lives in source-api
// (GET/PUT /api/org/memory) and is shared across the org's members. The org
// is resolved server-side from the caller's token, so no org id is needed
// here. Reads are cached briefly so injection isn't a per-turn network call.
package tool

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

const defaultOrgSourceURL = "https://my.construct.space/api/source"

// OrgMemoryClient talks to source-api for one user's org memory.
type OrgMemoryClient struct {
	SourceURL string
	Token     string
}

func NewOrgMemoryClient(sourceURL, token string) *OrgMemoryClient {
	if sourceURL == "" {
		sourceURL = defaultOrgSourceURL
	}
	return &OrgMemoryClient{SourceURL: strings.TrimRight(sourceURL, "/"), Token: token}
}

// ── brief read cache so prompt injection doesn't hit source every turn ──
type orgCacheEntry struct {
	content string
	at      time.Time
}

var (
	orgCacheMu sync.Mutex
	orgCache   = map[string]orgCacheEntry{}
)

const orgCacheTTL = 2 * time.Minute

func (c *OrgMemoryClient) do(ctx context.Context, method, body string) (string, int, error) {
	var rdr io.Reader
	if body != "" {
		rdr = bytes.NewReader([]byte(body))
	}
	req, err := http.NewRequestWithContext(ctx, method, c.SourceURL+"/org/memory", rdr)
	if err != nil {
		return "", 0, err
	}
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return "", 0, err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	return string(b), resp.StatusCode, nil
}

// Get returns the org's shared memory content (fresh; bypasses cache).
// Returns ("", nil) when the user isn't in an org (404).
func (c *OrgMemoryClient) Get(ctx context.Context) (string, error) {
	body, code, err := c.do(ctx, "GET", "")
	if err != nil {
		return "", err
	}
	if code == 404 {
		return "", nil // not in an org
	}
	if code != 200 {
		return "", fmt.Errorf("org memory: HTTP %d", code)
	}
	var resp struct {
		Content string `json:"content"`
	}
	_ = json.Unmarshal([]byte(body), &resp)
	c.cacheSet(resp.Content)
	return resp.Content, nil
}

// Set overwrites the org's shared memory and invalidates the cache.
func (c *OrgMemoryClient) Set(ctx context.Context, content string) error {
	payload, _ := json.Marshal(map[string]string{"content": content})
	_, code, err := c.do(ctx, "PUT", string(payload))
	if err != nil {
		return err
	}
	if code == 404 {
		return fmt.Errorf("not in an organization")
	}
	if code != 200 {
		return fmt.Errorf("org memory: HTTP %d", code)
	}
	c.cacheSet(content)
	return nil
}

func (c *OrgMemoryClient) cacheSet(content string) {
	orgCacheMu.Lock()
	orgCache[c.Token] = orgCacheEntry{content: content, at: time.Now()}
	orgCacheMu.Unlock()
}

// cachedGet returns the cached org memory if fresh, else fetches.
func (c *OrgMemoryClient) cachedGet(ctx context.Context) string {
	orgCacheMu.Lock()
	e, ok := orgCache[c.Token]
	orgCacheMu.Unlock()
	if ok && time.Since(e.at) < orgCacheTTL {
		return e.content
	}
	content, err := c.Get(ctx)
	if err != nil {
		// On error, fall back to stale cache (if any) rather than nothing.
		if ok {
			return e.content
		}
		return ""
	}
	return content
}

// Block returns the org memory snapshot for system-prompt injection, or "".
func (c *OrgMemoryClient) Block(ctx context.Context) string {
	content := strings.TrimSpace(c.cachedGet(ctx))
	if content == "" {
		return ""
	}
	return "## Your organization (shared)\n" + content + "\n"
}
