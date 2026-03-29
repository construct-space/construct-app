// Anthropic OAuth provider — uses OAuth tokens (unlimited, no API key needed).
//
// Key differences from API key auth:
//   - Bearer token auth (not x-api-key)
//   - ?beta=true on URL
//   - Tool names prefixed with mcp_
//   - System prompt as array with cache_control
//   - user-agent: claude-cli/2.1.2 (external, cli)
//   - metadata.user_id: "claude-code"
package connectors

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"construct-operator/internal/provider"
	"construct-operator/internal/provider/helpers"
)

const (
	// OpenCodeClientID is the registered OAuth client ID (from OpenCode)
	OpenCodeClientID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
	// mcpToolPrefix is required for OAuth — Anthropic requires this prefix
	mcpToolPrefix = "mcp_"
	// oauthTokenURL is where tokens are exchanged/refreshed
	oauthTokenURL = "https://console.anthropic.com/v1/oauth/token"
	// oauthBetaFeatures to enable with OAuth
	oauthBetaFeatures = "oauth-2025-04-20,interleaved-thinking-2025-05-14,claude-code-20250219"
	// claudeCodeSystemPrompt is the required header for OAuth tokens
	claudeCodeSystemPrompt = "You are Claude Code, Anthropic's official CLI for Claude."
	// userAgent matches Claude CLI exactly
	userAgent = "claude-cli/2.1.2 (external, cli)"
)

// Shared HTTP transport with connection pooling
var sharedTransport = &http.Transport{
	MaxIdleConns:        100,
	MaxIdleConnsPerHost: 10,
	IdleConnTimeout:     90 * time.Second,
	DialContext: (&net.Dialer{
		Timeout:   30 * time.Second,
		KeepAlive: 30 * time.Second,
	}).DialContext,
}

// Shared HTTP clients
var (
	oauthHTTPClient   = &http.Client{Timeout: 120 * time.Second, Transport: sharedTransport}
	oauthStreamClient = &http.Client{Timeout: 0, Transport: sharedTransport} // no timeout for streaming
	oauthTokenClient  = &http.Client{Timeout: 30 * time.Second, Transport: sharedTransport}
)

// AnthropicOAuthProvider authenticates via OAuth Bearer tokens.
type AnthropicOAuthProvider struct {
	baseURL      string
	accessToken  string
	refreshToken string
	tokenExpiry  time.Time
	clientID     string
	mu           sync.RWMutex
}

// OAuthConfig holds the OAuth setup.
type OAuthConfig struct {
	ClientID     string
	AccessToken  string
	RefreshToken string
	ExpiresAt    time.Time
}

func NewAnthropicOAuth(cfg OAuthConfig) *AnthropicOAuthProvider {
	if cfg.ClientID == "" {
		cfg.ClientID = OpenCodeClientID
	}
	if cfg.ExpiresAt.IsZero() {
		cfg.ExpiresAt = time.Now().Add(time.Hour)
	}
	return &AnthropicOAuthProvider{
		baseURL:      "https://api.anthropic.com/v1",
		accessToken:  cfg.AccessToken,
		refreshToken: cfg.RefreshToken,
		tokenExpiry:  cfg.ExpiresAt,
		clientID:     cfg.ClientID,
	}
}

// NewAnthropicOAuthFromOpenCode loads tokens from OpenCode's auth.json
func NewAnthropicOAuthFromOpenCode() (*AnthropicOAuthProvider, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(filepath.Join(home, ".local", "share", "opencode", "auth.json"))
	if err != nil {
		return nil, fmt.Errorf("opencode auth not found: %w", err)
	}

	var auth struct {
		Anthropic struct {
			Type    string `json:"type"`
			Access  string `json:"access"`
			Refresh string `json:"refresh"`
			Expires int64  `json:"expires"`
		} `json:"anthropic"`
	}
	if err := json.Unmarshal(data, &auth); err != nil {
		return nil, err
	}
	if auth.Anthropic.Access == "" {
		return nil, fmt.Errorf("no OAuth token in opencode auth.json")
	}

	// Don't reject expired tokens — getToken() will auto-refresh using the refresh token
	return NewAnthropicOAuth(OAuthConfig{
		ClientID:     OpenCodeClientID,
		AccessToken:  auth.Anthropic.Access,
		RefreshToken: auth.Anthropic.Refresh,
		ExpiresAt:    time.UnixMilli(auth.Anthropic.Expires),
	}), nil
}

