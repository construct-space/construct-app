package helpers

import "testing"

func TestSanitizeToolNameRoundTrip(t *testing.T) {
	tests := []struct {
		name string
	}{
		{name: "write_file"},
		{name: "space.snapshot"},
		{name: "mcp-github-list/files"},
		{name: "tool (preview)"},
		{name: "naive cafe"},
	}

	for _, tt := range tests {
		sanitized := SanitizeToolName(tt.name)
		if sanitized == "" {
			t.Fatalf("expected sanitized name for %q", tt.name)
		}
		for i := 0; i < len(sanitized); i++ {
			ch := sanitized[i]
			if !isAllowedToolNameChar(ch) {
				t.Fatalf("sanitized name %q contains invalid char %q", sanitized, ch)
			}
		}
		if got := UnsanitizeToolName(sanitized); got != tt.name {
			t.Fatalf("round-trip mismatch: got %q want %q", got, tt.name)
		}
	}
}
