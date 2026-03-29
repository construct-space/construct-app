// Package oauth implements OAuth credential management for AI providers.
// Ported from pi-mono's @mariozechner/pi-ai/oauth module.
//
// Supported providers:
//   - Anthropic (Claude Pro/Max)
//   - OpenAI Codex (ChatGPT Plus/Pro)
//   - GitHub Copilot (device code flow)
package oauth

// Credentials holds OAuth token data for any provider.
type Credentials struct {
	Refresh string         `json:"refresh"`
	Access  string         `json:"access"`
	Expires int64          `json:"expires"` // Unix millis
	Extra   map[string]any `json:"extra,omitempty"`
}

// IsExpired returns true if the access token has expired.
func (c *Credentials) IsExpired() bool {
	return timeNowMs() >= c.Expires
}

// AuthInfo is sent to the UI when a provider needs the user to authenticate.
type AuthInfo struct {
	URL          string `json:"url"`
	Instructions string `json:"instructions,omitempty"`
}

// Prompt is sent to the UI to ask the user for input.
type Prompt struct {
	Message     string `json:"message"`
	Placeholder string `json:"placeholder,omitempty"`
	AllowEmpty  bool   `json:"allowEmpty,omitempty"`
}

// LoginCallbacks are the UI callbacks used during login flows.
type LoginCallbacks struct {
	OnAuth            func(info AuthInfo)
	OnPrompt          func(prompt Prompt) (string, error)
	OnProgress        func(message string)
	OnManualCodeInput func() (string, error)
}

// Provider is the interface each OAuth provider implements.
type Provider interface {
	// ID returns the unique provider identifier (e.g., "anthropic", "openai-codex").
	ID() string

	// Name returns the human-readable provider name.
	Name() string

	// Login runs the OAuth flow and returns credentials.
	Login(callbacks LoginCallbacks) (*Credentials, error)

	// RefreshToken refreshes expired credentials.
	RefreshToken(creds *Credentials) (*Credentials, error)

	// GetAPIKey extracts the API key string from credentials.
	GetAPIKey(creds *Credentials) string

	// UsesCallbackServer returns true if login uses a local HTTP callback server.
	UsesCallbackServer() bool
}

// AuthCredential is stored in auth.json — either an API key or OAuth credentials.
type AuthCredential struct {
	Type        string       `json:"type"` // "api_key" or "oauth"
	Key         string       `json:"key,omitempty"`
	Credentials *Credentials `json:"credentials,omitempty"`
}

// StorageData is the entire auth.json file content.
type StorageData map[string]*AuthCredential

func timeNowMs() int64 {
	return timeNow().UnixMilli()
}

// CallbackSuccessHTML returns a styled success page shown after OAuth callback.
// providerName is displayed in the heading (e.g. "Claude connected in Construct").
func CallbackSuccessHTML(providerName string) string {
	return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Construct</title><style>
body{font-family:-apple-system,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0a0a0a;color:#e5e5e5}
.card{text-align:center;padding:3rem;border-radius:1rem;background:#141414;border:1px solid #222;max-width:400px}
.check{width:48px;height:48px;margin:0 auto 1rem;color:#00ff41}
h1{font-size:1.25rem;margin:0 0 .5rem}
p{font-size:.875rem;color:#888;margin:0 0 1.5rem}
</style></head><body><div class="card">
<svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
<h1>` + providerName + ` connected in Construct</h1>
<p>You can close this tab and return to the app.</p>
</div></body></html>`
}