// SetTokens updates the OAuth tokens (used after exchange)
func (p *AnthropicOAuthProvider) SetTokens(accessToken, refreshToken string, expiresIn int) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.accessToken = accessToken
	p.refreshToken = refreshToken
	if expiresIn > 0 {
		p.tokenExpiry = time.Now().Add(time.Duration(expiresIn) * time.Second)
	}
}

func (p *AnthropicOAuthProvider) ID() string { return "anthropic-oauth" }

func (p *AnthropicOAuthProvider) Models() []string {
	return []string{
		"claude-opus-4-6",
		"claude-sonnet-4-6",
		"claude-sonnet-4-5",
		"claude-haiku-4-5",
	}
}

// getToken returns a valid access token, auto-refreshing if needed.
func (p *AnthropicOAuthProvider) getToken() (string, error) {
	p.mu.RLock()
	token := p.accessToken
	expiry := p.tokenExpiry
	p.mu.RUnlock()

	// Still valid (with 5 min buffer)
	if time.Now().Before(expiry.Add(-5 * time.Minute)) {
		return token, nil
	}

	// Try refresh
	if err := p.refresh(); err != nil {
		return token, err // Return old token, might still work
	}

	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.accessToken, nil
}

func (p *AnthropicOAuthProvider) refresh() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.refreshToken == "" || p.clientID == "" {
		// Try loading fresh tokens from OpenCode auth.json as fallback
		if err := p.loadOpenCodeTokensLocked(); err == nil {
			fmt.Fprintf(os.Stderr, "[anthropic-oauth] loaded fresh tokens from OpenCode auth.json\n")
			return nil
		}
		return fmt.Errorf("cannot refresh: missing refresh token or client ID")
	}

	body, _ := json.Marshal(map[string]string{
		"grant_type":    "refresh_token",
		"refresh_token": p.refreshToken,
		"client_id":     p.clientID,
	})

	req, _ := http.NewRequest("POST", oauthTokenURL, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := oauthTokenClient.Do(req)
	if err != nil {
		return fmt.Errorf("refresh failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		respBody, _ := io.ReadAll(resp.Body)
		// Refresh token was rotated — try loading fresh tokens from OpenCode/Claude Code
		fmt.Fprintf(os.Stderr, "[anthropic-oauth] refresh failed (%d), trying OpenCode auth.json fallback\n", resp.StatusCode)
		if err := p.loadOpenCodeTokensLocked(); err == nil {
			fmt.Fprintf(os.Stderr, "[anthropic-oauth] recovered with fresh tokens from OpenCode auth.json\n")
			return nil
		}
		return fmt.Errorf("refresh failed: %d - %s", resp.StatusCode, string(respBody))
	}

	var tokenResp struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return err
	}

	p.accessToken = tokenResp.AccessToken
	if tokenResp.RefreshToken != "" {
		p.refreshToken = tokenResp.RefreshToken
	}
	p.tokenExpiry = time.Now().Add(time.Duration(tokenResp.ExpiresIn) * time.Second)
	return nil
}

// loadOpenCodeTokensLocked reads fresh tokens from OpenCode's auth.json.
// Must be called with p.mu held.
func (p *AnthropicOAuthProvider) loadOpenCodeTokensLocked() error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	data, err := os.ReadFile(filepath.Join(home, ".local", "share", "opencode", "auth.json"))
	if err != nil {
		return err
	}
	var auth struct {
		Anthropic struct {
			Type    string `json:"type"`
			Access  string `json:"access"`
			Refresh string `json:"refresh"`
			Expires int64  `json:"expires"`
		} `json:"anthropic"`
	}
	if err := json.Unmarshal(data, &auth); err != nil {
		return err
	}
	if auth.Anthropic.Access == "" {
		return fmt.Errorf("no token in opencode auth.json")
	}
	p.accessToken = auth.Anthropic.Access
	p.refreshToken = auth.Anthropic.Refresh
	p.tokenExpiry = time.UnixMilli(auth.Anthropic.Expires)
	if p.clientID == "" {
		p.clientID = OpenCodeClientID
	}
	return nil
}

