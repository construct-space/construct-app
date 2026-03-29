// Package auth provides token-based authentication for non-local connections.
// Tokens are stored as SHA-256 hashes so raw tokens are never persisted.
package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"
	"sync"
)

// TokenInfo holds metadata about a token.
type TokenInfo struct {
	Label  string `json:"label"`
	Hash   string `json:"hash"`   // SHA-256 hex of the raw token
	Masked string `json:"masked"` // e.g. "co-abc...xyz"
}

// TokenAuth manages API tokens.
type TokenAuth struct {
	mu     sync.RWMutex
	tokens map[string]TokenInfo // keyed by hash
}

// NewTokenAuth creates a new token authenticator.
func NewTokenAuth() *TokenAuth {
	return &TokenAuth{
		tokens: make(map[string]TokenInfo),
	}
}

// GenerateToken creates a new API token with the given label.
// Returns the raw token string — this is the only time it's available.
func (a *TokenAuth) GenerateToken(label string) string {
	raw := generateRawToken()
	hash := hashToken(raw)
	masked := maskToken(raw)

	a.mu.Lock()
	defer a.mu.Unlock()

	a.tokens[hash] = TokenInfo{
		Label:  label,
		Hash:   hash,
		Masked: masked,
	}
	return raw
}

// ValidateToken checks if the given raw token is valid.
func (a *TokenAuth) ValidateToken(token string) bool {
	hash := hashToken(token)

	a.mu.RLock()
	defer a.mu.RUnlock()

	_, ok := a.tokens[hash]
	return ok
}

// RevokeToken removes a token by its raw value.
func (a *TokenAuth) RevokeToken(token string) bool {
	hash := hashToken(token)

	a.mu.Lock()
	defer a.mu.Unlock()

	if _, ok := a.tokens[hash]; !ok {
		return false
	}
	delete(a.tokens, hash)
	return true
}

// ListTokens returns all tokens with masked values (never raw tokens).
func (a *TokenAuth) ListTokens() []TokenInfo {
	a.mu.RLock()
	defer a.mu.RUnlock()

	result := make([]TokenInfo, 0, len(a.tokens))
	for _, info := range a.tokens {
		result = append(result, info)
	}
	return result
}

// Middleware returns an HTTP middleware that validates Bearer tokens.
// Requests without a valid Authorization header are rejected with 401.
func (a *TokenAuth) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			http.Error(w, "missing authorization header", http.StatusUnauthorized)
			return
		}

		if !strings.HasPrefix(authHeader, "Bearer ") {
			http.Error(w, "invalid authorization format", http.StatusUnauthorized)
			return
		}

		token := strings.TrimPrefix(authHeader, "Bearer ")
		if !a.ValidateToken(token) {
			http.Error(w, "invalid token", http.StatusUnauthorized)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// hashToken returns the SHA-256 hex digest of a raw token.
func hashToken(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}

// maskToken returns a masked version of a raw token for display.
func maskToken(token string) string {
	if len(token) <= 8 {
		return "****"
	}
	return token[:4] + "..." + token[len(token)-4:]
}

// generateRawToken creates a cryptographically random token.
func generateRawToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(fmt.Sprintf("crypto/rand failed: %v", err))
	}
	return "co-" + hex.EncodeToString(b) // "co-" prefix for "construct-operator"
}
