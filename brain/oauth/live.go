package oauth

import (
	"context"
	"errors"
	"sync"

	"github.com/construct-space/brain/provider"
)

// LiveTokenSource wraps a builder that knows how to construct a concrete
// token source from current credentials. Every Token() call asks `key`
// for an identity (typically the refresh-token string). When the key
// changes (login, logout, profile switch, manual edit of auth.json) the
// next call rebuilds the inner source. Returns ErrReauthRequired when
// key reports empty so callers see a clean signal instead of a stale
// "anthropic oauth: no refresh token" message.
//
// The Live wrapper exists so prompt handlers can hold a single stable
// reference at boot — handleOAuthLogin doesn't need a callback into
// main to swap pointers when a user signs in mid-session.
type LiveTokenSource struct {
	// Build returns a fresh TokenSource for the current credentials,
	// or nil if there are no credentials right now.
	Build func() provider.TokenSource
	// Key returns the identity of the current credentials. When this
	// changes, Build is re-invoked.
	Key func() string

	mu       sync.Mutex
	inner    provider.TokenSource
	innerKey string
	// badKey remembers a credential that failed with ErrReauthRequired.
	// While Key() still returns it, HasCredentials reports false so the
	// routing fallback stops selecting this provider — a revoked/consumed
	// refresh token on disk otherwise counts as "has credentials" and the
	// fallback chain re-picks the dead provider forever ("re-login
	// required" every ~5 min from automations). Cleared automatically
	// when the user re-links (Key() changes).
	badKey string
}

// HasCredentials reports whether the wrapper currently has anything to
// build a token from. Lets callers (provider dispatch, prompt routing)
// avoid attaching an OAuth source that will only ever return
// ErrReauthRequired — without that, the prompt path silently routes to
// the OAuth-only provider, fails deep inside Token(), and surfaces as
// "anthropic: oauth token: oauth: re-login required" even when the user
// never picked Anthropic. A credential that already failed reauth is
// treated as absent until it changes.
func (l *LiveTokenSource) HasCredentials() bool {
	if l == nil || l.Key == nil {
		return false
	}
	k := l.Key()
	if k == "" {
		return false
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	return k != l.badKey
}

func (l *LiveTokenSource) Token(ctx context.Context) (string, error) {
	l.mu.Lock()
	currentKey := ""
	if l.Key != nil {
		currentKey = l.Key()
	}
	if currentKey == "" {
		l.inner = nil
		l.innerKey = ""
		l.mu.Unlock()
		return "", ErrReauthRequired
	}
	if l.inner == nil || currentKey != l.innerKey {
		l.inner = l.Build()
		l.innerKey = currentKey
	}
	inner := l.inner
	l.mu.Unlock()
	if inner == nil {
		return "", ErrReauthRequired
	}
	tok, err := inner.Token(ctx)
	if err == nil {
		// Anthropic + OpenAI rotate the refresh token on every refresh.
		// Without this sync, our Key callback (which returns the current
		// on-disk refresh) would see the rotated value on the next call,
		// treat it as an external credential swap, rebuild the inner
		// source, and throw away the access-token cache — re-refreshing
		// (and re-rotating) on every Token() call forever. Re-reading
		// the key here pins innerKey to whatever the inner just rotated
		// to, so subsequent calls hit the warm cache.
		l.mu.Lock()
		if l.Key != nil {
			l.innerKey = l.Key()
		}
		l.badKey = ""
		l.mu.Unlock()
	} else if errorsIsReauth(err) {
		// Remember the dead credential so HasCredentials stops offering
		// this provider to the fallback chain until the user re-links.
		l.mu.Lock()
		l.badKey = currentKey
		l.mu.Unlock()
	}
	return tok, err
}

func errorsIsReauth(err error) bool {
	return err == ErrReauthRequired || errors.Is(err, ErrReauthRequired)
}
