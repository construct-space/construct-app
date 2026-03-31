package provider

import (
	"testing"
	"time"
)

func TestUsageTotal(t *testing.T) {
	tests := []struct {
		name  string
		usage Usage
		want  int
	}{
		{
			name:  "input plus output",
			usage: Usage{InputTokens: 100, OutputTokens: 50},
			want:  150,
		},
		{
			name:  "explicit total takes precedence",
			usage: Usage{InputTokens: 100, OutputTokens: 50, TotalTokens: 200},
			want:  200,
		},
		{
			name:  "zero values",
			usage: Usage{},
			want:  0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.usage.Total(); got != tt.want {
				t.Fatalf("Usage.Total() = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestRateLimitErrorFormat(t *testing.T) {
	tests := []struct {
		name string
		err  RateLimitError
		want string
	}{
		{
			name: "with retry after",
			err: RateLimitError{
				Provider:   "anthropic",
				RetryAfter: 5 * time.Second,
				Underlying: &testError{"too many requests"},
			},
			want: "anthropic rate limited, retry after 5s: too many requests",
		},
		{
			name: "without retry after",
			err: RateLimitError{
				Provider:   "openai",
				Underlying: &testError{"429"},
			},
			want: "openai rate limited: 429",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.err.Error(); got != tt.want {
				t.Fatalf("RateLimitError.Error() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestRateLimitErrorUnwrap(t *testing.T) {
	inner := &testError{"underlying"}
	err := &RateLimitError{Provider: "test", Underlying: inner}
	if err.Unwrap() != inner {
		t.Fatal("Unwrap should return the underlying error")
	}
}

func TestCapabilitiesStruct(t *testing.T) {
	caps := Capabilities{
		SupportsStructuredOutput: true,
		SupportsTools:            true,
		SupportsStreaming:         true,
		MaxContextTokens:         200000,
	}
	if !caps.SupportsStructuredOutput {
		t.Fatal("expected SupportsStructuredOutput to be true")
	}
	if !caps.SupportsTools {
		t.Fatal("expected SupportsTools to be true")
	}
	if !caps.SupportsStreaming {
		t.Fatal("expected SupportsStreaming to be true")
	}
	if caps.MaxContextTokens != 200000 {
		t.Fatalf("expected MaxContextTokens=200000, got %d", caps.MaxContextTokens)
	}
}

type testError struct {
	msg string
}

func (e *testError) Error() string { return e.msg }
