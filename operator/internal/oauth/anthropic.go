package oauth

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Ported from pi-mono: packages/ai/src/utils/oauth/anthropic.ts

const (
	anthropicClientIDEncoded = "OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl"
	anthropicAuthorizeURL    = "https://claude.ai/oauth/authorize"
	anthropicTokenURL        = "https://platform.claude.com/v1/oauth/token"
	anthropicCallbackHost    = "127.0.0.1"
	anthropicCallbackPort    = 53692
	anthropicCallbackPath    = "/callback"
	anthropicScopes          = "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload"
)

var anthropicClientID string

func init() {
	decoded, _ := base64.StdEncoding.DecodeString(anthropicClientIDEncoded)
	anthropicClientID = string(decoded)
}

func anthropicRedirectURI() string {
	return fmt.Sprintf("http://localhost:%d%s", anthropicCallbackPort, anthropicCallbackPath)
}

// AnthropicProvider implements Anthropic OAuth (Claude Pro/Max).
type AnthropicProvider struct{}

func (p *AnthropicProvider) ID() string                  { return "anthropic" }
func (p *AnthropicProvider) Name() string                { return "Anthropic (Claude Pro/Max)" }
func (p *AnthropicProvider) UsesCallbackServer() bool    { return true }
func (p *AnthropicProvider) GetAPIKey(c *Credentials) string { return c.Access }

func (p *AnthropicProvider) Login(callbacks LoginCallbacks) (*Credentials, error) {
	return loginAnthropic(callbacks)
}

func (p *AnthropicProvider) RefreshToken(creds *Credentials) (*Credentials, error) {
	return refreshAnthropicToken(creds.Refresh)
}

func loginAnthropic(callbacks LoginCallbacks) (*Credentials, error) {
	verifier, challenge, err := GeneratePKCE()
	if err != nil {
		return nil, fmt.Errorf("generate PKCE: %w", err)
	}

	// Start local callback server
	codeCh := make(chan string, 1)
	errCh := make(chan error, 1)
	server, err := startAnthropicCallbackServer(verifier, codeCh, errCh)
	if err != nil {
		return nil, fmt.Errorf("start callback server: %w", err)
	}
	defer server.Close()

	// Build authorization URL
	params := url.Values{
		"code":                  {"true"},
		"client_id":            {anthropicClientID},
		"response_type":        {"code"},
		"redirect_uri":         {anthropicRedirectURI()},
		"scope":                {anthropicScopes},
		"code_challenge":       {challenge},
		"code_challenge_method": {"S256"},
		"state":                {verifier},
	}
	authURL := anthropicAuthorizeURL + "?" + params.Encode()

	callbacks.OnAuth(AuthInfo{
		URL:          authURL,
		Instructions: "Complete login in your browser. If the browser is on another machine, paste the final redirect URL here.",
	})

	// Wait for callback or manual input
	var code string
	if callbacks.OnManualCodeInput != nil {
		// Race between callback server and manual input
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
			// Browser callback won
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

	if callbacks.OnProgress != nil {
		callbacks.OnProgress("Exchanging authorization code for tokens...")
	}

	return exchangeAnthropicCode(code, verifier, anthropicRedirectURI())
}

func exchangeAnthropicCode(code, verifier, redirectURI string) (*Credentials, error) {
	body := map[string]string{
		"grant_type":    "authorization_code",
		"client_id":     anthropicClientID,
		"code":          code,
		"state":         verifier,
		"redirect_uri":  redirectURI,
		"code_verifier": verifier,
	}
	jsonBody, _ := json.Marshal(body)

	resp, err := http.Post(anthropicTokenURL, "application/json", strings.NewReader(string(jsonBody)))
	if err != nil {
		return nil, fmt.Errorf("token exchange request: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("token exchange failed (%d): %s", resp.StatusCode, string(respBody))
	}

	var tokenData struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int64  `json:"expires_in"`
	}
	if err := json.Unmarshal(respBody, &tokenData); err != nil {
		return nil, fmt.Errorf("parse token response: %w", err)
	}

	return &Credentials{
		Refresh: tokenData.RefreshToken,
		Access:  tokenData.AccessToken,
		Expires: timeNowMs() + tokenData.ExpiresIn*1000 - 5*60*1000,
	}, nil
}

func refreshAnthropicToken(refreshToken string) (*Credentials, error) {
	body := map[string]string{
		"grant_type":    "refresh_token",
		"client_id":     anthropicClientID,
		"refresh_token": refreshToken,
	}
	jsonBody, _ := json.Marshal(body)

	resp, err := http.Post(anthropicTokenURL, "application/json", strings.NewReader(string(jsonBody)))
	if err != nil {
		return nil, fmt.Errorf("refresh request: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("refresh failed (%d): %s", resp.StatusCode, string(respBody))
	}

	var tokenData struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int64  `json:"expires_in"`
	}
	if err := json.Unmarshal(respBody, &tokenData); err != nil {
		return nil, fmt.Errorf("parse refresh response: %w", err)
	}

	return &Credentials{
		Refresh: tokenData.RefreshToken,
		Access:  tokenData.AccessToken,
		Expires: timeNowMs() + tokenData.ExpiresIn*1000 - 5*60*1000,
	}, nil
}

func startAnthropicCallbackServer(expectedState string, codeCh chan<- string, errCh chan<- error) (*http.Server, error) {
	mux := http.NewServeMux()
	mux.HandleFunc(anthropicCallbackPath, func(w http.ResponseWriter, r *http.Request) {
		code := r.URL.Query().Get("code")
		state := r.URL.Query().Get("state")
		errParam := r.URL.Query().Get("error")

		if errParam != "" {
			w.WriteHeader(400)
			fmt.Fprintf(w, "<html><body><h1>Error</h1><p>%s</p></body></html>", errParam)
			return
		}

		if code == "" || state == "" {
			w.WriteHeader(400)
			fmt.Fprint(w, "<html><body><h1>Error</h1><p>Missing code or state</p></body></html>")
			return
		}

		if state != expectedState {
			w.WriteHeader(400)
			fmt.Fprint(w, "<html><body><h1>Error</h1><p>State mismatch</p></body></html>")
			return
		}

		w.WriteHeader(200)
		fmt.Fprint(w, "<html><body><h1>Success</h1><p>Authentication complete. You can close this window.</p></body></html>")
		codeCh <- code
	})

	server := &http.Server{
		Addr:    fmt.Sprintf("%s:%d", anthropicCallbackHost, anthropicCallbackPort),
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

func parseAuthorizationCode(input string) string {
	input = strings.TrimSpace(input)
	if input == "" {
		return ""
	}

	// Try as URL
	if u, err := url.Parse(input); err == nil && u.Query().Get("code") != "" {
		return u.Query().Get("code")
	}

	// Try code#state format
	if strings.Contains(input, "#") {
		parts := strings.SplitN(input, "#", 2)
		return parts[0]
	}

	// Try code=xxx format
	if strings.Contains(input, "code=") {
		values, _ := url.ParseQuery(input)
		return values.Get("code")
	}

	// Assume raw code
	return input
}

