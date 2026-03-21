// Error recovery with exponential backoff and jitter for transient LLM API failures.
package provider

import (
	"context"
	"errors"
	"fmt"
	"math"
	"math/rand"
	"strings"
	"time"
)

// RetryConfig controls retry behavior for transient errors.
type RetryConfig struct {
	MaxRetries     int           // Maximum number of retry attempts (0 = no retries).
	InitialDelay   time.Duration // Base delay before the first retry.
	MaxDelay       time.Duration // Upper bound on backoff delay.
	JitterFraction float64       // Fraction of delay to randomise (0.0–1.0).
}

// DefaultRetryConfig returns a production-ready retry configuration.
func DefaultRetryConfig() RetryConfig {
	return RetryConfig{
		MaxRetries:     3,
		InitialDelay:   1 * time.Second,
		MaxDelay:       30 * time.Second,
		JitterFraction: 0.25,
	}
}

// transientStatusCodes are HTTP status codes that indicate a retryable error.
var transientStatusCodes = map[int]bool{
	429: true, // Too Many Requests
	500: true, // Internal Server Error
	502: true, // Bad Gateway
	503: true, // Service Unavailable
	504: true, // Gateway Timeout
}

// IsTransient reports whether an error is transient and worth retrying.
// It checks for known HTTP status codes in the error message and context
// deadline/timeout errors.
func IsTransient(err error) bool {
	if err == nil {
		return false
	}

	// Context cancelled is NOT transient — the caller gave up.
	if errors.Is(err, context.Canceled) {
		return false
	}

	// Context deadline exceeded IS transient (timeout).
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}

	msg := err.Error()

	// Check for HTTP status codes embedded in error strings.
	for code := range transientStatusCodes {
		if strings.Contains(msg, fmt.Sprintf("%d", code)) {
			return true
		}
	}

	// Common network-level transient patterns.
	transientPatterns := []string{
		"connection refused",
		"connection reset",
		"timeout",
		"temporary failure",
		"EOF",
		"broken pipe",
		"no such host", // DNS blip
	}
	lower := strings.ToLower(msg)
	for _, p := range transientPatterns {
		if strings.Contains(lower, strings.ToLower(p)) {
			return true
		}
	}

	return false
}

// Retry calls fn up to cfg.MaxRetries+1 times (1 initial + retries), backing
// off exponentially with jitter between attempts. Only transient errors trigger
// a retry; permanent errors are returned immediately.
func Retry[T any](ctx context.Context, fn func(ctx context.Context) (T, error), cfg RetryConfig) (T, error) {
	var zero T

	result, err := fn(ctx)
	if err == nil {
		return result, nil
	}

	if !IsTransient(err) {
		return zero, err
	}

	var lastErr error = err

	for attempt := 1; attempt <= cfg.MaxRetries; attempt++ {
		delay := backoff(attempt, cfg)

		select {
		case <-ctx.Done():
			return zero, fmt.Errorf("retry aborted after %d attempts: %w (last error: %v)", attempt, ctx.Err(), lastErr)
		case <-time.After(delay):
		}

		result, err = fn(ctx)
		if err == nil {
			return result, nil
		}
		lastErr = err

		if !IsTransient(err) {
			return zero, err
		}
	}

	return zero, fmt.Errorf("all %d retries exhausted: %w", cfg.MaxRetries, lastErr)
}

// backoff computes the delay for the given attempt (1-indexed) using
// exponential backoff capped at cfg.MaxDelay, then applies jitter.
func backoff(attempt int, cfg RetryConfig) time.Duration {
	delay := float64(cfg.InitialDelay) * math.Pow(2, float64(attempt-1))
	if delay > float64(cfg.MaxDelay) {
		delay = float64(cfg.MaxDelay)
	}

	if cfg.JitterFraction > 0 {
		jitter := delay * cfg.JitterFraction
		delay = delay - jitter + rand.Float64()*2*jitter
	}

	if delay < 0 {
		delay = 0
	}

	return time.Duration(delay)
}
