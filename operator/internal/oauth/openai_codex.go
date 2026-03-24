package oauth

import (
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
	"time"
)

// Ported from pi-mono: packages/ai/src/utils/oauth/openai-codex.ts

const (
	openaiCodexClientID     = "app_EMoamEEZ73f0CkXaXp7hrann"
	openaiCodexAuthorizeURL = "https://auth.openai.com/oauth/authorize"
	openaiCodexTokenURL     = "https://auth.openai.com/oauth/token"
	openaiCodexRedirectURI  = "http://localhost:1455/auth/callback"
	openaiCodexScope        = "openid profile email offline_access"
	openaiCodexJWTClaimPath = "https://api.openai.com/auth"
)

// OpenAICodexProvider implements OpenAI Codex OAuth (ChatGPT Plus/Pro).
type OpenAICodexProvider struct{}

func (p *OpenAICodexProvider) ID() string                      { return "openai-codex" }
func (p *OpenAICodexProvider) Name() string                    { return "ChatGPT Plus/Pro (Codex)" }
func (p *OpenAICodexProvider) UsesCallbackServer() bool        { return true }
func (p *OpenAICodexProvider) GetAPIKey(c *Credentials) string { return c.Access }

func (p *OpenAICodexProvider) Login(callbacks LoginCallbacks) (*Credentials, error) {
	return loginOpenAICodex(callbacks)
}

func (p *OpenAICodexProvider) RefreshToken(creds *Credentials) (*Credentials, error) {
	refreshed, err := refreshOpenAICodexToken(creds.Refresh)
	if err != nil {
		return nil, err
	}
	if refreshed.Extra == nil {
		refreshed.Extra = map[string]any{}
	}
	if existingAccountID, _ := creds.Extra["accountId"].(string); existingAccountID != "" {
		if refreshed.Extra["accountId"] == nil {
			refreshed.Extra["accountId"] = existingAccountID
		}
	}
	if existingEmail, _ := creds.Extra["email"].(string); existingEmail != "" {
		if refreshed.Extra["email"] == nil {
			refreshed.Extra["email"] = existingEmail
		}
	}
	return refreshed, nil
}

func createState() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func loginOpenAICodex(callbacks LoginCallbacks) (*Credentials, error) {
	verifier, challenge, err := GeneratePKCE()
	if err != nil {
		return nil, fmt.Errorf("generate PKCE: %w", err)
	}

	state, err := createState()
	if err != nil {
		return nil, fmt.Errorf("create state: %w", err)
	}

	// Start local callback server
	codeCh := make(chan string, 1)
	errCh := make(chan error, 1)
	server, err := startOpenAICallbackServer(state, codeCh, errCh)
	if err != nil {
		return nil, fmt.Errorf("start callback server: %w", err)
	}
	defer server.Close()

	// Build authorization URL
	authURL := buildOpenAIAuthURL(challenge, state)

	callbacks.OnAuth(AuthInfo{
		URL:          authURL,
		Instructions: "A browser window should open. Complete login to finish.",
	})

	// Wait for callback or manual input
	var code string
	if callbacks.OnManualCodeInput != nil {
		manualCh := make(chan string, 1)
		manualErrCh := make(chan error, 1)
		go func() {
			input, err := callbacks.OnManualCodeInput()
			if err != nil {
				manualErrCh <- err
			} else {
				manualCh <- input
			}
		}()

		select {
		case code = <-codeCh:
		case input := <-manualCh:
			code = parseAuthorizationCode(input)
		case err := <-manualErrCh:
			return nil, err
		case err := <-errCh:
			return nil, err
		}
	} else {
		select {
		case code = <-codeCh:
		case err := <-errCh:
			return nil, err
		case <-time.After(5 * time.Minute):
			return nil, fmt.Errorf("login timed out")
		}
	}

	if code == "" {
		return nil, fmt.Errorf("missing authorization code")
	}

	return exchangeOpenAICode(code, verifier)
}

func buildOpenAIAuthURL(challenge, state string) string {
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
	return openaiCodexAuthorizeURL + "?" + params.Encode()
}

