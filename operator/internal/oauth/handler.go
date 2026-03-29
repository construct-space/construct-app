package oauth

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"runtime"

	"construct-operator/internal/transport"
)

// handleLogin starts an OAuth login flow for the given provider.
func (m *OAuthModule) handleLogin(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		Provider string `json:"provider"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	if payload.Provider == "" {
		return transport.Response{ID: req.ID, Success: false, Error: "provider is required"}
	}

	prov, ok := m.registry.Get(payload.Provider)
	if !ok {
		return transport.Response{ID: req.ID, Success: false, Error: fmt.Sprintf("unknown OAuth provider: %s", payload.Provider)}
	}

	if payload.Provider == "github-copilot" {
		state, err := StartCopilotDeviceFlow("")
		if err != nil {
			return transport.Response{ID: req.ID, Success: false, Error: fmt.Sprintf("OAuth login failed: %v", err)}
		}
		openExternalURL(state.VerificationURI)
		m.setPendingDeviceFlow(payload.Provider, state)

		fmt.Fprintf(os.Stderr, "[oauth] %s: device flow started, code: %s\n", payload.Provider, state.UserCode)
		return transport.Response{
			ID: req.ID, Success: true,
			Data: map[string]any{
				"provider":    payload.Provider,
				"device_code": true,
				"user_code":   state.UserCode,
				"url":         state.VerificationURI,
			},
		}
	}

	resultCh := make(chan PendingOAuthResult, 1)
	m.setPendingOAuthFlow(payload.Provider, resultCh)

	providerID := payload.Provider
	var authURL string

	go func() {
		creds, err := prov.Login(LoginCallbacks{
			OnAuth: func(info AuthInfo) {
				authURL = info.URL
				openExternalURL(info.URL)
				fmt.Fprintf(os.Stderr, "[oauth] %s: browser opened for login\n", providerID)
				if info.Instructions != "" {
					fmt.Fprintf(os.Stderr, "[oauth] %s: %s\n", providerID, info.Instructions)
				}
			},
			OnPrompt: func(prompt Prompt) (string, error) {
				if prompt.AllowEmpty {
					return "", nil
				}
				return "", fmt.Errorf("interactive prompt %q is not supported in desktop mode yet", prompt.Message)
			},
			OnProgress: func(message string) {
				fmt.Fprintf(os.Stderr, "[oauth] %s: %s\n", providerID, message)
			},
		})
		resultCh <- PendingOAuthResult{Creds: creds, Err: err, URL: authURL}
	}()

	fmt.Fprintf(os.Stderr, "[oauth] %s: login flow started (non-blocking)\n", providerID)
	return transport.Response{
		ID: req.ID, Success: true,
		Data: map[string]any{
			"provider": providerID,
			"pending":  true,
		},
	}
}

// handleDevicePoll polls a pending device code flow (GitHub Copilot).
func (m *OAuthModule) handleDevicePoll(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		Provider string `json:"provider"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}

	state, ok := m.getPendingDeviceFlow(payload.Provider)
	if !ok || state == nil {
		return transport.Response{ID: req.ID, Success: false, Error: "no pending device flow for " + payload.Provider}
	}

	status, creds, err := PollCopilotDeviceFlowOnce(state)
	if status == "pending" {
		return transport.Response{
			ID: req.ID, Success: true,
			Data: map[string]any{"status": "pending"},
		}
	}

	m.clearPendingDeviceFlow(payload.Provider)
	if err != nil {
		return transport.Response{ID: req.ID, Success: false, Error: fmt.Sprintf("OAuth login failed: %v", err)}
	}

	if err := m.storage.SetOAuth(payload.Provider, creds); err != nil {
		fmt.Fprintf(os.Stderr, "[oauth] warning: failed to save credentials: %v\n", err)
	}
	m.providerFuncs.AddOAuthProvider(payload.Provider, creds)

	fmt.Fprintf(os.Stderr, "[oauth] %s: login successful (expires: %d)\n", payload.Provider, creds.Expires)
	return transport.Response{
		ID: req.ID, Success: true,
		Data: map[string]any{
			"provider": payload.Provider,
			"status":   "success",
			"success":  true,
		},
	}
}

