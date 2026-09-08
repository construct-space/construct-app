package provider

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// OrgKeyStore fetches and caches org-supplied provider API keys from
// source.construct.space. The frontend's "ORG KEY" badge in Settings →
// LLMs reflects what's here — when an org admin configures DeepSeek
// (or any other provider) for the whole org, every member's brain reads
// the key from source instead of needing a local env var.
//
// Cache: in-memory only, refreshed at boot + every refreshInterval. Keys
// never persist to disk (source treats them as bearer-protected).
type OrgKeyStore struct {
	sourceURL string
	authToken string
	http      *http.Client

	mu     sync.RWMutex
	keys   map[string]OrgKey
	loaded bool
}

type OrgKey struct {
	APIKey   string
	Enforced bool // when true, prefer this over user/env keys
}

const defaultOrgSourceURL = "https://my.construct.space/api/source"

func NewOrgKeyStore(sourceURL, authToken string) *OrgKeyStore {
	if sourceURL == "" {
		sourceURL = defaultOrgSourceURL
	}
	return &OrgKeyStore{
		sourceURL: strings.TrimRight(sourceURL, "/"),
		authToken: authToken,
		http:      &http.Client{Timeout: 5 * time.Second},
		keys:      map[string]OrgKey{},
	}
}

// Refresh re-fetches the org's provider key list. Safe to call on a
// timer or after a provider settings change. Returns nil on every
// failure path so a flaky network doesn't take down brain.
func (s *OrgKeyStore) Refresh(ctx context.Context) error {
	if s == nil || s.authToken == "" {
		return nil
	}
	// First confirm the user is in an org — /org returns 200 only when
	// the bearer's session has an active org membership.
	if !s.userInOrg(ctx) {
		s.mu.Lock()
		s.keys = map[string]OrgKey{}
		s.loaded = true
		s.mu.Unlock()
		return nil
	}

	list, err := s.fetchProviderList(ctx)
	if err != nil {
		return err
	}
	out := make(map[string]OrgKey, len(list))
	for _, p := range list {
		key, enforced, err := s.fetchKey(ctx, p.Provider)
		if err != nil || key == "" {
			continue
		}
		out[strings.ToLower(p.Provider)] = OrgKey{
			APIKey:   key,
			Enforced: enforced || p.Enforced,
		}
	}
	s.mu.Lock()
	s.keys = out
	s.loaded = true
	s.mu.Unlock()
	return nil
}

// Get returns the org key for a provider slug, if any. Slug match is
// case-insensitive and tolerates "anthropic"/"claude" duality.
func (s *OrgKeyStore) Get(slug string) (OrgKey, bool) {
	if s == nil {
		return OrgKey{}, false
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if k, ok := s.keys[strings.ToLower(slug)]; ok {
		return k, true
	}
	return OrgKey{}, false
}

// StartRefresher kicks off a background ticker that re-fetches every
// interval. Returns a stop fn the caller should defer.
func (s *OrgKeyStore) StartRefresher(ctx context.Context, interval time.Duration) func() {
	if interval <= 0 {
		interval = 5 * time.Minute
	}
	stop := make(chan struct{})
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ctx.Done():
				return
			case <-t.C:
				_ = s.Refresh(ctx)
			}
		}
	}()
	return func() { close(stop) }
}

// userInOrg returns true when GET /org succeeds. Source returns 404 or
// 401 for non-org users; we treat anything non-200 as "no org".
func (s *OrgKeyStore) userInOrg(ctx context.Context) bool {
	req, err := http.NewRequestWithContext(ctx, "GET", s.sourceURL+"/org", nil)
	if err != nil {
		return false
	}
	req.Header.Set("Authorization", "Bearer "+s.authToken)
	resp, err := s.http.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == 200
}

func (s *OrgKeyStore) fetchProviderList(ctx context.Context) ([]orgProviderRow, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", s.sourceURL+"/org/providers", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+s.authToken)
	resp, err := s.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("org-keys list: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("org-keys list: HTTP %d", resp.StatusCode)
	}
	body, _ := io.ReadAll(resp.Body)
	var rows []orgProviderRow
	if err := json.Unmarshal(body, &rows); err != nil {
		return nil, fmt.Errorf("org-keys parse: %w", err)
	}
	return rows, nil
}

type orgProviderRow struct {
	Provider string `json:"provider"`
	Enforced bool   `json:"enforced"`
}

func (s *OrgKeyStore) fetchKey(ctx context.Context, provider string) (string, bool, error) {
	url := fmt.Sprintf("%s/org/providers/%s/key", s.sourceURL, provider)
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return "", false, err
	}
	req.Header.Set("Authorization", "Bearer "+s.authToken)
	resp, err := s.http.Do(req)
	if err != nil {
		return "", false, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return "", false, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	var data struct {
		APIKey   string `json:"api_key"`
		Enforced bool   `json:"enforced"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return "", false, err
	}
	return data.APIKey, data.Enforced, nil
}
