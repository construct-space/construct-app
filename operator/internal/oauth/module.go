package oauth

import (
	"sync"

	"construct-operator/internal/module"
)

// PendingOAuthResult holds the result of a pending OAuth login flow.
type PendingOAuthResult struct {
	Creds *Credentials
	Err   error
	URL   string
}

// ProviderFuncs holds functions that bridge this module to the provider,
// runner, and operatorapp/providers packages, avoiding import cycles.
type ProviderFuncs struct {
	// AddOAuthProvider creates a runtime provider from OAuth credentials and
	// adds it to the runner. Combines FromOAuthCredentials + Runner.AddProvider.
	AddOAuthProvider func(providerID string, creds *Credentials)
	// RuntimeProviderID returns the runtime provider ID for an OAuth provider.
	RuntimeProviderID func(providerID string) string
	// ConnectedProviderEntries returns connected provider entries for the UI.
	ConnectedProviderEntries func(authData StorageData, runnerProviders []map[string]any) []map[string]any
	// ListProviders returns the list of active runtime providers.
	ListProviders func() []map[string]any
	// RemoveProvider removes a runtime provider by ID.
	RemoveProvider func(id string)

	// StartAnthropicOAuthFlow generates a PKCE challenge and returns the auth URL.
	// Returns (url, verifier, challenge, error).
	StartAnthropicOAuthFlow func(clientID, redirectURI string) (url, verifier, challenge string, err error)
	// ExchangeAnthropicCode exchanges an authorization code for tokens.
	// Returns (accessToken, refreshToken, expiresIn, error).
	ExchangeAnthropicCode func(code, state, clientID, redirectURI, codeVerifier string) (string, string, int, error)
	// RegisterAnthropicOAuth creates and registers an Anthropic OAuth provider on the runner.
	RegisterAnthropicOAuth func(accessToken, refreshToken string, expiresIn int)
	// RegisterCodexOAuth creates and registers a Codex OAuth provider on the runner.
	RegisterCodexOAuth func(accessToken, refreshToken, accountID string)
	// DefaultClientID is the default Anthropic OAuth client ID.
	DefaultClientID string
}

// OAuthModule is a self-contained module for all oauth.* and auth.* request handling.
type OAuthModule struct {
	module.DefaultModule
	registry      *Registry
	storage       *Storage
	providerFuncs ProviderFuncs

	// Pending flow state (owned by this module)
	pendingDeviceMu sync.Mutex
	pendingDevice   map[string]*DeviceFlowState
	pendingOAuthMu  sync.Mutex
	pendingOAuth    map[string]chan PendingOAuthResult
}

// NewModuleWithFuncs creates an OAuth module from dependencies.
// providerFuncs must be supplied to avoid import cycles with provider,
// runner, and operatorapp/providers packages.
func NewModuleWithFuncs(deps module.Dependencies, funcs ProviderFuncs) module.Module {
	var reg *Registry
	if r, ok := deps.OAuthRegistry.(*Registry); ok {
		reg = r
	}
	var st *Storage
	if s, ok := deps.OAuthStorage.(*Storage); ok {
		st = s
	}
	return &OAuthModule{
		registry:      reg,
		storage:       st,
		providerFuncs: funcs,
		pendingDevice: make(map[string]*DeviceFlowState),
		pendingOAuth:  make(map[string]chan PendingOAuthResult),
	}
}

// ID returns the module identifier.
func (m *OAuthModule) ID() string { return "oauth" }

// Routes registers all oauth.* and auth.* request handlers.
func (m *OAuthModule) Routes(r *module.Router) {
	r.Handle("oauth.login", m.handleLogin)
	r.Handle("oauth.device-poll", m.handleDevicePoll)
	r.Handle("oauth.poll", m.handlePoll)
	r.Handle("oauth.gh-check", m.handleGHCheck)
	r.Handle("oauth.gh-use-token", m.handleGHUseToken)
	r.Handle("oauth.providers", m.handleProviders)
	r.Handle("oauth.logout", m.handleLogout)

	r.Handle("auth.oauth.status", m.handleAuthAnthropicStatus)
	r.Handle("auth.anthropic.status", m.handleAuthAnthropicStatus)
	r.Handle("auth.oauth.start", m.handleAuthAnthropicStart)
	r.Handle("auth.anthropic.start", m.handleAuthAnthropicStart)
	r.Handle("auth.oauth.exchange", m.handleAuthAnthropicExchange)
	r.Handle("auth.anthropic.exchange", m.handleAuthAnthropicExchange)
	r.Handle("auth.anthropic.set_tokens", m.handleAuthAnthropicSetTokens)
	r.Handle("auth.oauth.clear", m.handleAuthAnthropicClear)
	r.Handle("auth.anthropic.clear", m.handleAuthAnthropicClear)

	r.Handle("auth.openai.status", m.handleAuthOpenAIStatus)
	r.Handle("auth.openai.set_tokens", m.handleAuthOpenAISetTokens)
	r.Handle("auth.openai.start", m.handleAuthOpenAIStart)
	r.Handle("auth.openai.exchange", m.handleAuthOpenAIExchange)
	r.Handle("auth.openai.clear", m.handleAuthOpenAIClear)
}

// ---------------------------------------------------------------------------
// Pending flow state helpers
// ---------------------------------------------------------------------------

func (m *OAuthModule) setPendingDeviceFlow(providerID string, state *DeviceFlowState) {
	m.pendingDeviceMu.Lock()
	defer m.pendingDeviceMu.Unlock()
	m.pendingDevice[providerID] = state
}

func (m *OAuthModule) getPendingDeviceFlow(providerID string) (*DeviceFlowState, bool) {
	m.pendingDeviceMu.Lock()
	defer m.pendingDeviceMu.Unlock()
	state, ok := m.pendingDevice[providerID]
	return state, ok
}

func (m *OAuthModule) clearPendingDeviceFlow(providerID string) {
	m.pendingDeviceMu.Lock()
	defer m.pendingDeviceMu.Unlock()
	delete(m.pendingDevice, providerID)
}

func (m *OAuthModule) setPendingOAuthFlow(providerID string, resultCh chan PendingOAuthResult) {
	m.pendingOAuthMu.Lock()
	defer m.pendingOAuthMu.Unlock()
	m.pendingOAuth[providerID] = resultCh
}

func (m *OAuthModule) getPendingOAuthFlow(providerID string) (chan PendingOAuthResult, bool) {
	m.pendingOAuthMu.Lock()
	defer m.pendingOAuthMu.Unlock()
	resultCh, ok := m.pendingOAuth[providerID]
	return resultCh, ok
}

func (m *OAuthModule) clearPendingOAuthFlow(providerID string) {
	m.pendingOAuthMu.Lock()
	defer m.pendingOAuthMu.Unlock()
	delete(m.pendingOAuth, providerID)
}
