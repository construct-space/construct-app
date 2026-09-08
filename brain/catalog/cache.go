package catalog

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// cacheLayout is brain's on-disk catalog cache.
//
//	<stateDir>/catalog.json   — last good catalog (raw server body)
//	<stateDir>/catalog.etag   — "v2 " + ETag string, no quotes
//
// catalog.json holds the raw bytes the server sent, NOT a re-marshal of
// the parsed struct. Re-marshalling was lossy: any field the running
// brain's ModelEntry didn't know (e.g. tier_hint before 1.3.0) was
// silently stripped from the cache while the matching ETag was kept —
// so after upgrading to a brain that DID know the field, Refresh got
// 304 and served the stripped snapshot forever.
//
// The etag file carries a format-version prefix ("v2 "). Caches written
// by pre-1.3.0 brains have a bare etag → treated as no-etag → the next
// Refresh fetches fresh (one-time self-heal on upgrade).
const etagFormatPrefix = "v2 "

type cacheLayout struct {
	stateDir string
}

func (c cacheLayout) jsonPath() string { return filepath.Join(c.stateDir, "catalog.json") }
func (c cacheLayout) etagPath() string { return filepath.Join(c.stateDir, "catalog.etag") }

// loadCache returns the cached catalog + ETag if both files exist and the
// JSON parses. Anything else is a miss; we re-fetch. An etag file without
// the current format prefix yields an empty etag so the stale lossy cache
// is replaced on the next refresh instead of being 304-pinned.
func (c cacheLayout) load() (*Catalog, string, error) {
	body, err := os.ReadFile(c.jsonPath())
	if err != nil {
		return nil, "", err
	}
	var cat Catalog
	if err := json.Unmarshal(body, &cat); err != nil {
		return nil, "", err
	}
	rawEtag, _ := os.ReadFile(c.etagPath()) // missing etag is fine
	etag := ""
	if s := string(rawEtag); strings.HasPrefix(s, etagFormatPrefix) {
		etag = strings.TrimPrefix(s, etagFormatPrefix)
	}
	return &cat, etag, nil
}

// save writes the raw catalog body + ETag atomically (write-tmp, rename).
func (c cacheLayout) save(raw []byte, etag string) error {
	if err := os.MkdirAll(c.stateDir, 0o755); err != nil {
		return err
	}
	if err := atomicWrite(c.jsonPath(), raw); err != nil {
		return err
	}
	return atomicWrite(c.etagPath(), []byte(etagFormatPrefix+etag))
}

func atomicWrite(path string, body []byte) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, body, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
