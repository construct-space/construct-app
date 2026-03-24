package oauth

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// Ported from pi-mono: packages/ai/src/utils/oauth/google-gemini-cli.ts
// Google Cloud Code Assist (Gemini CLI) — standard Gemini models.

const (
	geminiClientIDEncoded     = "NjgxMjU1ODA5Mzk1LW9vOGZ0Mm9wcmRybnA5ZTNhcWY2YXYzaG1kaWIxMzVqLmFwcHMuZ29vZ2xldXNlcmNvbnRlbnQuY29t"
	geminiClientSecretEncoded = "R09DU1BYLTR1SGdNUG0tMW83U2stZ2VWNkN1NWNsWEZzeGw="
	geminiRedirectURI         = "http://localhost:8085/oauth2callback"
	geminiAuthURL             = "https://accounts.google.com/o/oauth2/v2/auth"
	geminiTokenURL            = "https://oauth2.googleapis.com/token"
	geminiCodeAssistEndpoint  = "https://cloudcode-pa.googleapis.com"
)

var (
	geminiClientID     string
	geminiClientSecret string
	geminiScopes       = []string{
		"https://www.googleapis.com/auth/cloud-platform",
		"https://www.googleapis.com/auth/userinfo.email",
		"https://www.googleapis.com/auth/userinfo.profile",
	}
)

func init() {
	decoded, _ := base64.StdEncoding.DecodeString(geminiClientIDEncoded)
	geminiClientID = string(decoded)
	decoded, _ = base64.StdEncoding.DecodeString(geminiClientSecretEncoded)
	geminiClientSecret = string(decoded)
}

// GoogleGeminiProvider implements Gemini CLI OAuth (Google Cloud Code Assist).
type GoogleGeminiProvider struct{}

func (p *GoogleGeminiProvider) ID() string               { return "google-gemini-cli" }
func (p *GoogleGeminiProvider) Name() string             { return "Google Gemini CLI" }
func (p *GoogleGeminiProvider) UsesCallbackServer() bool { return true }

func (p *GoogleGeminiProvider) GetAPIKey(c *Credentials) string {
	projectID, _ := c.Extra["projectId"].(string)
	data, _ := json.Marshal(map[string]string{"token": c.Access, "projectId": projectID})
	return string(data)
}

func (p *GoogleGeminiProvider) Login(callbacks LoginCallbacks) (*Credentials, error) {
	return loginGeminiCli(callbacks)
}

func (p *GoogleGeminiProvider) RefreshToken(creds *Credentials) (*Credentials, error) {
	projectID, _ := creds.Extra["projectId"].(string)
	if projectID == "" {
		return nil, fmt.Errorf("missing projectId in credentials")
	}
	refreshed, err := RefreshGoogleCloudToken(creds.Refresh, projectID)
	if err != nil {
		return nil, err
	}
	if refreshed.Extra == nil {
		refreshed.Extra = map[string]any{}
	}
	if email, _ := creds.Extra["email"].(string); email != "" {
		refreshed.Extra["email"] = email
	}
	return refreshed, nil
}

