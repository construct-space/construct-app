package oauth

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// Ported from pi-mono: packages/ai/src/utils/oauth/github-copilot.ts
// GitHub Copilot uses the OAuth device code flow (no callback server).

const (
	copilotClientIDEncoded = "SXYxLmI1MDdhMDhjODdlY2ZlOTg="
)

var (
	copilotClientID string
	copilotHeaders  = map[string]string{
		"User-Agent":             "GitHubCopilotChat/0.35.0",
		"Editor-Version":         "vscode/1.107.0",
		"Editor-Plugin-Version":  "copilot-chat/0.35.0",
		"Copilot-Integration-Id": "vscode-chat",
	}
)

func init() {
	decoded, _ := base64.StdEncoding.DecodeString(copilotClientIDEncoded)
	copilotClientID = string(decoded)
}

// GitHubCopilotProvider implements GitHub Copilot OAuth (device code flow).
type GitHubCopilotProvider struct{}

func (p *GitHubCopilotProvider) ID() string                      { return "github-copilot" }
func (p *GitHubCopilotProvider) Name() string                    { return "GitHub Copilot" }
func (p *GitHubCopilotProvider) UsesCallbackServer() bool        { return false }
func (p *GitHubCopilotProvider) GetAPIKey(c *Credentials) string { return c.Access }

func (p *GitHubCopilotProvider) Login(callbacks LoginCallbacks) (*Credentials, error) {
	return loginGitHubCopilot(callbacks)
}

func (p *GitHubCopilotProvider) RefreshToken(creds *Credentials) (*Credentials, error) {
	domain := "github.com"
	if d, ok := creds.Extra["enterpriseUrl"].(string); ok && d != "" {
		domain = d
	}
	return RefreshGitHubCopilotToken(creds.Refresh, domain)
}

func copilotURLs(domain string) (deviceCode, accessToken, copilotToken string) {
	return fmt.Sprintf("https://%s/login/device/code", domain),
		fmt.Sprintf("https://%s/login/oauth/access_token", domain),
		fmt.Sprintf("https://api.%s/copilot_internal/v2/token", domain)
}

// DeviceFlowState holds the state of an in-progress device code flow.
type DeviceFlowState struct {
	Domain          string `json:"domain"`
	DeviceCode      string `json:"device_code"`
	UserCode        string `json:"user_code"`
	VerificationURI string `json:"verification_uri"`
	AccessTokenURL  string `json:"access_token_url"`
	Interval        int    `json:"interval"`
	ExpiresIn       int    `json:"expires_in"`
}

// StartCopilotDeviceFlow initiates the device code flow and returns the state
// (including user_code) so the UI can display it. Call CompleteCopilotDeviceFlow to poll.
func StartCopilotDeviceFlow(enterpriseDomain string) (*DeviceFlowState, error) {
	domain := "github.com"
	if trimmed := strings.TrimSpace(enterpriseDomain); trimmed != "" {
		normalized := normalizeDomain(trimmed)
		if normalized == "" {
			return nil, fmt.Errorf("invalid GitHub Enterprise URL/domain")
		}
		domain = normalized
	}

	deviceCodeURL, accessTokenURL, _ := copilotURLs(domain)
	device, err := startDeviceFlow(deviceCodeURL)
	if err != nil {
		return nil, fmt.Errorf("device flow: %w", err)
	}

	return &DeviceFlowState{
		Domain:          domain,
		DeviceCode:      device.DeviceCode,
		UserCode:        device.UserCode,
		VerificationURI: firstNonEmpty(device.VerificationURIComplete, device.VerificationURI),
		AccessTokenURL:  accessTokenURL,
		Interval:        device.Interval,
		ExpiresIn:       device.ExpiresIn,
	}, nil
}

// CompleteCopilotDeviceFlow polls GitHub until the user authorizes, then exchanges for Copilot token.
func CompleteCopilotDeviceFlow(state *DeviceFlowState) (*Credentials, error) {
	githubToken, err := pollForGitHubAccessToken(state.AccessTokenURL, state.DeviceCode, state.Interval, state.ExpiresIn)
	if err != nil {
		return nil, fmt.Errorf("poll for token: %w", err)
	}

	creds, err := RefreshGitHubCopilotToken(githubToken, state.Domain)
	if err != nil {
		return nil, fmt.Errorf("get copilot token: %w", err)
	}

	if state.Domain != "github.com" {
		if creds.Extra == nil {
			creds.Extra = make(map[string]any)
		}
		creds.Extra["enterpriseUrl"] = state.Domain
	}

	return creds, nil
}

