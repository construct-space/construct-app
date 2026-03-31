// Rate limit header parsing for LLM provider responses.
package helpers

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"construct-operator/internal/provider"
)

// ParseRateLimitHeaders extracts rate limit info from HTTP response headers.
// Handles standard retry-after, Anthropic x-ratelimit-*, and OpenAI x-ratelimit-* headers.
func ParseRateLimitHeaders(resp *http.Response) *provider.RateLimitError {
	if resp == nil || resp.StatusCode != 429 {
		return nil
	}

	retryAfter := parseRetryAfter(resp.Header)

	return &provider.RateLimitError{
		RetryAfter: retryAfter,
		Underlying: nil, // caller sets this
	}
}

// parseRetryAfter extracts a wait duration from response headers.
// Checks in order: retry-after, x-ratelimit-reset-ms, x-ratelimit-reset.
func parseRetryAfter(h http.Header) time.Duration {
	// Standard retry-after (seconds or HTTP date)
	if ra := h.Get("Retry-After"); ra != "" {
		ra = strings.TrimSpace(ra)
		if secs, err := strconv.ParseFloat(ra, 64); err == nil {
			return time.Duration(secs * float64(time.Second))
		}
		// Try HTTP date format
		if t, err := http.ParseTime(ra); err == nil {
			d := time.Until(t)
			if d > 0 {
				return d
			}
		}
	}

	// Anthropic-style: x-ratelimit-reset (ISO 8601 timestamp)
	if reset := h.Get("X-Ratelimit-Reset"); reset != "" {
		if t, err := time.Parse(time.RFC3339, strings.TrimSpace(reset)); err == nil {
			d := time.Until(t)
			if d > 0 {
				return d
			}
		}
	}

	// OpenAI-style: x-ratelimit-reset-requests or x-ratelimit-reset-tokens
	for _, key := range []string{"X-Ratelimit-Reset-Requests", "X-Ratelimit-Reset-Tokens"} {
		if val := h.Get(key); val != "" {
			if d := parseDurationish(strings.TrimSpace(val)); d > 0 {
				return d
			}
		}
	}

	// Default: suggest 1 second retry
	return time.Second
}

// parseDurationish parses duration strings like "1s", "2m30s", "500ms".
func parseDurationish(s string) time.Duration {
	d, err := time.ParseDuration(s)
	if err != nil {
		// Try as plain seconds
		if secs, err := strconv.ParseFloat(s, 64); err == nil {
			return time.Duration(secs * float64(time.Second))
		}
		return 0
	}
	return d
}

// CheckRateLimit inspects an HTTP response for 429 status and returns
// a RateLimitError if rate limited. The caller can then wait and retry.
func CheckRateLimit(providerName string, resp *http.Response, bodyErr error) *provider.RateLimitError {
	if resp == nil || resp.StatusCode != 429 {
		return nil
	}

	rl := ParseRateLimitHeaders(resp)
	rl.Provider = providerName
	rl.Underlying = bodyErr
	return rl
}
