package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"runtime"

	"construct-operator/internal/oauth"
	"construct-operator/internal/provider"
	"construct-operator/internal/transport"
)

func (rt *operatorRuntime) handleOAuthRequest(_ context.Context, req transport.Request) (transport.Response, bool) {
	run := rt.runner
	oauthRegistry := rt.oauthRegistry
	oauthStorage := rt.oauthStorage

	switch {
	case req.Type == "oauth.login":
		var payload struct {
			Provider string `json:"provider"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		if payload.Provider == "" {
			return transport.Response{ID: req.ID, Success: false, Error: "provider is required"}, true
		}

		provider, ok := oauthRegistry.Get(payload.Provider)
		if !ok {
			return transport.Response{ID: req.ID, Success: false, Error: fmt.Sprintf("unknown OAuth provider: %s", payload.Provider)}, true
		}

		if payload.Provider == "github-copilot" {
			state, err := oauth.StartCopilotDeviceFlow("")
			if err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: fmt.Sprintf("OAuth login failed: %v", err)}, true
			}
			openExternalURL(state.VerificationURI)
			rt.setPendingDeviceFlow(payload.Provider, state)

			fmt.Fprintf(os.Stderr, "[oauth] %s: device flow started, code: %s\n", payload.Provider, state.UserCode)
			return transport.Response{
				ID: req.ID, Success: true,
				Data: map[string]any{
					"provider":    payload.Provider,
					"device_code": true,
					"user_code":   state.UserCode,
					"url":         state.VerificationURI,
				},
			}, true
		}

		resultCh := make(chan pendingOAuthResult, 1)
		rt.setPendingOAuthFlow(payload.Provider, resultCh)

		providerID := payload.Provider
		var authURL string

		go func() {
			creds, err := provider.Login(oauth.LoginCallbacks{
				OnAuth: func(info oauth.AuthInfo) {
					authURL = info.URL
					openExternalURL(info.URL)
					fmt.Fprintf(os.Stderr, "[oauth] %s: browser opened for login\n", providerID)
					if info.Instructions != "" {
						fmt.Fprintf(os.Stderr, "[oauth] %s: %s\n", providerID, info.Instructions)
					}
				},
				OnPrompt: func(prompt oauth.Prompt) (string, error) {
					if prompt.AllowEmpty {
						return "", nil
					}
					return "", fmt.Errorf("interactive prompt %q is not supported in desktop mode yet", prompt.Message)
				},
				OnProgress: func(message string) {
					fmt.Fprintf(os.Stderr, "[oauth] %s: %s\n", providerID, message)
				},
			})
			resultCh <- pendingOAuthResult{Creds: creds, Err: err, URL: authURL}
		}()

		fmt.Fprintf(os.Stderr, "[oauth] %s: login flow started (non-blocking)\n", providerID)
		return transport.Response{
			ID: req.ID, Success: true,
			Data: map[string]any{
				"provider": providerID,
				"pending":  true,
			},
		}, true

	case req.Type == "oauth.device-poll":
		var payload struct {
			Provider string `json:"provider"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}

		state, ok := rt.pendingDeviceFlow(payload.Provider)
		if !ok || state == nil {
			return transport.Response{ID: req.ID, Success: false, Error: "no pending device flow for " + payload.Provider}, true
		}

		status, creds, err := oauth.PollCopilotDeviceFlowOnce(state)
		if status == "pending" {
			return transport.Response{
				ID: req.ID, Success: true,
				Data: map[string]any{"status": "pending"},
			}, true
		}

		rt.clearPendingDeviceFlow(payload.Provider)
		if err != nil {
			return transport.Response{ID: req.ID, Success: false, Error: fmt.Sprintf("OAuth login failed: %v", err)}, true
		}

		if err := oauthStorage.SetOAuth(payload.Provider, creds); err != nil {
			fmt.Fprintf(os.Stderr, "[oauth] warning: failed to save credentials: %v\n", err)
		}
		if runtimeProv := providerFromOAuthCredentials(payload.Provider, creds); runtimeProv != nil {
			run.AddProvider(runtimeProv)
		}

		fmt.Fprintf(os.Stderr, "[oauth] %s: login successful (expires: %d)\n", payload.Provider, creds.Expires)
		return transport.Response{
			ID: req.ID, Success: true,
			Data: map[string]any{
				"provider": payload.Provider,
				"status":   "success",
				"success":  true,
			},
		}, true

	case req.Type == "oauth.poll":
		var payload struct {
			Provider string `json:"provider"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}

		ch, ok := rt.pendingOAuthFlow(payload.Provider)
		if !ok || ch == nil {
			return transport.Response{ID: req.ID, Success: false, Error: "no pending OAuth flow for " + payload.Provider}, true
		}

		select {
		case result := <-ch:
			rt.clearPendingOAuthFlow(payload.Provider)

			if result.Err != nil {
				return transport.Response{ID: req.ID, Success: false, Error: fmt.Sprintf("OAuth login failed: %v", result.Err)}, true
			}

			if err := oauthStorage.SetOAuth(payload.Provider, result.Creds); err != nil {
				fmt.Fprintf(os.Stderr, "[oauth] warning: failed to save credentials: %v\n", err)
			}
			if runtimeProv := providerFromOAuthCredentials(payload.Provider, result.Creds); runtimeProv != nil {
				run.AddProvider(runtimeProv)
			}

			fmt.Fprintf(os.Stderr, "[oauth] %s: login successful (expires: %d)\n", payload.Provider, result.Creds.Expires)
			return transport.Response{
				ID: req.ID, Success: true,
				Data: map[string]any{
					"provider": payload.Provider,
					"status":   "success",
					"success":  true,
				},
			}, true
		default:
			return transport.Response{
				ID: req.ID, Success: true,
				Data: map[string]any{"status": "pending"},
			}, true
		}

	case req.Type == "oauth.gh-check":
		username, token := oauth.DetectGitHubCLIAuth()
		return transport.Response{
			ID: req.ID, Success: true,
			Data: map[string]any{
				"logged_in": username != "",
				"username":  username,
				"token":     token,
			},
		}, true

	case req.Type == "oauth.gh-use-token":
		var payload struct {
			Token string `json:"token"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		if payload.Token == "" {
			return transport.Response{ID: req.ID, Success: false, Error: "token is required"}, true
		}
		creds, err := oauth.RefreshGitHubCopilotToken(payload.Token, "github.com")
		if err != nil {
			return transport.Response{ID: req.ID, Success: false, Error: fmt.Sprintf("Failed to get Copilot token: %v", err)}, true
		}
		if err := oauthStorage.SetOAuth("github-copilot", creds); err != nil {
			fmt.Fprintf(os.Stderr, "[oauth] warning: failed to save credentials: %v\n", err)
		}
		if runtimeProv := providerFromOAuthCredentials("github-copilot", creds); runtimeProv != nil {
			run.AddProvider(runtimeProv)
		}
		fmt.Fprintf(os.Stderr, "[oauth] github-copilot: connected via gh CLI token\n")
		return transport.Response{
			ID: req.ID, Success: true,
			Data: map[string]any{
				"provider": "github-copilot",
				"success":  true,
			},
		}, true

	case req.Type == "oauth.providers":
		authData, err := oauthStorage.Load()
		if err != nil {
			return transport.Response{ID: req.ID, Success: false, Error: err.Error()}, true
		}
		return transport.Response{
			ID: req.ID, Success: true,
			Data: map[string]any{
				"providers": oauthConnectedProviderEntries(authData, run.ListProviders()),
			},
		}, true

	case req.Type == "oauth.logout":
		var payload struct {
			Provider string `json:"provider"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		if payload.Provider == "" {
			return transport.Response{ID: req.ID, Success: false, Error: "provider is required"}, true
		}
		if err := oauthStorage.Delete(payload.Provider); err != nil {
			return transport.Response{ID: req.ID, Success: false, Error: err.Error()}, true
		}
		if runtimeID := oauthRuntimeProviderID(payload.Provider); runtimeID != "" {
			run.RemoveProvider(runtimeID)
		}
		return transport.Response{
			ID: req.ID, Success: true,
			Data: map[string]any{"cleared": true},
		}, true

	case req.Type == "auth.oauth.status" || req.Type == "auth.anthropic.status":
		hasOAuth := false
		if authData, err := oauthStorage.Load(); err == nil {
			if cred := authData["anthropic"]; cred != nil && cred.Type == "oauth" && cred.Credentials != nil {
				hasOAuth = true
			}
		}
		if !hasOAuth {
			for _, p := range run.ListProviders() {
				if p["id"] == "anthropic-oauth" {
					hasOAuth = true
					break
				}
			}
		}
		return transport.Response{
			ID: req.ID, Success: true,
			Data: map[string]any{"authenticated": hasOAuth},
		}, true

	case req.Type == "auth.oauth.start" || req.Type == "auth.anthropic.start":
		var payload struct {
			ClientID    string `json:"client_id"`
			RedirectURI string `json:"redirect_uri"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		if payload.ClientID == "" {
			payload.ClientID = provider.OpenCodeClientID
		}
		if payload.RedirectURI == "" {
			payload.RedirectURI = "http://localhost:14293/oauth/callback"
		}

		pkce, err := provider.GeneratePKCE()
		if err != nil {
			return transport.Response{ID: req.ID, Success: false, Error: err.Error()}, true
		}
		url := provider.GetAuthorizationURL(payload.ClientID, payload.RedirectURI, pkce)
		return transport.Response{
			ID: req.ID, Success: true,
			Data: map[string]any{
				"url":       url,
				"state":     pkce.Verifier,
				"verifier":  pkce.Verifier,
				"challenge": pkce.Challenge,
			},
		}, true

	case req.Type == "auth.oauth.exchange" || req.Type == "auth.anthropic.exchange":
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
			return transport.Response{ID: req.ID, Success: false, Error: "code is required"}, true
		}
		if payload.ClientID == "" {
			payload.ClientID = provider.OpenCodeClientID
		}
		if payload.RedirectURI == "" {
			payload.RedirectURI = "http://localhost:14293/oauth/callback"
		}
		if payload.CodeVerifier == "" && payload.Verifier != "" {
			payload.CodeVerifier = payload.Verifier
		}

		access, refresh, expiresIn, err := provider.ExchangeCode(
			payload.Code, payload.State, payload.ClientID,
			payload.RedirectURI, payload.CodeVerifier,
		)
		if err != nil {
			return transport.Response{ID: req.ID, Success: false, Error: err.Error()}, true
		}

		oauthProv := provider.NewAnthropicOAuth(provider.OAuthConfig{
			AccessToken:  access,
			RefreshToken: refresh,
		})
		run.AddProvider(oauthProv)

		return transport.Response{
			ID: req.ID, Success: true,
			Data: map[string]any{
				"access_token":  access,
				"refresh_token": refresh,
				"expires_in":    expiresIn,
			},
		}, true

	case req.Type == "auth.anthropic.set_tokens":
		var payload struct {
			AccessToken  string `json:"access_token"`
			RefreshToken string `json:"refresh_token"`
			ExpiresIn    int    `json:"expires_in"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		if payload.AccessToken == "" {
			return transport.Response{ID: req.ID, Success: false, Error: "access_token is required"}, true
		}
		oauthProv := provider.NewAnthropicOAuth(provider.OAuthConfig{
			AccessToken:  payload.AccessToken,
			RefreshToken: payload.RefreshToken,
		})
		if payload.ExpiresIn > 0 {
			oauthProv.SetTokens(payload.AccessToken, payload.RefreshToken, payload.ExpiresIn)
		}
		run.AddProvider(oauthProv)
		fmt.Fprintf(os.Stderr, "[operator] provider registered: anthropic-oauth (from frontend)\n")
		return transport.Response{
			ID: req.ID, Success: true,
			Data: map[string]any{"authenticated": true},
		}, true

	case req.Type == "auth.oauth.clear" || req.Type == "auth.anthropic.clear":
		_ = oauthStorage.Delete("anthropic")
		run.RemoveProvider("anthropic-oauth")
		return transport.Response{
			ID: req.ID, Success: true,
			Data: map[string]any{"cleared": true},
		}, true

	case req.Type == "auth.openai.status":
		hasOpenAI := false
		if authData, err := oauthStorage.Load(); err == nil {
			if cred := authData["openai-codex"]; cred != nil && cred.Type == "oauth" && cred.Credentials != nil {
				hasOpenAI = true
			}
		}
		for _, p := range run.ListProviders() {
			if id, _ := p["id"].(string); id == "openai-oauth" || id == "openai" {
				hasOpenAI = true
				break
			}
		}
		return transport.Response{
			ID: req.ID, Success: true,
			Data: map[string]any{"authenticated": hasOpenAI},
		}, true

	case req.Type == "auth.openai.set_tokens":
		var payload struct {
			AccessToken  string `json:"access_token"`
			RefreshToken string `json:"refresh_token"`
			AccountID    string `json:"account_id"`
		}
		if req.Payload != nil {
			json.Unmarshal(req.Payload, &payload)
		}
		if payload.AccessToken == "" {
			return transport.Response{ID: req.ID, Success: false, Error: "access_token is required"}, true
		}
		codexProv := provider.NewCodexOAuth(provider.CodexOAuthConfig{
			AccessToken:  payload.AccessToken,
			AccountID:    payload.AccountID,
			RefreshToken: payload.RefreshToken,
		})
		run.AddProvider(codexProv)
		fmt.Fprintf(os.Stderr, "[operator] provider registered: openai-oauth (Codex via chatgpt.com)\n")
		return transport.Response{
			ID: req.ID, Success: true,
			Data: map[string]any{"authenticated": true},
		}, true

	case req.Type == "auth.openai.start":
		return transport.Response{ID: req.ID, Success: false, Error: "Use 'Use Codex' button instead"}, true

	case req.Type == "auth.openai.exchange":
		return transport.Response{ID: req.ID, Success: false, Error: "Use 'Use Codex' button instead"}, true

	case req.Type == "auth.openai.clear":
		_ = oauthStorage.Delete("openai-codex")
		run.RemoveProvider("openai-oauth")
		run.RemoveProvider("openai")
		return transport.Response{
			ID: req.ID, Success: true,
			Data: map[string]any{"cleared": true},
		}, true

	default:
		return transport.Response{}, false
	}
}

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