func loginGitHubCopilot(callbacks LoginCallbacks) (*Credentials, error) {
	// Ask for enterprise domain (or blank for github.com)
	input, err := callbacks.OnPrompt(Prompt{
		Message:     "GitHub Enterprise URL/domain (blank for github.com)",
		Placeholder: "company.ghe.com",
		AllowEmpty:  true,
	})
	if err != nil {
		return nil, err
	}

	state, err := StartCopilotDeviceFlow(input)
	if err != nil {
		return nil, err
	}

	callbacks.OnAuth(AuthInfo{
		URL:          state.VerificationURI,
		Instructions: fmt.Sprintf("Enter code: %s", state.UserCode),
	})

	return CompleteCopilotDeviceFlow(state)
}

type deviceCodeResponse struct {
	DeviceCode              string `json:"device_code"`
	UserCode                string `json:"user_code"`
	VerificationURI         string `json:"verification_uri"`
	VerificationURIComplete string `json:"verification_uri_complete"`
	Interval                int    `json:"interval"`
	ExpiresIn               int    `json:"expires_in"`
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func startDeviceFlow(deviceCodeURL string) (*deviceCodeResponse, error) {
	data := url.Values{
		"client_id": {copilotClientID},
		"scope":     {"read:user"},
	}

	req, _ := http.NewRequest("POST", deviceCodeURL, strings.NewReader(data.Encode()))
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", "GitHubCopilotChat/0.35.0")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("device code request failed (%d): %s", resp.StatusCode, string(body))
	}

	var result deviceCodeResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("parse device code response: %w", err)
	}
	return &result, nil
}

// PollCopilotDeviceFlowOnce makes a single poll to GitHub and returns immediately.
// Returns: status ("pending", "success", "error"), credentials (on success), error (on failure).
func PollCopilotDeviceFlowOnce(state *DeviceFlowState) (string, *Credentials, error) {
	token, status, err := pollGitHubAccessTokenOnce(state.AccessTokenURL, state.DeviceCode)
	if status == "pending" {
		return "pending", nil, nil
	}
	if err != nil {
		return "error", nil, err
	}

	creds, err := RefreshGitHubCopilotToken(token, state.Domain)
	if err != nil {
		return "error", nil, fmt.Errorf("get copilot token: %w", err)
	}

	if state.Domain != "github.com" {
		if creds.Extra == nil {
			creds.Extra = make(map[string]any)
		}
		creds.Extra["enterpriseUrl"] = state.Domain
	}

	return "success", creds, nil
}

// pollGitHubAccessTokenOnce makes a single poll request.
// Returns: token (on success), status ("pending"/"success"/"error"), error.
func pollGitHubAccessTokenOnce(accessTokenURL, deviceCode string) (string, string, error) {
	data := url.Values{
		"client_id":   {copilotClientID},
		"device_code": {deviceCode},
		"grant_type":  {"urn:ietf:params:oauth:grant-type:device_code"},
	}

	req, _ := http.NewRequest("POST", accessTokenURL, strings.NewReader(data.Encode()))
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", "GitHubCopilotChat/0.35.0")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", "error", err
	}

	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()

	var result map[string]any
	json.Unmarshal(body, &result)

	if token, ok := result["access_token"].(string); ok && token != "" {
		return token, "success", nil
	}

	if errStr, ok := result["error"].(string); ok {
		switch errStr {
		case "authorization_pending", "slow_down":
			return "", "pending", nil
		default:
			desc, _ := result["error_description"].(string)
			return "", "error", fmt.Errorf("device flow failed: %s: %s", errStr, desc)
		}
	}

	return "", "pending", nil
}

func pollForGitHubAccessToken(accessTokenURL, deviceCode string, intervalSec, expiresIn int) (string, error) {
	deadline := time.Now().Add(time.Duration(expiresIn) * time.Second)
	interval := time.Duration(intervalSec) * time.Second
	if interval < time.Second {
		interval = time.Second
	}

	for time.Now().Before(deadline) {
		time.Sleep(interval)

		data := url.Values{
			"client_id":   {copilotClientID},
			"device_code": {deviceCode},
			"grant_type":  {"urn:ietf:params:oauth:grant-type:device_code"},
		}

		req, _ := http.NewRequest("POST", accessTokenURL, strings.NewReader(data.Encode()))
		req.Header.Set("Accept", "application/json")
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		req.Header.Set("User-Agent", "GitHubCopilotChat/0.35.0")

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			continue
		}

		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		var result map[string]any
		json.Unmarshal(body, &result)

		if token, ok := result["access_token"].(string); ok && token != "" {
			return token, nil
		}

		if errStr, ok := result["error"].(string); ok {
			switch errStr {
			case "authorization_pending":
				continue
			case "slow_down":
				interval += 5 * time.Second
				continue
			default:
				desc, _ := result["error_description"].(string)
				return "", fmt.Errorf("device flow failed: %s: %s", errStr, desc)
			}
		}
	}

	return "", fmt.Errorf("device flow timed out")
}

