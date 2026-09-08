package catalog

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

const DefaultCatalogURL = "https://my.construct.space/api/source/providers"

// Registry holds the in-memory catalog snapshot. Refresh from network is
// safe to call concurrently with Lookup — internal swap is mutex-guarded.
type Registry struct {
	url   string
	cache cacheLayout
	http  *http.Client

	mu     sync.RWMutex
	snap   *Catalog
	etag   string
	loaded time.Time
}

// New builds a Registry. stateDir is where we persist <stateDir>/catalog.json
// and catalog.etag. Pass "" for url to use DefaultCatalogURL or BRAIN_CATALOG_URL.
func New(stateDir, url string) *Registry {
	if url == "" {
		url = os.Getenv("BRAIN_CATALOG_URL")
	}
	if url == "" {
		url = DefaultCatalogURL
	}
	return &Registry{
		url:   url,
		cache: cacheLayout{stateDir: stateDir},
		http:  &http.Client{Timeout: 15 * time.Second},
	}
}

// Rebind retargets the on-disk cache at a different state directory and
// drops the in-memory snapshot so the next LoadCache/Refresh re-fills it
// from the new profile. Called from profile.switch so the catalog cache
// follows the active profile instead of staying pinned to the boot-time
// path.
func (r *Registry) Rebind(stateDir string) {
	r.mu.Lock()
	r.cache = cacheLayout{stateDir: stateDir}
	r.snap = nil
	r.etag = ""
	r.loaded = time.Time{}
	r.mu.Unlock()
}

// LoadCache populates the in-memory snapshot from disk. Returns no error if
// the cache is empty — brain just starts blind and the first Refresh fills it.
func (r *Registry) LoadCache() error {
	cat, etag, err := r.cache.load()
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	r.mu.Lock()
	r.snap = cat
	r.etag = etag
	r.loaded = time.Now()
	r.mu.Unlock()
	return nil
}

// Refresh hits the catalog endpoint with the current ETag. 304 → no-op.
// 200 → swap snapshot + write cache. Network or parse errors leave the
// snapshot intact (we prefer stale over empty).
func (r *Registry) Refresh(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, "GET", r.url, nil)
	if err != nil {
		return err
	}
	r.mu.RLock()
	currentEtag := r.etag
	r.mu.RUnlock()
	if currentEtag != "" {
		req.Header.Set("If-None-Match", currentEtag)
	}
	resp, err := r.http.Do(req)
	if err != nil {
		return fmt.Errorf("catalog fetch: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotModified {
		return nil
	}
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return fmt.Errorf("catalog HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(b)))
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("catalog read: %w", err)
	}
	var cat Catalog
	if err := json.Unmarshal(body, &cat); err != nil {
		return fmt.Errorf("catalog parse: %w", err)
	}
	etag := strings.Trim(resp.Header.Get("ETag"), `"`)

	r.mu.Lock()
	r.snap = &cat
	r.etag = etag
	r.loaded = time.Now()
	r.mu.Unlock()

	// Persist the raw body, not a re-marshal of the parsed struct — the
	// struct is a lossy view (fields this build doesn't know would be
	// stripped while the ETag stays valid).
	if err := r.cache.save(body, etag); err != nil {
		fmt.Fprintf(os.Stderr, "[catalog] cache save: %v\n", err)
	}
	return nil
}

// StartRefresher fires a refresh ticker. Returns a stop func.
func (r *Registry) StartRefresher(ctx context.Context, interval time.Duration) func() {
	stop := make(chan struct{})
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-stop:
				return
			case <-t.C:
				rctx, cancel := context.WithTimeout(ctx, 15*time.Second)
				if err := r.Refresh(rctx); err != nil {
					fmt.Fprintf(os.Stderr, "[catalog] refresh: %v\n", err)
				}
				cancel()
			}
		}
	}()
	return func() { close(stop) }
}

// Snapshot returns the current in-memory catalog (may be nil before first load).
func (r *Registry) Snapshot() *Catalog {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.snap
}