// handlePoll polls a pending OAuth login flow.
func (m *OAuthModule) handlePoll(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		Provider string `json:"provider"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}

	ch, ok := m.getPendingOAuthFlow(payload.Provider)
	if !ok || ch == nil {
		return transport.Response{ID: req.ID, Success: false, Error: "no pending OAuth flow for " + payload.Provider}
	}

	select {
	case result := <-ch:
		m.clearPendingOAuthFlow(payload.Provider)

		if result.Err != nil {
			return transport.Response{ID: req.ID, Success: false, Error: fmt.Sprintf("OAuth login failed: %v", result.Err)}
		}

		if err := m.storage.SetOAuth(payload.Provider, result.Creds); err != nil {
			fmt.Fprintf(os.Stderr, "[oauth] warning: failed to save credentials: %v\n", err)
		}
		m.providerFuncs.AddOAuthProvider(payload.Provider, result.Creds)

		fmt.Fprintf(os.Stderr, "[oauth] %s: login successful (expires: %d)\n", payload.Provider, result.Creds.Expires)
		return transport.Response{
			ID: req.ID, Success: true,
			Data: map[string]any{
				"provider": payload.Provider,
				"status":   "success",
				"success":  true,
			},
		}
	default:
		return transport.Response{
			ID: req.ID, Success: true,
			Data: map[string]any{"status": "pending"},
		}
	}
}

// handleGHCheck checks if the user is logged into GitHub via gh CLI.
func (m *OAuthModule) handleGHCheck(_ context.Context, req transport.Request) transport.Response {
	username, token := DetectGitHubCLIAuth()
	return transport.Response{
		ID: req.ID, Success: true,
		Data: map[string]any{
			"logged_in": username != "",
			"username":  username,
			"token":     token,
		},
	}
}

// handleGHUseToken uses a GitHub CLI token to get a Copilot token.
func (m *OAuthModule) handleGHUseToken(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		Token string `json:"token"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	if payload.Token == "" {
		return transport.Response{ID: req.ID, Success: false, Error: "token is required"}
	}
	creds, err := RefreshGitHubCopilotToken(payload.Token, "github.com")
	if err != nil {
		return transport.Response{ID: req.ID, Success: false, Error: fmt.Sprintf("Failed to get Copilot token: %v", err)}
	}
	if err := m.storage.SetOAuth("github-copilot", creds); err != nil {
		fmt.Fprintf(os.Stderr, "[oauth] warning: failed to save credentials: %v\n", err)
	}
	m.providerFuncs.AddOAuthProvider("github-copilot", creds)
	fmt.Fprintf(os.Stderr, "[oauth] github-copilot: connected via gh CLI token\n")
	return transport.Response{
		ID: req.ID, Success: true,
		Data: map[string]any{
			"provider": "github-copilot",
			"success":  true,
		},
	}
}

// handleProviders returns the list of connected OAuth providers.
func (m *OAuthModule) handleProviders(_ context.Context, req transport.Request) transport.Response {
	authData, err := m.storage.Load()
	if err != nil {
		return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
	}
	return transport.Response{
		ID: req.ID, Success: true,
		Data: map[string]any{
			"providers": m.providerFuncs.ConnectedProviderEntries(authData, m.providerFuncs.ListProviders()),
		},
	}
}

// handleLogout disconnects an OAuth provider.
func (m *OAuthModule) handleLogout(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		Provider string `json:"provider"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	if payload.Provider == "" {
		return transport.Response{ID: req.ID, Success: false, Error: "provider is required"}
	}
	if err := m.storage.Delete(payload.Provider); err != nil {
		return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
	}
	if runtimeID := m.providerFuncs.RuntimeProviderID(payload.Provider); runtimeID != "" {
		m.providerFuncs.RemoveProvider(runtimeID)
	}
	return transport.Response{
		ID: req.ID, Success: true,
		Data: map[string]any{"cleared": true},
	}
}

// handleAuthAnthropicStatus checks if the user has Anthropic OAuth credentials.
func (m *OAuthModule) handleAuthAnthropicStatus(_ context.Context, req transport.Request) transport.Response {
	hasOAuth := false
	if authData, err := m.storage.Load(); err == nil {
		if cred := authData["anthropic"]; cred != nil && cred.Type == "oauth" && cred.Credentials != nil {
			hasOAuth = true
		}
	}
	if !hasOAuth {
		for _, p := range m.providerFuncs.ListProviders() {
			if p["id"] == "anthropic-oauth" {
				hasOAuth = true
				break
			}
		}
	}
	return transport.Response{
		ID: req.ID, Success: true,
		Data: map[string]any{"authenticated": hasOAuth},
	}
}

// handleAuthAnthropicStart starts an Anthropic OAuth PKCE flow.
func (m *OAuthModule) handleAuthAnthropicStart(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		ClientID    string `json:"client_id"`
		RedirectURI string `json:"redirect_uri"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	if payload.ClientID == "" {
		payload.ClientID = m.providerFuncs.DefaultClientID
	}
	if payload.RedirectURI == "" {
		payload.RedirectURI = "http://localhost:14293/oauth/callback"
	}

	url, verifier, challenge, err := m.providerFuncs.StartAnthropicOAuthFlow(payload.ClientID, payload.RedirectURI)
	if err != nil {
		return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
	}
	return transport.Response{
		ID: req.ID, Success: true,
		Data: map[string]any{
			"url":       url,
			"state":     verifier,
			"verifier":  verifier,
			"challenge": challenge,
		},
	}
}