func exchangeOpenAICode(code, verifier string) (*Credentials, error) {
	data := url.Values{
		"grant_type":    {"authorization_code"},
		"client_id":     {openaiCodexClientID},
		"code":          {code},
		"code_verifier": {verifier},
		"redirect_uri":  {openaiCodexRedirectURI},
	}

	resp, err := http.PostForm(openaiCodexTokenURL, data)
	if err != nil {
		return nil, fmt.Errorf("token exchange: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("token exchange failed (%d): %s", resp.StatusCode, string(body))
	}

	var tokenData struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int64  `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &tokenData); err != nil {
		return nil, fmt.Errorf("parse token response: %w", err)
	}

	if tokenData.AccessToken == "" || tokenData.RefreshToken == "" {
		return nil, fmt.Errorf("token response missing fields")
	}

	accountID, email := extractOpenAICodexIdentity(tokenData.AccessToken)
	extra := map[string]any{}
	if accountID != "" {
		extra["accountId"] = accountID
	}
	if email != "" {
		extra["email"] = email
	}

	return &Credentials{
		Refresh: tokenData.RefreshToken,
		Access:  tokenData.AccessToken,
		Expires: timeNowMs() + tokenData.ExpiresIn*1000,
		Extra:   extra,
	}, nil
}

func refreshOpenAICodexToken(refreshToken string) (*Credentials, error) {
	data := url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {refreshToken},
		"client_id":     {openaiCodexClientID},
	}

	resp, err := http.PostForm(openaiCodexTokenURL, data)
	if err != nil {
		return nil, fmt.Errorf("refresh request: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("refresh failed (%d): %s", resp.StatusCode, string(body))
	}

	var tokenData struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int64  `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &tokenData); err != nil {
		return nil, fmt.Errorf("parse refresh response: %w", err)
	}

	if tokenData.AccessToken == "" || tokenData.RefreshToken == "" {
		return nil, fmt.Errorf("refresh response missing fields")
	}

	accountID, email := extractOpenAICodexIdentity(tokenData.AccessToken)
	extra := map[string]any{}
	if accountID != "" {
		extra["accountId"] = accountID
	}
	if email != "" {
		extra["email"] = email
	}

	return &Credentials{
		Refresh: tokenData.RefreshToken,
		Access:  tokenData.AccessToken,
		Expires: timeNowMs() + tokenData.ExpiresIn*1000,
		Extra:   extra,
	}, nil
}

func extractOpenAICodexIdentity(accessToken string) (accountID string, email string) {
	payload := decodeJWTPayload(accessToken)
	if payload == nil {
		return "", ""
	}

	if claim, ok := payload[openaiCodexJWTClaimPath].(map[string]any); ok {
		if value, _ := claim["chatgpt_account_id"].(string); strings.TrimSpace(value) != "" {
			accountID = value
		}
		if value, _ := claim["email"].(string); strings.TrimSpace(value) != "" {
			email = value
		}
	}
	if email == "" {
		if value, _ := payload["email"].(string); strings.TrimSpace(value) != "" {
			email = value
		}
	}
	if email == "" {
		if value, _ := payload["preferred_username"].(string); strings.TrimSpace(value) != "" {
			email = value
		}
	}

	return accountID, email
}

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

func startOpenAICallbackServer(expectedState string, codeCh chan<- string, errCh chan<- error) (*http.Server, error) {
	mux := http.NewServeMux()
	mux.HandleFunc("/auth/callback", func(w http.ResponseWriter, r *http.Request) {
		state := r.URL.Query().Get("state")
		code := r.URL.Query().Get("code")

		if state != expectedState {
			w.WriteHeader(400)
			fmt.Fprint(w, "<html><body><h1>Error</h1><p>State mismatch</p></body></html>")
			return
		}
		if code == "" {
			w.WriteHeader(400)
			fmt.Fprint(w, "<html><body><h1>Error</h1><p>Missing code</p></body></html>")
			return
		}

		w.WriteHeader(200)
		fmt.Fprint(w, CallbackSuccessHTML("OpenAI"))
		codeCh <- code
	})

	server := &http.Server{
		Addr:    "127.0.0.1:1455",
		Handler: mux,
	}

	ln, err := net.Listen("tcp", server.Addr)
	if err != nil {
		return nil, fmt.Errorf("listen on %s: %w", server.Addr, err)
	}

	go func() {
		if err := server.Serve(ln); err != nil && err != http.ErrServerClosed {
			errCh <- err
		}
	}()

	return server, nil
}
