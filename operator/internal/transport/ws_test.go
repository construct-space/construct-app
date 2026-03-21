package transport

import (
	"testing"
)

func TestComputeAcceptKey(t *testing.T) {
	key := "dGhlIHNhbXBsZSBub25jZQ=="
	got := computeAcceptKey(key)
	want := "oaMi3hzjas62i/BuwYpSNXwtj5s="
	if got != want {
		t.Fatalf("computeAcceptKey(%q) = %q, want %q", key, got, want)
	}
}

func TestIsStreamRequest(t *testing.T) {
	s := &WSServer{}
	tests := []struct {
		input string
		want  bool
	}{
		{"agents.dispatch_stream", true},
		{"ai.chat_stream", true},
		{"system.ping", false},
		{"stream", false},
		{"_stream", false},
	}
	for _, tt := range tests {
		got := s.isStreamRequest(tt.input)
		if got != tt.want {
			t.Errorf("isStreamRequest(%q) = %v, want %v", tt.input, got, tt.want)
		}
	}
}