func (p *AnthropicOAuthProvider) Complete(ctx context.Context, req *provider.Request) (*provider.Response, error) {
	token, err := p.getToken()
	if err != nil {
		return nil, fmt.Errorf("auth: %w", err)
	}

	body := p.buildBody(req, false)
	data, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", p.baseURL+"/messages?beta=true", bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	p.setHeaders(httpReq, token)

	resp, err := oauthHTTPClient.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respData, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("anthropic oauth error %d: %s", resp.StatusCode, string(respData))
	}

	return p.parseResponse(respData)
}

func (p *AnthropicOAuthProvider) Stream(ctx context.Context, req *provider.Request) (<-chan provider.StreamEvent, error) {
	token, err := p.getToken()
	if err != nil {
		return nil, fmt.Errorf("auth: %w", err)
	}

	body := p.buildBody(req, true)
	data, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}

	// Debug: log tool count, model, and first few bytes of request
	if tools, ok := body["tools"]; ok {
		if toolList, ok := tools.([]map[string]any); ok {
			fmt.Fprintf(os.Stderr, "[anthropic-oauth] stream: model=%s, tools=%d, msgs=%d\n",
				req.Model, len(toolList), len(req.Messages))
			// Dump tool names to file for debugging
			if f, err := os.OpenFile("/tmp/construct-tools.log", os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644); err == nil {
				for ti, tt := range toolList {
					fmt.Fprintf(f, "tool[%d]: %s\n", ti, tt["name"])
				}
				f.Close()
			}
			fmt.Fprintf(os.Stderr, "[anthropic-oauth] tool[0]: %s\n", toolList[0]["name"])
		}
	} else {
		fmt.Fprintf(os.Stderr, "[anthropic-oauth] stream: model=%s, NO TOOLS\n", req.Model)
	}
	// Dump first 500 bytes of request body
	if len(data) > 500 {
		fmt.Fprintf(os.Stderr, "[anthropic-oauth] body[0:500]: %s\n", string(data[:500]))
	} else {
		fmt.Fprintf(os.Stderr, "[anthropic-oauth] body: %s\n", string(data))
	}

	httpReq, err := http.NewRequestWithContext(ctx, "POST", p.baseURL+"/messages?beta=true", bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	p.setHeaders(httpReq, token)

	resp, err := oauthStreamClient.Do(httpReq)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != 200 {
		respData, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		return nil, fmt.Errorf("anthropic oauth stream error %d: %s", resp.StatusCode, string(respData))
	}

	ch := make(chan provider.StreamEvent, 64)
	go p.readSSE(resp.Body, ch)
	return ch, nil
}

// setHeaders sets OAuth-specific headers matching Claude CLI exactly
func (p *AnthropicOAuthProvider) setHeaders(req *http.Request, token string) {
	// Lowercase headers to match OpenCode/fetch behavior
	req.Header = make(http.Header)
	req.Header["content-type"] = []string{"application/json"}
	req.Header["authorization"] = []string{"Bearer " + token}
	req.Header["anthropic-version"] = []string{"2023-06-01"}
	req.Header["anthropic-beta"] = []string{oauthBetaFeatures}
	req.Header["user-agent"] = []string{userAgent}
	// Do NOT set x-api-key for OAuth
}

// buildOAuthSystemPrompt creates the array-format system prompt for OAuth.
// First block MUST be exactly claudeCodeSystemPrompt, additional content in second block.
// Last block gets cache_control: ephemeral for prompt caching.
func buildOAuthSystemPrompt(additionalSystem string) []map[string]any {
	blocks := []map[string]any{
		{"type": "text", "text": claudeCodeSystemPrompt},
	}
	if additionalSystem != "" {
		blocks = append(blocks, map[string]any{
			"type":          "text",
			"text":          additionalSystem,
			"cache_control": map[string]string{"type": "ephemeral"},
		})
	} else {
		blocks[0]["cache_control"] = map[string]string{"type": "ephemeral"}
	}
	return blocks
}