func loginGeminiCli(callbacks LoginCallbacks) (*Credentials, error) {
	verifier, challenge, err := GeneratePKCE()
	if err != nil {
		return nil, fmt.Errorf("generate PKCE: %w", err)
	}

	// Start callback server
	codeCh := make(chan struct{ code, state string }, 1)
	errCh := make(chan error, 1)
	server, err := startGeminiCallbackServer(codeCh, errCh)
	if err != nil {
		return nil, fmt.Errorf("start callback server: %w", err)
	}
	defer server.Close()

	// Build auth URL
	params := url.Values{
		"client_id":             {geminiClientID},
		"response_type":         {"code"},
		"redirect_uri":          {geminiRedirectURI},
		"scope":                 {strings.Join(geminiScopes, " ")},
		"code_challenge":        {challenge},
		"code_challenge_method": {"S256"},
		"state":                 {verifier},
		"access_type":           {"offline"},
		"prompt":                {"consent"},
	}
	authURL := geminiAuthURL + "?" + params.Encode()

	callbacks.OnAuth(AuthInfo{
		URL:          authURL,
		Instructions: "Complete the sign-in in your browser.",
	})

	// Wait for callback
	var code string
	select {
	case result := <-codeCh:
		if result.state != verifier {
			return nil, fmt.Errorf("OAuth state mismatch")
		}
		code = result.code
	case err := <-errCh:
		return nil, err
	case <-time.After(5 * time.Minute):
		return nil, fmt.Errorf("login timed out")
	}

	if code == "" {
		return nil, fmt.Errorf("no authorization code received")
	}

	// Exchange code for tokens
	if callbacks.OnProgress != nil {
		callbacks.OnProgress("Exchanging authorization code for tokens...")
	}

	tokenData, err := exchangeGeminiCode(code, verifier)
	if err != nil {
		return nil, err
	}

	if callbacks.OnProgress != nil {
		callbacks.OnProgress("Getting user info...")
	}
	email := getGoogleUserEmail(tokenData.accessToken)

	// Discover project
	if callbacks.OnProgress != nil {
		callbacks.OnProgress("Discovering Cloud Code Assist project...")
	}
	projectID, err := discoverGeminiProject(tokenData.accessToken, callbacks.OnProgress)
	if err != nil {
		return nil, fmt.Errorf("discover project: %w", err)
	}

	return &Credentials{
		Refresh: tokenData.refreshToken,
		Access:  tokenData.accessToken,
		Expires: timeNowMs() + tokenData.expiresIn*1000 - 5*60*1000,
		Extra: map[string]any{
			"projectId": projectID,
			"email":     email,
		},
	}, nil
}

type geminiTokenData struct {
	accessToken  string
	refreshToken string
	expiresIn    int64
}

func exchangeGeminiCode(code, verifier string) (*geminiTokenData, error) {
	data := url.Values{
		"client_id":     {geminiClientID},
		"client_secret": {geminiClientSecret},
		"code":          {code},
		"grant_type":    {"authorization_code"},
		"redirect_uri":  {geminiRedirectURI},
		"code_verifier": {verifier},
	}

	resp, err := http.PostForm(geminiTokenURL, data)
	if err != nil {
		return nil, fmt.Errorf("token exchange: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("token exchange failed (%d): %s", resp.StatusCode, string(body))
	}

	var result struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int64  `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("parse token response: %w", err)
	}

	if result.RefreshToken == "" {
		return nil, fmt.Errorf("no refresh token received")
	}

	return &geminiTokenData{
		accessToken:  result.AccessToken,
		refreshToken: result.RefreshToken,
		expiresIn:    result.ExpiresIn,
	}, nil
}

func RefreshGoogleCloudToken(refreshToken, projectID string) (*Credentials, error) {
	data := url.Values{
		"client_id":     {geminiClientID},
		"client_secret": {geminiClientSecret},
		"refresh_token": {refreshToken},
		"grant_type":    {"refresh_token"},
	}

	resp, err := http.PostForm(geminiTokenURL, data)
	if err != nil {
		return nil, fmt.Errorf("refresh request: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("refresh failed (%d): %s", resp.StatusCode, string(body))
	}

	var result struct {
		AccessToken  string `json:"access_token"`
		ExpiresIn    int64  `json:"expires_in"`
		RefreshToken string `json:"refresh_token"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("parse refresh response: %w", err)
	}

	refresh := result.RefreshToken
	if refresh == "" {
		refresh = refreshToken
	}

	return &Credentials{
		Refresh: refresh,
		Access:  result.AccessToken,
		Expires: timeNowMs() + result.ExpiresIn*1000 - 5*60*1000,
		Extra: map[string]any{
			"projectId": projectID,
		},
	}, nil
}

func getGoogleUserEmail(accessToken string) string {
	req, _ := http.NewRequest("GET", "https://www.googleapis.com/oauth2/v1/userinfo?alt=json", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return ""
	}

	var data struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return ""
	}
	return strings.TrimSpace(data.Email)
}

