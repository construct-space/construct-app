package oauth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Ported from operator/internal/oauth/openai_codex.go which itself is
// ported from pi-mono's openai-codex.ts. Same client ID, endpoints, scopes
// so brain and operator are interchangeable to OpenAI from sign-in.

const (
	openaiCodexClientID     = "app_EMoamEEZ73f0CkXaXp7hrann"
	openaiCodexAuthorizeURL = "https://auth.openai.com/oauth/authorize"
	openaiCodexTokenURL     = "https://auth.openai.com/oauth/token"
	openaiCodexRedirectURI  = "http://localhost:1455/auth/callback"
	openaiCodexScope        = "openid profile email offline_access"
	openaiCodexJWTClaimPath = "https://api.openai.com/auth"
)

// OpenAICodexLogin runs the ChatGPT Plus/Pro OAuth flow:
//
//	PKCE → callback server on :1455 → authorize URL → exchange for tokens.
//
// Extra carries {accountId, email} parsed from the JWT so the UI can label
// the connection.
func OpenAICodexLogin(ctx context.Context, onAuthURL func(string), cancelCh <-chan struct{}) (*Credentials, error) {
	verifier, challenge, err := generatePKCE()
	if err != nil {
		return nil, fmt.Errorf("generate PKCE: %w", err)
	}
	state, err := makeOpenAIState()
	if err != nil {
		return nil, fmt.Errorf("create state: %w", err)
	}

	codeCh := make(chan string, 1)
	errCh := make(chan error, 1)
	server, err := startOpenAICodexCallbackServer(state, codeCh, errCh)
	if err != nil {
		return nil, fmt.Errorf("start callback server: %w", err)
	}
	defer server.Close()

	params := url.Values{
		"response_type":              {"code"},
		"client_id":                  {openaiCodexClientID},
		"redirect_uri":               {openaiCodexRedirectURI},
		"scope":                      {openaiCodexScope},
		"code_challenge":             {challenge},
		"code_challenge_method":      {"S256"},
		"state":                      {state},
		"id_token_add_organizations": {"true"},
		"codex_cli_simplified_flow":  {"true"},
		"originator":                 {"construct"},
	}
	authURL := openaiCodexAuthorizeURL + "?" + params.Encode()
	if onAuthURL != nil {
		onAuthURL(authURL)
	}
	openExternalURL(authURL)

	select {
	case code := <-codeCh:
		return exchangeOpenAICodexCode(ctx, code, verifier)
	case err := <-errCh:
		return nil, err
	case <-cancelCh:
		return nil, fmt.Errorf("cancelled")
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-time.After(5 * time.Minute):
		return nil, fmt.Errorf("login timed out")
	}
}