// handleAuthAnthropicExchange exchanges an authorization code for Anthropic tokens.
func (m *OAuthModule) handleAuthAnthropicExchange(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		Code         string `json:"code"`
		State        string `json:"state"`
		ClientID     string `json:"client_id"`
		RedirectURI  string `json:"redirect_uri"`
		CodeVerifier string `json:"code_verifier"`
		Verifier     string `json:"verifier"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	if payload.Code == "" {
		return transport.Response{ID: req.ID, Success: false, Error: "code is required"}
	}
	if payload.ClientID == "" {
		payload.ClientID = m.providerFuncs.DefaultClientID
	}
	if payload.RedirectURI == "" {
		payload.RedirectURI = "http://localhost:14293/oauth/callback"
	}
	if payload.CodeVerifier == "" && payload.Verifier != "" {
		payload.CodeVerifier = payload.Verifier
	}

	access, refresh, expiresIn, err := m.providerFuncs.ExchangeAnthropicCode(
		payload.Code, payload.State, payload.ClientID,
		payload.RedirectURI, payload.CodeVerifier,
	)
	if err != nil {
		return transport.Response{ID: req.ID, Success: false, Error: err.Error()}
	}

	m.providerFuncs.RegisterAnthropicOAuth(access, refresh, 0)

	return transport.Response{
		ID: req.ID, Success: true,
		Data: map[string]any{
			"access_token":  access,
			"refresh_token": refresh,
			"expires_in":    expiresIn,
		},
	}
}

// handleAuthAnthropicSetTokens registers Anthropic OAuth tokens from the frontend.
func (m *OAuthModule) handleAuthAnthropicSetTokens(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	if payload.AccessToken == "" {
		return transport.Response{ID: req.ID, Success: false, Error: "access_token is required"}
	}
	m.providerFuncs.RegisterAnthropicOAuth(payload.AccessToken, payload.RefreshToken, payload.ExpiresIn)
	fmt.Fprintf(os.Stderr, "[operator] provider registered: anthropic-oauth (from frontend)\n")
	return transport.Response{
		ID: req.ID, Success: true,
		Data: map[string]any{"authenticated": true},
	}
}

// handleAuthAnthropicClear clears Anthropic OAuth credentials.
func (m *OAuthModule) handleAuthAnthropicClear(_ context.Context, req transport.Request) transport.Response {
	_ = m.storage.Delete("anthropic")
	m.providerFuncs.RemoveProvider("anthropic-oauth")
	return transport.Response{
		ID: req.ID, Success: true,
		Data: map[string]any{"cleared": true},
	}
}

// handleAuthOpenAIStatus checks if the user has OpenAI OAuth credentials.
func (m *OAuthModule) handleAuthOpenAIStatus(_ context.Context, req transport.Request) transport.Response {
	hasOpenAI := false
	if authData, err := m.storage.Load(); err == nil {
		if cred := authData["openai-codex"]; cred != nil && cred.Type == "oauth" && cred.Credentials != nil {
			hasOpenAI = true
		}
	}
	for _, p := range m.providerFuncs.ListProviders() {
		if id, _ := p["id"].(string); id == "openai-oauth" || id == "openai" {
			hasOpenAI = true
			break
		}
	}
	return transport.Response{
		ID: req.ID, Success: true,
		Data: map[string]any{"authenticated": hasOpenAI},
	}
}

// handleAuthOpenAISetTokens registers OpenAI OAuth tokens from the frontend.
func (m *OAuthModule) handleAuthOpenAISetTokens(_ context.Context, req transport.Request) transport.Response {
	var payload struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		AccountID    string `json:"account_id"`
	}
	if req.Payload != nil {
		json.Unmarshal(req.Payload, &payload)
	}
	if payload.AccessToken == "" {
		return transport.Response{ID: req.ID, Success: false, Error: "access_token is required"}
	}
	m.providerFuncs.RegisterCodexOAuth(payload.AccessToken, payload.RefreshToken, payload.AccountID)
	fmt.Fprintf(os.Stderr, "[operator] provider registered: openai-oauth (Codex via chatgpt.com)\n")
	return transport.Response{
		ID: req.ID, Success: true,
		Data: map[string]any{"authenticated": true},
	}
}

// handleAuthOpenAIStart returns an error since OpenAI uses the "Use Codex" button flow.
func (m *OAuthModule) handleAuthOpenAIStart(_ context.Context, req transport.Request) transport.Response {
	return transport.Response{ID: req.ID, Success: false, Error: "Use 'Use Codex' button instead"}
}

// handleAuthOpenAIExchange returns an error since OpenAI uses the "Use Codex" button flow.
func (m *OAuthModule) handleAuthOpenAIExchange(_ context.Context, req transport.Request) transport.Response {
	return transport.Response{ID: req.ID, Success: false, Error: "Use 'Use Codex' button instead"}
}

// handleAuthOpenAIClear clears OpenAI OAuth credentials.
func (m *OAuthModule) handleAuthOpenAIClear(_ context.Context, req transport.Request) transport.Response {
	_ = m.storage.Delete("openai-codex")
	m.providerFuncs.RemoveProvider("openai-oauth")
	m.providerFuncs.RemoveProvider("openai")
	return transport.Response{
		ID: req.ID, Success: true,
		Data: map[string]any{"cleared": true},
	}
}

// openExternalURL opens a URL in the user's default browser.
func openExternalURL(url string) {
	switch runtime.GOOS {
	case "darwin":
		exec.Command("open", url).Start()
	case "linux":
		exec.Command("xdg-open", url).Start()
	case "windows":
		exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	}
}