func discoverGeminiProject(accessToken string, onProgress func(string)) (string, error) {
	// Check env var first
	if projectID := os.Getenv("GOOGLE_CLOUD_PROJECT"); projectID != "" {
		return projectID, nil
	}
	if projectID := os.Getenv("GOOGLE_CLOUD_PROJECT_ID"); projectID != "" {
		return projectID, nil
	}

	headers := map[string]string{
		"Authorization": "Bearer " + accessToken,
		"Content-Type":  "application/json",
		"User-Agent":    "google-api-nodejs-client/9.15.1",
	}

	// Try loadCodeAssist
	if onProgress != nil {
		onProgress("Checking for existing Cloud Code Assist project...")
	}

	loadBody, _ := json.Marshal(map[string]any{
		"metadata": map[string]string{
			"ideType":    "IDE_UNSPECIFIED",
			"platform":   "PLATFORM_UNSPECIFIED",
			"pluginType": "GEMINI",
		},
	})

	req, _ := http.NewRequest("POST", geminiCodeAssistEndpoint+"/v1internal:loadCodeAssist", strings.NewReader(string(loadBody)))
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("loadCodeAssist: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("loadCodeAssist failed (%d): %s", resp.StatusCode, string(body))
	}

	var loadResult struct {
		CloudaicompanionProject string `json:"cloudaicompanionProject"`
		CurrentTier             *struct {
			ID string `json:"id"`
		} `json:"currentTier"`
	}
	json.Unmarshal(body, &loadResult)

	if loadResult.CloudaicompanionProject != "" {
		return loadResult.CloudaicompanionProject, nil
	}

	// Need onboarding
	if onProgress != nil {
		onProgress("Provisioning Cloud Code Assist project...")
	}

	onboardBody, _ := json.Marshal(map[string]any{
		"tierId": "free-tier",
		"metadata": map[string]string{
			"ideType":    "IDE_UNSPECIFIED",
			"platform":   "PLATFORM_UNSPECIFIED",
			"pluginType": "GEMINI",
		},
	})

	req, _ = http.NewRequest("POST", geminiCodeAssistEndpoint+"/v1internal:onboardUser", strings.NewReader(string(onboardBody)))
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("onboardUser: %w", err)
	}
	defer resp.Body.Close()

	body, _ = io.ReadAll(resp.Body)

	var onboardResult struct {
		Done     bool   `json:"done"`
		Name     string `json:"name"`
		Response struct {
			CloudaicompanionProject struct {
				ID string `json:"id"`
			} `json:"cloudaicompanionProject"`
		} `json:"response"`
	}
	json.Unmarshal(body, &onboardResult)

	if onboardResult.Response.CloudaicompanionProject.ID != "" {
		return onboardResult.Response.CloudaicompanionProject.ID, nil
	}

	// Poll if not done
	if !onboardResult.Done && onboardResult.Name != "" {
		for i := 0; i < 30; i++ {
			time.Sleep(5 * time.Second)
			if onProgress != nil {
				onProgress(fmt.Sprintf("Waiting for project provisioning (attempt %d)...", i+2))
			}

			req, _ := http.NewRequest("GET", geminiCodeAssistEndpoint+"/v1internal/"+onboardResult.Name, nil)
			for k, v := range headers {
				req.Header.Set(k, v)
			}

			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				continue
			}
			body, _ := io.ReadAll(resp.Body)
			resp.Body.Close()

			var pollResult struct {
				Done     bool `json:"done"`
				Response struct {
					CloudaicompanionProject struct {
						ID string `json:"id"`
					} `json:"cloudaicompanionProject"`
				} `json:"response"`
			}
			json.Unmarshal(body, &pollResult)

			if pollResult.Done && pollResult.Response.CloudaicompanionProject.ID != "" {
				return pollResult.Response.CloudaicompanionProject.ID, nil
			}
		}
	}

	return "", fmt.Errorf("could not discover or provision a Google Cloud project")
}

func startGeminiCallbackServer(codeCh chan<- struct{ code, state string }, errCh chan<- error) (*http.Server, error) {
	mux := http.NewServeMux()
	mux.HandleFunc("/oauth2callback", func(w http.ResponseWriter, r *http.Request) {
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

		w.WriteHeader(200)
		fmt.Fprint(w, CallbackSuccessHTML("Gemini"))
		codeCh <- struct{ code, state string }{code, state}
	})

	server := &http.Server{
		Addr:    "127.0.0.1:8085",
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