func (p *AnthropicOAuthProvider) buildBody(req *provider.Request, stream bool) map[string]any {
	messages := make([]map[string]any, 0, len(req.Messages))

	for _, m := range req.Messages {
		msg := map[string]any{"role": m.Role}

		if m.Role == "tool" && m.ToolResult != nil {
			// Tool results → user message with tool_result content blocks
			msg["role"] = "user"
			msg["content"] = []map[string]any{{
				"type":        "tool_result",
				"tool_use_id": m.ToolResult.CallID,
				"content":     m.ToolResult.Content,
				"is_error":    m.ToolResult.IsError,
			}}
		} else if len(m.ToolCalls) > 0 {
			// Assistant with tool calls
			content := []map[string]any{}
			if m.Content != "" {
				content = append(content, map[string]any{"type": "text", "text": m.Content})
			}
			for _, tc := range m.ToolCalls {
				var inputObj any
				if err := json.Unmarshal([]byte(tc.Input), &inputObj); err != nil || inputObj == nil {
					inputObj = map[string]any{} // API requires input to be a dictionary
				}
				content = append(content, map[string]any{
					"type":  "tool_use",
					"id":    tc.ID,
					"name":  helpers.SanitizeToolName(mcpToolPrefix + tc.Name),
					"input": inputObj,
				})
			}
			msg["content"] = content
		} else {
			msg["content"] = m.Content
		}
		messages = append(messages, msg)
	}

	body := map[string]any{
		"model":      req.Model,
		"messages":   messages,
		"max_tokens": max(req.MaxTokens, 8192),
		"stream":     stream,
		"metadata":   map[string]any{"user_id": "claude-code"},
	}

	// System prompt as array format (required for OAuth)
	body["system"] = buildOAuthSystemPrompt(req.System)

	// Tools with mcp_ prefix
	if len(req.Tools) > 0 {
		tools := make([]map[string]any, len(req.Tools))
		for i, t := range req.Tools {
			tools[i] = map[string]any{
				"name":         helpers.SanitizeToolName(mcpToolPrefix + t.Name),
				"description":  t.Description,
				"input_schema": helpers.SanitizeToolSchema(t.InputSchema),
			}
		}
		body["tools"] = tools
	}

	if req.Temperature != nil {
		body["temperature"] = *req.Temperature
	}

	return body
}

