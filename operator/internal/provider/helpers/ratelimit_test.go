package helpers

import (
	"fmt"
	"net/http"
	"testing"
	"time"
)

func TestParseRateLimitHeaders_NotRateLimited(t *testing.T) {
	resp := &http.Response{StatusCode: 200, Header: http.Header{}}
	rl := ParseRateLimitHeaders(resp)
	if rl != nil {
		t.Fatal("expected nil for non-429 response")
	}
}

func TestParseRateLimitHeaders_NilResponse(t *testing.T) {
	rl := ParseRateLimitHeaders(nil)
	if rl != nil {
		t.Fatal("expected nil for nil response")
	}
}

func TestParseRateLimitHeaders_RetryAfterSeconds(t *testing.T) {
	resp := &http.Response{
		StatusCode: 429,
		Header: http.Header{
			"Retry-After": []string{"5"},
		},
	}
	rl := ParseRateLimitHeaders(resp)
	if rl == nil {
		t.Fatal("expected rate limit error")
	}
	if rl.RetryAfter != 5*time.Second {
		t.Fatalf("expected 5s retry-after, got %s", rl.RetryAfter)
	}
}

func TestParseRateLimitHeaders_RetryAfterFloat(t *testing.T) {
	resp := &http.Response{
		StatusCode: 429,
		Header: http.Header{
			"Retry-After": []string{"2.5"},
		},
	}
	rl := ParseRateLimitHeaders(resp)
	if rl == nil {
		t.Fatal("expected rate limit error")
	}
	if rl.RetryAfter != time.Duration(2.5*float64(time.Second)) {
		t.Fatalf("expected 2.5s retry-after, got %s", rl.RetryAfter)
	}
}

func TestParseRateLimitHeaders_XRateLimitResetISO(t *testing.T) {
	future := time.Now().Add(30 * time.Second).UTC().Format(time.RFC3339)
	resp := &http.Response{
		StatusCode: 429,
		Header: http.Header{
			"X-Ratelimit-Reset": []string{future},
		},
	}
	rl := ParseRateLimitHeaders(resp)
	if rl == nil {
		t.Fatal("expected rate limit error")
	}
	if rl.RetryAfter < 25*time.Second || rl.RetryAfter > 35*time.Second {
		t.Fatalf("expected ~30s retry-after from ISO timestamp, got %s", rl.RetryAfter)
	}
}

func TestParseRateLimitHeaders_DefaultOneSec(t *testing.T) {
	resp := &http.Response{
		StatusCode: 429,
		Header:     http.Header{},
	}
	rl := ParseRateLimitHeaders(resp)
	if rl == nil {
		t.Fatal("expected rate limit error")
	}
	if rl.RetryAfter != time.Second {
		t.Fatalf("expected 1s default retry-after, got %s", rl.RetryAfter)
	}
}

func TestCheckRateLimit_Sets429Fields(t *testing.T) {
	resp := &http.Response{
		StatusCode: 429,
		Header: http.Header{
			"Retry-After": []string{"10"},
		},
	}
	bodyErr := fmt.Errorf("too many requests")
	rl := CheckRateLimit("anthropic", resp, bodyErr)
	if rl == nil {
		t.Fatal("expected rate limit error")
	}
	if rl.Provider != "anthropic" {
		t.Fatalf("expected provider=anthropic, got %q", rl.Provider)
	}
	if rl.RetryAfter != 10*time.Second {
		t.Fatalf("expected 10s retry-after, got %s", rl.RetryAfter)
	}
	if rl.Underlying != bodyErr {
		t.Fatal("expected underlying error to be set")
	}
}

func TestCheckRateLimit_NonRateLimited(t *testing.T) {
	resp := &http.Response{StatusCode: 500, Header: http.Header{}}
	rl := CheckRateLimit("openai", resp, fmt.Errorf("server error"))
	if rl != nil {
		t.Fatal("expected nil for non-429")
	}
}

func TestParseDurationish(t *testing.T) {
	tests := []struct {
		input string
		want  time.Duration
	}{
		{"1s", time.Second},
		{"2m30s", 2*time.Minute + 30*time.Second},
		{"500ms", 500 * time.Millisecond},
		{"3.5", 3500 * time.Millisecond},
		{"invalid", 0},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := parseDurationish(tt.input)
			if got != tt.want {
				t.Fatalf("parseDurationish(%q) = %s, want %s", tt.input, got, tt.want)
			}
		})
	}
}