func RefreshGitHubCopilotToken(githubAccessToken, domain string) (*Credentials, error) {
	_, _, copilotTokenURL := copilotURLs(domain)

	req, _ := http.NewRequest("GET", copilotTokenURL, nil)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+githubAccessToken)
	for k, v := range copilotHeaders {
		req.Header.Set(k, v)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("copilot token request: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("copilot token failed (%d): %s", resp.StatusCode, string(body))
	}

	var result struct {
		Token     string `json:"token"`
		ExpiresAt int64  `json:"expires_at"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("parse copilot token: %w", err)
	}

	if result.Token == "" {
		return nil, fmt.Errorf("copilot token response missing token")
	}

	return &Credentials{
		Refresh: githubAccessToken,
		Access:  result.Token,
		Expires: result.ExpiresAt*1000 - 5*60*1000,
	}, nil
}

func normalizeDomain(input string) string {
	trimmed := strings.TrimSpace(input)
	if trimmed == "" {
		return ""
	}
	if !strings.Contains(trimmed, "://") {
		trimmed = "https://" + trimmed
	}
	u, err := url.Parse(trimmed)
	if err != nil {
		return ""
	}
	return u.Hostname()
}

// DetectGitHubCLIAuth checks if the user is logged into GitHub via gh CLI.
// Reads ~/.config/gh/hosts.yml for the username, and macOS keychain for the token.
// Returns (username, token) — both empty if not logged in.
func DetectGitHubCLIAuth() (string, string) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", ""
	}

	// Read gh hosts config
	hostsPath := filepath.Join(home, ".config", "gh", "hosts.yml")
	data, err := os.ReadFile(hostsPath)
	if err != nil {
		return "", ""
	}

	// Simple YAML parsing — look for "user: <username>" under "github.com:"
	username := ""
	inGitHub := false
	for _, line := range strings.Split(string(data), "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "github.com:" {
			inGitHub = true
			continue
		}
		if inGitHub && strings.HasPrefix(trimmed, "user:") {
			username = strings.TrimSpace(strings.TrimPrefix(trimmed, "user:"))
			break
		}
		// Stop if we hit another top-level key
		if inGitHub && !strings.HasPrefix(line, " ") && !strings.HasPrefix(line, "\t") && trimmed != "" {
			break
		}
	}

	if username == "" {
		return "", ""
	}

	// Try to get token from macOS keychain
	token := ""
	if out, err := exec.Command("security", "find-generic-password", "-s", "gh:github.com", "-w").Output(); err == nil {
		raw := strings.TrimSpace(string(out))
		// gh stores base64-encoded tokens with "go-keyring-base64:" prefix
		if strings.HasPrefix(raw, "go-keyring-base64:") {
			decoded, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(raw, "go-keyring-base64:"))
			if err == nil {
				token = string(decoded)
			}
		} else {
			token = raw
		}
	}

	// Fallback: try gh auth token command
	if token == "" {
		if out, err := exec.Command("gh", "auth", "token").Output(); err == nil {
			token = strings.TrimSpace(string(out))
		}
	}

	return username, token
}

// GetGitHubCopilotBaseURL returns the API base URL for GitHub Copilot.
func GetGitHubCopilotBaseURL(token, enterpriseDomain string) string {
	// Try to extract from token's proxy-ep field
	if idx := strings.Index(token, "proxy-ep="); idx >= 0 {
		rest := token[idx+9:]
		if end := strings.Index(rest, ";"); end >= 0 {
			rest = rest[:end]
		}
		apiHost := strings.Replace(rest, "proxy.", "api.", 1)
		return "https://" + apiHost
	}
	if enterpriseDomain != "" {
		return "https://copilot-api." + enterpriseDomain
	}
	return "https://api.individual.githubcopilot.com"
}