func (p *AnthropicOAuthProvider) parseResponse(data []byte) (*provider.Response, error) {
	var raw struct {
		Content []struct {
			Type  string          `json:"type"`
			Text  string          `json:"text,omitempty"`
			ID    string          `json:"id,omitempty"`
			Name  string          `json:"name,omitempty"`
			Input json.RawMessage `json:"input,omitempty"`
		} `json:"content"`
		StopReason string `json:"stop_reason"`
		Usage      struct {
			InputTokens  int `json:"input_tokens"`
			OutputTokens int `json:"output_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}

	resp := &provider.Response{
		StopReason: raw.StopReason,
		Usage: provider.Usage{
			InputTokens:  raw.Usage.InputTokens,
			OutputTokens: raw.Usage.OutputTokens,
		},
	}

	for _, block := range raw.Content {
		switch block.Type {
		case "text":
			resp.Content += block.Text
		case "tool_use":
			name := strings.TrimPrefix(block.Name, mcpToolPrefix)
			name = helpers.UnsanitizeToolName(name)
			resp.ToolCalls = append(resp.ToolCalls, provider.ToolCall{
				ID:    block.ID,
				Name:  name,
				Input: string(block.Input),
			})
		}
	}
	return resp, nil
}

func (p *AnthropicOAuthProvider) readSSE(body io.ReadCloser, ch chan<- provider.StreamEvent) {
	defer body.Close()
	defer close(ch)

	var currentToolCall *provider.ToolCall
	var toolCalls []provider.ToolCall
	var contentAccum strings.Builder

	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 1024*1024), 1024*1024)

	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			break
		}

		var event map[string]any
		if err := json.Unmarshal([]byte(data), &event); err != nil {
			continue
		}

		eventType, _ := event["type"].(string)

		switch eventType {
		case "content_block_start":
			if cb, ok := event["content_block"].(map[string]any); ok {
				if bt, _ := cb["type"].(string); bt == "tool_use" {
					name, _ := cb["name"].(string)
					name = strings.TrimPrefix(name, mcpToolPrefix)
					name = helpers.UnsanitizeToolName(name)
					id, _ := cb["id"].(string)
					currentToolCall = &provider.ToolCall{ID: id, Name: name}
					ch <- provider.StreamEvent{Type: "tool_call_start", ToolCall: currentToolCall}
				}
			}

		case "content_block_delta":
			if delta, ok := event["delta"].(map[string]any); ok {
				dt, _ := delta["type"].(string)
				if dt == "text_delta" {
					text, _ := delta["text"].(string)
					contentAccum.WriteString(text)
					ch <- provider.StreamEvent{Type: "text_delta", Text: text}
				} else if dt == "input_json_delta" && currentToolCall != nil {
					partial, _ := delta["partial_json"].(string)
					currentToolCall.Input += partial
				}
			}

		case "content_block_stop":
			if currentToolCall != nil {
				toolCalls = append(toolCalls, *currentToolCall)
				currentToolCall = nil
			}

		case "message_stop":
			resp := &provider.Response{Content: contentAccum.String()}
			for _, tc := range toolCalls {
				resp.ToolCalls = append(resp.ToolCalls, tc)
			}
			if len(resp.ToolCalls) > 0 {
				resp.StopReason = "tool_use"
			} else {
				resp.StopReason = "end_turn"
			}
			fmt.Fprintf(os.Stderr, "[anthropic-oauth] stream done: stop=%s, tool_calls=%d\n", resp.StopReason, len(resp.ToolCalls))
			ch <- provider.StreamEvent{Type: "done", Response: resp}
			return

		case "message_delta":
			// Track usage if needed
		}
	}
}

// --- PKCE OAuth Flow ---

// PKCE holds the code verifier and challenge.
type PKCE struct {
	Verifier  string
	Challenge string
}

// GeneratePKCE creates a PKCE code verifier and challenge.
func GeneratePKCE() (*PKCE, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return nil, err
	}
	verifier := base64.RawURLEncoding.EncodeToString(b)
	hash := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(hash[:])
	return &PKCE{Verifier: verifier, Challenge: challenge}, nil
}

// GetAuthorizationURL returns the OAuth authorization URL with PKCE.
// Note: OpenCode uses the verifier as the state parameter.
func GetAuthorizationURL(clientID, redirectURI string, pkce *PKCE) string {
	return fmt.Sprintf(
		"https://claude.ai/oauth/authorize?code=true&client_id=%s&response_type=code&redirect_uri=%s&scope=%s&code_challenge=%s&code_challenge_method=S256&state=%s",
		clientID, redirectURI,
		"org:create_api_key+user:profile+user:inference",
		pkce.Challenge, pkce.Verifier,
	)
}

// ExchangeCode exchanges an OAuth authorization code for tokens.
// ExchangeCodeForTokens exchanges an OAuth authorization code for tokens.
func ExchangeCode(code, state, clientID, redirectURI, codeVerifier string) (access, refresh string, expiresIn int, err error) {
	reqBody := map[string]string{
		"code":          code,
		"state":         state,
		"grant_type":    "authorization_code",
		"client_id":     clientID,
		"redirect_uri":  redirectURI,
		"code_verifier": codeVerifier,
	}

	body, _ := json.Marshal(reqBody)

	codePreview := code
	if len(codePreview) > 10 {
		codePreview = codePreview[:10]
	}
	statePreview := state
	if len(statePreview) > 10 {
		statePreview = statePreview[:10]
	}
	verifierPreview := codeVerifier
	if len(verifierPreview) > 10 {
		verifierPreview = verifierPreview[:10]
	}
	fmt.Fprintf(os.Stderr, "[ExchangeCode] code=%s..., state=%s..., verifier=%s...\n",
		codePreview, statePreview, verifierPreview)

	req, _ := http.NewRequest("POST", oauthTokenURL, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := oauthTokenClient.Do(req)
	if err != nil {
		return "", "", 0, fmt.Errorf("exchange failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		respBody, _ := io.ReadAll(resp.Body)
		fmt.Fprintf(os.Stderr, "[ExchangeCode] Failed: %d - %s\n", resp.StatusCode, string(respBody))
		return "", "", 0, fmt.Errorf("exchange failed: %d - %s", resp.StatusCode, string(respBody))
	}

	var tokenResp struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return "", "", 0, err
	}

	fmt.Fprintf(os.Stderr, "[ExchangeCode] Success, expiresIn: %d\n", tokenResp.ExpiresIn)
	return tokenResp.AccessToken, tokenResp.RefreshToken, tokenResp.ExpiresIn, nil
}