func makeOpenAIState() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func startOpenAICodexCallbackServer(expectedState string, codeCh chan<- string, errCh chan<- error) (*http.Server, error) {
	mux := http.NewServeMux()
	mux.HandleFunc("/auth/callback", func(w http.ResponseWriter, r *http.Request) {
		state := r.URL.Query().Get("state")
		code := r.URL.Query().Get("code")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if state != expectedState {
			w.WriteHeader(400)
			fmt.Fprint(w, CallbackErrorHTML("OpenAI", "State mismatch. Close extra Codex login tabs and retry."))
			return
		}
		if code == "" {
			w.WriteHeader(400)
			fmt.Fprint(w, CallbackErrorHTML("OpenAI", "Missing authorization code — consent was probably cancelled."))
			return
		}
		w.WriteHeader(200)
		fmt.Fprint(w, CallbackSuccessHTML("OpenAI"))
		codeCh <- code
	})
	server := &http.Server{Addr: "127.0.0.1:1455", Handler: mux}
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

func exchangeOpenAICodexCode(ctx context.Context, code, verifier string) (*Credentials, error) {
	form := url.Values{
		"grant_type":    {"authorization_code"},
		"client_id":     {openaiCodexClientID},
		"code":          {code},
		"code_verifier": {verifier},
		"redirect_uri":  {openaiCodexRedirectURI},
	}
	req, err := http.NewRequestWithContext(ctx, "POST", openaiCodexTokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("token exchange: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("token exchange HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var tok struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int64  `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &tok); err != nil {
		return nil, fmt.Errorf("parse token response: %w", err)
	}
	if tok.AccessToken == "" || tok.RefreshToken == "" {
		return nil, fmt.Errorf("token response missing fields")
	}
	return &Credentials{
		Refresh: tok.RefreshToken,
		Access:  tok.AccessToken,
		Expires: time.Now().UnixMilli() + tok.ExpiresIn*1000,
	}, nil
}

// decodeJWTPayload + extractOpenAICodexIdentity are kept for future use
// (UI labels with email/accountId). Not wired into the login path yet —
// we keep the credential structurally identical to anthropic's so the
// storage layer doesn't grow per-provider branches.
func decodeJWTPayload(token string) map[string]any {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil
	}
	var decoded map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		return nil
	}
	return decoded
}

// OpenAICodexTokenSource exchanges the long-lived ChatGPT refresh token
// for short-lived access tokens. Same shape as AnthropicTokenSource;
// OpenAI rotates the refresh token on every refresh call so we persist
// the new value (OnRotate) and recover from `invalid_grant` by re-reading
// disk (OnReload) in case a peer rotated the token first.
type OpenAICodexTokenSource struct {
	refresh  string
	OnRotate func(creds *Credentials) error
	OnReload func() (string, error)

	mu      sync.Mutex
	access  string
	expires time.Time
}

func NewOpenAICodexTokenSource(refresh string) *OpenAICodexTokenSource {
	return &OpenAICodexTokenSource{refresh: refresh}
}

func (s *OpenAICodexTokenSource) Token(ctx context.Context) (string, error) {
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
		return "", ErrReauthRequired
	}
	return "", err
}

// refreshOnce performs a single refresh exchange. Caller holds s.mu.
func (s *OpenAICodexTokenSource) refreshOnce(ctx context.Context, refresh string) (string, error) {
	form := url.Values{
		"grant_type":    {"refresh_token"},
		"client_id":     {openaiCodexClientID},
		"refresh_token": {refresh},
		"scope":         {openaiCodexScope},
	}
	req, err := http.NewRequestWithContext(ctx, "POST", openaiCodexTokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("openai-codex oauth refresh: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("openai-codex oauth refresh: HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var out struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int64  `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return "", fmt.Errorf("openai-codex oauth refresh: parse: %w", err)
	}
	if out.AccessToken == "" {
		return "", fmt.Errorf("openai-codex oauth refresh: empty access token")
	}

	newRefresh := refresh
	rotated := out.RefreshToken != "" && out.RefreshToken != refresh
	if out.RefreshToken != "" {
		newRefresh = out.RefreshToken
	}
	expires := time.Now().Add(time.Duration(out.ExpiresIn) * time.Second)

	// Persist BEFORE in-memory update: a write failure must surface as
	// refresh failure so memory + disk stay consistent.
	if rotated && s.OnRotate != nil {
		if err := s.OnRotate(&Credentials{
			Refresh: newRefresh,
			Access:  out.AccessToken,
			Expires: expires.UnixMilli(),
		}); err != nil {
			return "", fmt.Errorf("openai-codex oauth refresh: persist: %w", err)
		}
	}
	s.access = out.AccessToken
	s.refresh = newRefresh
	s.expires = expires
	return out.AccessToken, nil
}

// ExtractOpenAICodexIdentity decodes accountId + email from a Codex access
// token. Exported so the wire handler can stamp them into the stored
// credential's Extra map after a successful exchange.
func ExtractOpenAICodexIdentity(accessToken string) (accountID, email string) {
	payload := decodeJWTPayload(accessToken)
	if payload == nil {
		return "", ""
	}
	if claim, ok := payload[openaiCodexJWTClaimPath].(map[string]any); ok {
		if v, _ := claim["chatgpt_account_id"].(string); strings.TrimSpace(v) != "" {
			accountID = v
		}
		if v, _ := claim["email"].(string); strings.TrimSpace(v) != "" {
			email = v
		}
	}
	if email == "" {
		if v, _ := payload["email"].(string); strings.TrimSpace(v) != "" {
			email = v
		}
	}
	if email == "" {
		if v, _ := payload["preferred_username"].(string); strings.TrimSpace(v) != "" {
			email = v
		}
	}
	return
}
