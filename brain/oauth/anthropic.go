// Package oauth handles brain's outbound OAuth refresh flows. v0 supports
// Anthropic (Claude Pro / Max). Refresh tokens come from the desktop app's
// providers/auth.json — brain reads, never writes. Access tokens stay
// in-memory; we re-refresh on brain restart rather than persist credentials.
package oauth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"
)

const (
	anthropicAuthorizeURL = "https://claude.ai/oauth/authorize"
	anthropicTokenURL     = "https://platform.claude.com/v1/oauth/token"
	anthropicCallbackHost = "127.0.0.1"
	anthropicCallbackPort = 53692
	anthropicCallbackPath = "/callback"
	anthropicScopes       = "user:profile user:inference"

	// Public client ID for the Construct desktop app's Anthropic OAuth
	// integration. Base64-encoded to avoid casual scraping; not a secret
	// (it's the public half of an OAuth public client). Shared with the
	// operator binary so brain and operator are interchangeable to
	// Anthropic from a sign-in perspective.
	anthropicClientIDEncoded = "OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl"
)

func anthropicRedirectURI() string {
	return fmt.Sprintf("http://localhost:%d%s", anthropicCallbackPort, anthropicCallbackPath)
}

// AnthropicLogin runs the full OAuth login flow:
//   - generates a PKCE verifier+challenge
//   - boots a local callback server on 127.0.0.1:53692
//   - opens the user's browser to the authorize URL
//   - waits for the redirect (or cancel)
//   - exchanges the code for {access, refresh, expires}
//
// onAuthURL is invoked once the URL is ready (handler can log it / forward
// to the UI). cancelCh aborts the wait.
func AnthropicLogin(ctx context.Context, onAuthURL func(string), cancelCh <-chan struct{}) (*Credentials, error) {
	verifier, challenge, err := generatePKCE()
	if err != nil {
		return nil, fmt.Errorf("generate PKCE: %w", err)
	}

	codeCh := make(chan string, 1)
	errCh := make(chan error, 1)
	server, err := startAnthropicCallbackServer(verifier, codeCh, errCh)
	if err != nil {
		return nil, fmt.Errorf("start callback server: %w", err)
	}
	defer func() {
		// Force-close even on success — the server only handles one code.
		_ = server.Close()
	}()

	q := url.Values{}
	q.Set("code", "true")
	q.Set("client_id", anthropicClientID())
	q.Set("response_type", "code")
	q.Set("redirect_uri", anthropicRedirectURI())
	q.Set("scope", anthropicScopes)
	q.Set("code_challenge", challenge)
	q.Set("code_challenge_method", "S256")
	q.Set("state", verifier)
	authURL := anthropicAuthorizeURL + "?" + q.Encode()
	if onAuthURL != nil {
		onAuthURL(authURL)
	}
	openExternalURL(authURL)

	select {
	case code := <-codeCh:
		return exchangeAnthropicCode(ctx, code, verifier, anthropicRedirectURI())
	case err := <-errCh:
		return nil, err
	case <-cancelCh:
		return nil, fmt.Errorf("cancelled")
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// Credentials is the result of a successful login. Mirrors what
// providers/auth.json stores under each provider's "credentials" field.
type Credentials struct {
	Refresh string `json:"refresh"`
	Access  string `json:"access"`
	Expires int64  `json:"expires"` // unix ms
}

func generatePKCE() (verifier, challenge string, err error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", "", err
	}
	verifier = base64.RawURLEncoding.EncodeToString(buf)
	hash := sha256.Sum256([]byte(verifier))
	challenge = base64.RawURLEncoding.EncodeToString(hash[:])
	return verifier, challenge, nil
}

func startAnthropicCallbackServer(expectedState string, codeCh chan<- string, errCh chan<- error) (*http.Server, error) {
	mux := http.NewServeMux()
	mux.HandleFunc(anthropicCallbackPath, func(w http.ResponseWriter, r *http.Request) {
		code := r.URL.Query().Get("code")
		state := r.URL.Query().Get("state")
		errParam := r.URL.Query().Get("error")

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if errParam != "" {
			w.WriteHeader(400)
			fmt.Fprint(w, CallbackErrorHTML("Claude", errParam))
			return
		}
		if code == "" || state == "" {
			w.WriteHeader(400)
			fmt.Fprint(w, CallbackErrorHTML("Claude", "Missing authorization code or state."))
			return
		}
		if state != expectedState {
			w.WriteHeader(400)
			fmt.Fprint(w, CallbackErrorHTML("Claude", "State mismatch. Close any other Claude login tabs and retry."))
			return
		}
		w.WriteHeader(200)
		fmt.Fprint(w, CallbackSuccessHTML("Claude"))
		codeCh <- code
	})

	server := &http.Server{
		Addr:    fmt.Sprintf("%s:%d", anthropicCallbackHost, anthropicCallbackPort),
		Handler: mux,
	}
	ln, err := net.Listen("tcp", server.Addr)
	if err != nil {
		return nil, fmt.Errorf("listen %s: %w", server.Addr, err)
	}
	go func() {
		if err := server.Serve(ln); err != nil && err != http.ErrServerClosed {
			errCh <- err
		}
	}()
	return server, nil
}

func exchangeAnthropicCode(ctx context.Context, code, verifier, redirectURI string) (*Credentials, error) {
	body, _ := json.Marshal(map[string]string{
		"grant_type":    "authorization_code",
		"client_id":     anthropicClientID(),
		"code":          code,
		"state":         verifier,
		"redirect_uri":  redirectURI,
		"code_verifier": verifier,
	})
	req, err := http.NewRequestWithContext(ctx, "POST", anthropicTokenURL, strings.NewReader(string(body)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("token exchange: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("token exchange HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
	}
	var tok struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int64  `json:"expires_in"`
	}
	if err := json.Unmarshal(respBody, &tok); err != nil {
		return nil, fmt.Errorf("parse token response: %w", err)
	}
	return &Credentials{
		Refresh: tok.RefreshToken,
		Access:  tok.AccessToken,
		Expires: time.Now().UnixMilli() + tok.ExpiresIn*1000 - 5*60*1000,
	}, nil
}

func anthropicClientID() string {
	b, _ := base64.StdEncoding.DecodeString(anthropicClientIDEncoded)
	return string(b)
}

func openExternalURL(target string) {
	switch runtime.GOOS {
	case "darwin":
		_ = exec.Command("open", target).Start()
	case "linux":
		_ = exec.Command("xdg-open", target).Start()
	case "windows":
		_ = exec.Command("rundll32", "url.dll,FileProtocolHandler", target).Start()
	}
}

func htmlEscape(s string) string {
	r := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&#39;")
	return r.Replace(s)
}

// ErrReauthRequired is returned by token sources when the on-disk refresh
// token is permanently invalid (consumed, expired, revoked). Callers
// (wire handlers) should surface this to the frontend as a "Reconnect
// Claude" prompt rather than a generic error.
var ErrReauthRequired = fmt.Errorf("oauth: re-login required")

// AnthropicTokenSource exchanges a long-lived refresh token for short-lived
// access tokens. Thread-safe; caches the access token until ~5 minutes
// before expiry then re-refreshes.
//
// Anthropic rotates the refresh token on every successful refresh call,
// so the in-memory value drifts away from disk after the first refresh.
// OnRotate persists the new refresh back to providers/auth.json — its
// error is propagated so a failed write surfaces as a refresh failure
// instead of silently leaving disk + memory out of sync.
//
// OnReload re-reads the on-disk refresh token; used to recover from
// `invalid_grant` when a peer (desktop app re-login, another brain
// process) rotated the token while this source held a stale copy.
type AnthropicTokenSource struct {
	refresh  string
	OnRotate func(creds *Credentials) error
	OnReload func() (string, error)

	mu      sync.Mutex
	access  string
	expires time.Time
}

func NewAnthropicTokenSource(refresh string) *AnthropicTokenSource {
	return &AnthropicTokenSource{refresh: refresh}
}

// Token returns a fresh access token, refreshing if the cached one is
// missing or near expiry. On invalid_grant, attempts one recovery by
// reloading the refresh token from disk (in case a peer rotated it).
func (s *AnthropicTokenSource) Token(ctx context.Context) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.access != "" && time.Until(s.expires) > 30*time.Second {
		return s.access, nil
	}
	if s.refresh == "" {
		return "", ErrReauthRequired
	}

	access, err := s.refreshOnce(ctx, s.refresh)
	if err == nil {
		return access, nil
	}

	// On invalid_grant, try once more with whatever's currently on disk.
	// Covers the case where the desktop app or another brain process
	// rotated the token while this source held a stale in-memory copy.
	if isInvalidGrant(err) && s.OnReload != nil {
		diskRefresh, reloadErr := s.OnReload()
		if reloadErr == nil && diskRefresh != "" && diskRefresh != s.refresh {
			s.refresh = diskRefresh
			access, retryErr := s.refreshOnce(ctx, diskRefresh)
			if retryErr == nil {
				return access, nil
			}
			if isInvalidGrant(retryErr) {
				return "", ErrReauthRequired
			}
			return "", retryErr
		}
		// Disk had no fresher token — the user must reconnect.
		return "", ErrReauthRequired
	}
	return "", err
}

// refreshOnce performs a single refresh exchange. Caller holds s.mu.
// On success, updates s.access/s.refresh/s.expires and runs OnRotate;
// returns OnRotate's error if persistence fails (so the caller knows
// disk + memory disagree and can avoid trusting the new in-memory creds).
func (s *AnthropicTokenSource) refreshOnce(ctx context.Context, refresh string) (string, error) {
	body, _ := json.Marshal(map[string]string{
		"grant_type":    "refresh_token",
		"client_id":     anthropicClientID(),
		"refresh_token": refresh,
	})
	req, err := http.NewRequestWithContext(ctx, "POST", anthropicTokenURL, strings.NewReader(string(body)))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("anthropic oauth refresh: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("anthropic oauth refresh: HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody)))
	}

	var out struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int64  `json:"expires_in"`
	}
	if err := json.Unmarshal(respBody, &out); err != nil {
		return "", fmt.Errorf("anthropic oauth refresh: parse: %w", err)
	}
	if out.AccessToken == "" {
		return "", fmt.Errorf("anthropic oauth refresh: empty access token")
	}

	newRefresh := refresh
	rotated := out.RefreshToken != "" && out.RefreshToken != refresh
	if out.RefreshToken != "" {
		newRefresh = out.RefreshToken
	}
	expires := time.Now().Add(time.Duration(out.ExpiresIn) * time.Second)

	// Persist BEFORE updating in-memory state so a write failure can't
	// strand the new refresh token in memory while disk keeps the stale
	// one — the next restart would refresh against the stale value and
	// 400 forever.
	if rotated && s.OnRotate != nil {
		if err := s.OnRotate(&Credentials{
			Refresh: newRefresh,
			Access:  out.AccessToken,
			Expires: expires.UnixMilli(),
		}); err != nil {
			return "", fmt.Errorf("anthropic oauth refresh: persist: %w", err)
		}
	}
	s.access = out.AccessToken
	s.refresh = newRefresh
	s.expires = expires
	return out.AccessToken, nil
}

// isInvalidGrant reports whether the error came from a 400 response
// whose body included the OAuth `invalid_grant` code. Anthropic +
// OpenAI both use the standard OAuth error shape so this works for
// either provider.
func isInvalidGrant(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "HTTP 400") && strings.Contains(msg, "invalid_grant")
}
