// Package identity loads the active Construct profile so brain knows who's
// logged in. v0 reads two files:
//
//	<DataDir>/auth.json             — Construct identity (user, token)
//	<DataDir>/providers/auth.json   — linked provider OAuth subscriptions
//
// We never write either file — the desktop app owns writes; brain is a
// read-only consumer. Missing files are non-fatal: brain just reports
// authenticated=false and continues with env-var auth only.
package identity

import (
	"encoding/json"
	"os"
	"sync"
)

// User is the subset of profile fields brain cares about. Anything else
// the app stores stays in RawUser for forward-compat.
type User struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	Username  string `json:"username"`
	Name      string `json:"name"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
}

// Identity is the parsed auth.json state. Token is the cat_* identity
// token; Authenticated mirrors the file's flag.
type Identity struct {
	User          User                          `json:"user"`
	Token         string                        `json:"token"`
	OAuthToken    string                        `json:"oauth_token"`
	Authenticated bool                          `json:"authenticated"`
	Subscriptions map[string]string             `json:"subscriptions"` // provider -> "oauth"/"api_key" if linked
	Credentials   map[string]ProviderCredential `json:"-"`             // provider -> raw OAuth creds (not exposed over wire)
}

// ProviderCredential holds the OAuth refresh/access tokens for one provider,
// parsed from providers/auth.json.
type ProviderCredential struct {
	Type    string `json:"type"`
	Refresh string `json:"refresh"`
	Access  string `json:"access"`
	Expires int64  `json:"expires"` // unix ms (when present)
}

// Loader is goroutine-safe; Reload is fine to call any time.
type Loader struct {
	authFile          string
	providersAuthFile string

	mu      sync.RWMutex
	current Identity
}

func New(authFile, providersAuthFile string) *Loader {
	return &Loader{authFile: authFile, providersAuthFile: providersAuthFile}
}

// Rebind points the loader at a different profile's auth files. Called
// after a profile switch/rename so subsequent Load() calls read the
// current profile's tokens, not the boot-time one.
func (l *Loader) Rebind(authFile, providersAuthFile string) {
	l.mu.Lock()
	l.authFile = authFile
	l.providersAuthFile = providersAuthFile
	l.current = Identity{Subscriptions: map[string]string{}}
	l.mu.Unlock()
}

// Load reads both files. Returns the parsed identity (also stored on the
// loader). Missing files yield a zero Identity, never an error.
func (l *Loader) Load() Identity {
	id := Identity{Subscriptions: map[string]string{}}

	if body, err := os.ReadFile(l.authFile); err == nil {
		var raw struct {
			User          User   `json:"user"`
			Token         string `json:"token"`
			OAuthToken    string `json:"oauth_token"`
			Authenticated bool   `json:"authenticated"`
		}
		if err := json.Unmarshal(body, &raw); err == nil {
			id.User = raw.User
			id.Token = raw.Token
			id.OAuthToken = raw.OAuthToken
			id.Authenticated = raw.Authenticated
		}
	}

	id.Credentials = map[string]ProviderCredential{}
	if body, err := os.ReadFile(l.providersAuthFile); err == nil {
		var raw map[string]struct {
			Type        string `json:"type"`
			Credentials struct {
				Refresh string `json:"refresh"`
				Access  string `json:"access"`
				Expires int64  `json:"expires"`
			} `json:"credentials"`
		}
		if err := json.Unmarshal(body, &raw); err == nil {
			for prov, entry := range raw {
				if entry.Type != "" {
					id.Subscriptions[prov] = entry.Type
				}
				id.Credentials[prov] = ProviderCredential{
					Type:    entry.Type,
					Refresh: entry.Credentials.Refresh,
					Access:  entry.Credentials.Access,
					Expires: entry.Credentials.Expires,
				}
			}
		}
	}

	l.mu.Lock()
	l.current = id
	l.mu.Unlock()
	return id
}

// Current returns the last-loaded identity. Returns a zero Identity if
// Load has never run.
func (l *Loader) Current() Identity {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.current
}

// Public is the safe view sent over the wire to the frontend — never
// leak tokens. Even though brain only talks to localhost, treating tokens
// as need-to-know prevents accidental logs/UI exposure.
type Public struct {
	Authenticated bool              `json:"authenticated"`
	User          User              `json:"user"`
	Subscriptions map[string]string `json:"subscriptions"`
}

func (i Identity) Public() Public {
	return Public{
		Authenticated: i.Authenticated,
		User:          i.User,
		Subscriptions: i.Subscriptions,
	}
}
