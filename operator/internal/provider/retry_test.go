package provider

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestIsTransient(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{"nil", nil, false},
		{"429 rate limit", fmt.Errorf("anthropic API error 429: rate limited"), true},
		{"500 server error", fmt.Errorf("API error 500: internal"), true},
		{"502 bad gateway", fmt.Errorf("error 502: bad gateway"), true},
		{"503 unavailable", fmt.Errorf("service 503"), true},
		{"504 timeout", fmt.Errorf("gateway 504 timeout"), true},
		{"context deadline", context.DeadlineExceeded, true},
		{"context cancelled", context.Canceled, false},
		{"connection refused", fmt.Errorf("dial tcp: connection refused"), true},
		{"connection reset", fmt.Errorf("connection reset by peer"), true},
		{"timeout string", fmt.Errorf("request timeout"), true},
		{"EOF", fmt.Errorf("unexpected EOF"), true},
		{"auth error 401", fmt.Errorf("401 unauthorized"), false},
		{"bad request 400", fmt.Errorf("400 bad request"), false},
		{"random error", fmt.Errorf("something broke"), false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := IsTransient(tt.err)
			if got != tt.want {
				t.Errorf("IsTransient(%v) = %v, want %v", tt.err, got, tt.want)
			}
		})
	}
}

func TestRetrySuccess(t *testing.T) {
	ctx := context.Background()
	cfg := RetryConfig{
		MaxRetries:     3,
		InitialDelay:   1 * time.Millisecond,
		MaxDelay:       10 * time.Millisecond,
		JitterFraction: 0,
	}

	var calls atomic.Int32
	fn := func(ctx context.Context) (string, error) {
		calls.Add(1)
		return "ok", nil
	}

	result, err := Retry(ctx, fn, cfg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result != "ok" {
		t.Fatalf("expected 'ok', got %q", result)
	}
	if calls.Load() != 1 {
		t.Fatalf("expected 1 call, got %d", calls.Load())
	}
}

func TestRetryTransientThenSuccess(t *testing.T) {
	ctx := context.Background()
	cfg := RetryConfig{
		MaxRetries:     3,
		InitialDelay:   1 * time.Millisecond,
		MaxDelay:       10 * time.Millisecond,
		JitterFraction: 0,
	}

	var calls atomic.Int32
	fn := func(ctx context.Context) (string, error) {
		n := calls.Add(1)
		if n < 3 {
			return "", fmt.Errorf("API error 503: service unavailable")
		}
		return "recovered", nil
	}

	result, err := Retry(ctx, fn, cfg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result != "recovered" {
		t.Fatalf("expected 'recovered', got %q", result)
	}
	if calls.Load() != 3 {
		t.Fatalf("expected 3 calls, got %d", calls.Load())
	}
}

func TestRetryExhausted(t *testing.T) {
	ctx := context.Background()
	cfg := RetryConfig{
		MaxRetries:     2,
		InitialDelay:   1 * time.Millisecond,
		MaxDelay:       10 * time.Millisecond,
		JitterFraction: 0,
	}

	var calls atomic.Int32
	fn := func(ctx context.Context) (int, error) {
		calls.Add(1)
		return 0, fmt.Errorf("API error 500: internal server error")
	}

	_, err := Retry(ctx, fn, cfg)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !strings.Contains(err.Error(), "retries exhausted") {
		t.Fatalf("expected 'retries exhausted' error, got: %v", err)
	}
	// 1 initial + 2 retries = 3
	if calls.Load() != 3 {
		t.Fatalf("expected 3 calls, got %d", calls.Load())
	}
}

func TestRetryPermanentError(t *testing.T) {
	ctx := context.Background()
	cfg := RetryConfig{
		MaxRetries:     3,
		InitialDelay:   1 * time.Millisecond,
		MaxDelay:       10 * time.Millisecond,
		JitterFraction: 0,
	}

	var calls atomic.Int32
	fn := func(ctx context.Context) (string, error) {
		calls.Add(1)
		return "", fmt.Errorf("401 unauthorized: bad API key")
	}

	_, err := Retry(ctx, fn, cfg)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	// Should NOT retry — permanent error
	if calls.Load() != 1 {
		t.Fatalf("expected 1 call (no retries for permanent error), got %d", calls.Load())
	}
}

func TestRetryContextCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cfg := RetryConfig{
		MaxRetries:     5,
		InitialDelay:   100 * time.Millisecond,
		MaxDelay:       1 * time.Second,
		JitterFraction: 0,
	}

	var calls atomic.Int32
	fn := func(ctx context.Context) (string, error) {
		n := calls.Add(1)
		if n == 1 {
			// Cancel context after first transient failure
			cancel()
		}
		return "", fmt.Errorf("API error 503: unavailable")
	}

	_, err := Retry(ctx, fn, cfg)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context.Canceled in error chain, got: %v", err)
	}
}

func TestDefaultRetryConfig(t *testing.T) {
	cfg := DefaultRetryConfig()
	if cfg.MaxRetries != 3 {
		t.Fatalf("expected 3 retries, got %d", cfg.MaxRetries)
	}
	if cfg.InitialDelay != 1*time.Second {
		t.Fatalf("expected 1s initial delay, got %v", cfg.InitialDelay)
	}
	if cfg.MaxDelay != 30*time.Second {
		t.Fatalf("expected 30s max delay, got %v", cfg.MaxDelay)
	}
	if cfg.JitterFraction != 0.25 {
		t.Fatalf("expected 0.25 jitter, got %f", cfg.JitterFraction)
	}
}

func TestBackoff(t *testing.T) {
	cfg := RetryConfig{
		InitialDelay:   100 * time.Millisecond,
		MaxDelay:       5 * time.Second,
		JitterFraction: 0,
	}

	// Attempt 1: 100ms
	d1 := backoff(1, cfg)
	if d1 != 100*time.Millisecond {
		t.Fatalf("attempt 1: expected 100ms, got %v", d1)
	}

	// Attempt 2: 200ms
	d2 := backoff(2, cfg)
	if d2 != 200*time.Millisecond {
		t.Fatalf("attempt 2: expected 200ms, got %v", d2)
	}

	// Attempt 3: 400ms
	d3 := backoff(3, cfg)
	if d3 != 400*time.Millisecond {
		t.Fatalf("attempt 3: expected 400ms, got %v", d3)
	}

	// Very high attempt should cap at MaxDelay
	d10 := backoff(20, cfg)
	if d10 > cfg.MaxDelay {
		t.Fatalf("attempt 20: expected <= %v, got %v", cfg.MaxDelay, d10)
	}
}

func TestBackoffWithJitter(t *testing.T) {
	cfg := RetryConfig{
		InitialDelay:   100 * time.Millisecond,
		MaxDelay:       5 * time.Second,
		JitterFraction: 0.5,
	}

	// With 50% jitter, attempt 1 (base 100ms) should be between 50ms and 150ms
	for i := 0; i < 50; i++ {
		d := backoff(1, cfg)
		if d < 50*time.Millisecond || d > 150*time.Millisecond {
			t.Fatalf("backoff with jitter out of range: %v (expected 50ms-150ms)", d)
		}
	}
}
