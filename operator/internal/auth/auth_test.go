package auth

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGenerateToken(t *testing.T) {
	a := NewTokenAuth()
	token := a.GenerateToken("test-key")

	if token == "" {
		t.Fatal("generated token should not be empty")
	}
	if len(token) < 10 {
		t.Fatalf("token too short: %q", token)
	}
	if token[:3] != "co-" {
		t.Fatalf("expected co- prefix, got %q", token[:3])
	}
}

func TestGenerateTokenUniqueness(t *testing.T) {
	a := NewTokenAuth()
	t1 := a.GenerateToken("key1")
	t2 := a.GenerateToken("key2")

	if t1 == t2 {
		t.Fatal("two generated tokens should not be equal")
	}
}

func TestValidateToken(t *testing.T) {
	a := NewTokenAuth()
	token := a.GenerateToken("my-api-key")

	if !a.ValidateToken(token) {
		t.Error("valid token should pass validation")
	}

	if a.ValidateToken("invalid-token") {
		t.Error("invalid token should not pass validation")
	}

	if a.ValidateToken("") {
		t.Error("empty token should not pass validation")
	}
}

func TestTokenStoredAsHash(t *testing.T) {
	a := NewTokenAuth()
	token := a.GenerateToken("hash-test")

	// The raw token should NOT be in the tokens map
	a.mu.RLock()
	defer a.mu.RUnlock()

	expectedHash := hashToken(token)
	info, ok := a.tokens[expectedHash]
	if !ok {
		t.Fatal("token should be stored by its hash")
	}

	// Verify the stored hash matches SHA-256 of the raw token
	h := sha256.Sum256([]byte(token))
	wantHash := hex.EncodeToString(h[:])
	if info.Hash != wantHash {
		t.Fatalf("stored hash mismatch: got %q, want %q", info.Hash, wantHash)
	}
}

func TestRevokeToken(t *testing.T) {
	a := NewTokenAuth()
	token := a.GenerateToken("revoke-me")

	if !a.ValidateToken(token) {
		t.Fatal("token should be valid before revocation")
	}

	ok := a.RevokeToken(token)
	if !ok {
		t.Fatal("RevokeToken should return true for existing token")
	}

	if a.ValidateToken(token) {
		t.Error("token should be invalid after revocation")
	}

	// Revoking again should return false
	ok = a.RevokeToken(token)
	if ok {
		t.Error("revoking already-revoked token should return false")
	}
}

func TestRevokeNonexistentToken(t *testing.T) {
	a := NewTokenAuth()
	ok := a.RevokeToken("does-not-exist")
	if ok {
		t.Error("revoking nonexistent token should return false")
	}
}

func TestListTokens(t *testing.T) {
	a := NewTokenAuth()

	// Empty list
	tokens := a.ListTokens()
	if len(tokens) != 0 {
		t.Fatalf("expected 0 tokens, got %d", len(tokens))
	}

	// Generate some tokens
	raw1 := a.GenerateToken("key-1")
	a.GenerateToken("key-2")
	a.GenerateToken("key-3")

	tokens = a.ListTokens()
	if len(tokens) != 3 {
		t.Fatalf("expected 3 tokens, got %d", len(tokens))
	}

	// Verify tokens are masked (should not contain full raw token)
	for _, info := range tokens {
		if info.Label == "" {
			t.Error("token info should have a label")
		}
		if info.Hash == "" {
			t.Error("token info should have a hash")
		}
		if info.Masked == "" {
			t.Error("token info should have a masked value")
		}
		// Masked should not equal the raw token
		if info.Masked == raw1 {
			t.Error("masked token should not equal raw token")
		}
	}

	// Verify labels are present
	labels := make(map[string]bool)
	for _, info := range tokens {
		labels[info.Label] = true
	}
	for _, want := range []string{"key-1", "key-2", "key-3"} {
		if !labels[want] {
			t.Errorf("missing label %q in token list", want)
		}
	}
}

func TestListTokensAfterRevoke(t *testing.T) {
	a := NewTokenAuth()
	token := a.GenerateToken("ephemeral")
	a.GenerateToken("persistent")

	a.RevokeToken(token)

	tokens := a.ListTokens()
	if len(tokens) != 1 {
		t.Fatalf("expected 1 token after revoke, got %d", len(tokens))
	}
	if tokens[0].Label != "persistent" {
		t.Errorf("expected remaining token label=persistent, got %q", tokens[0].Label)
	}
}

func TestMiddlewareValidToken(t *testing.T) {
	a := NewTokenAuth()
	token := a.GenerateToken("test")

	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("authorized"))
	})

	handler := a.Middleware(inner)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if w.Body.String() != "authorized" {
		t.Errorf("expected body=authorized, got %q", w.Body.String())
	}
}

func TestMiddlewareMissingHeader(t *testing.T) {
	a := NewTokenAuth()

	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	handler := a.Middleware(inner)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestMiddlewareInvalidFormat(t *testing.T) {
	a := NewTokenAuth()

	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	handler := a.Middleware(inner)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Basic abc123")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestMiddlewareInvalidToken(t *testing.T) {
	a := NewTokenAuth()
	a.GenerateToken("real-key") // generate one, but use a different one

	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	handler := a.Middleware(inner)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer wrong-token")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestMiddlewareRevokedToken(t *testing.T) {
	a := NewTokenAuth()
	token := a.GenerateToken("temporary")

	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	handler := a.Middleware(inner)

	// First request should succeed
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 before revoke, got %d", w.Code)
	}

	// Revoke and try again
	a.RevokeToken(token)

	req = httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w = httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 after revoke, got %d", w.Code)
	}
}

func TestMaskToken(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"co-abcdef1234567890abcdef1234567890", "co-a...7890"},
		{"short", "****"},
		{"12345678", "****"},
		{"123456789", "1234...6789"},
	}
	for _, tt := range tests {
		got := maskToken(tt.input)
		if got != tt.want {
			t.Errorf("maskToken(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestHashTokenDeterministic(t *testing.T) {
	token := "co-test-token-123"
	h1 := hashToken(token)
	h2 := hashToken(token)
	if h1 != h2 {
		t.Fatalf("hashToken should be deterministic: %q != %q", h1, h2)
	}
	if len(h1) != 64 { // SHA-256 hex = 64 chars
		t.Fatalf("expected 64 char hash, got %d", len(h1))
	}
}

func TestConcurrentAccess(t *testing.T) {
	a := NewTokenAuth()
	done := make(chan bool, 10)

	// Concurrent generation
	for i := 0; i < 5; i++ {
		go func(n int) {
			token := a.GenerateToken("concurrent")
			a.ValidateToken(token)
			done <- true
		}(i)
	}

	// Concurrent listing
	for i := 0; i < 5; i++ {
		go func() {
			a.ListTokens()
			done <- true
		}()
	}

	for i := 0; i < 10; i++ {
		<-done
	}

	tokens := a.ListTokens()
	if len(tokens) != 5 {
		t.Fatalf("expected 5 tokens after concurrent ops, got %d", len(tokens))
	}
}
