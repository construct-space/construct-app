package helpers

import (
	"testing"

	"construct-operator/internal/provider"
)

func TestGetModelInfo(t *testing.T) {
	info := GetModelInfo("claude-sonnet-4-6")
	if info.Tier != TierSmart {
		t.Fatalf("expected tier %q, got %q", TierSmart, info.Tier)
	}
	if info.InputCostPer1M != 3.0 {
		t.Fatalf("expected input cost 3.0, got %f", info.InputCostPer1M)
	}
}

func TestGetModelInfoUnknown(t *testing.T) {
	info := GetModelInfo("unknown-model")
	if info.Tier != TierSmart {
		t.Fatal("unknown model should default to smart tier")
	}
}

func TestPickModelForTask(t *testing.T) {
	tests := []struct {
		task string
		want ModelTier
	}{
		{"what is a goroutine?", TierFast},
		{"explain this function", TierFast},
		{"refactor the authentication module", TierPower},
		{"implement login", TierSmart},
		{"reason about the correctness", TierReason},
	}

	for _, tt := range tests {
		got := PickModelForTask(tt.task)
		if got != tt.want {
			t.Errorf("PickModelForTask(%q) = %q, want %q", tt.task, got, tt.want)
		}
	}
}

func TestCostTracker(t *testing.T) {
	ct := NewCostTracker()

	ct.Track("sess-1", "anthropic", "claude-sonnet-4-6", provider.Usage{
		InputTokens:  1000,
		OutputTokens: 500,
	})

	sc := ct.GetSessionCost("sess-1")
	if sc == nil {
		t.Fatal("should have session cost")
	}
	if sc.InputTokens != 1000 || sc.OutputTokens != 500 {
		t.Fatalf("token counts wrong: %d/%d", sc.InputTokens, sc.OutputTokens)
	}
	if sc.EstCostUSD <= 0 {
		t.Fatal("cost should be positive")
	}

	dc := ct.GetDailyCost()
	if dc == nil {
		t.Fatal("should have daily cost")
	}
	if dc.Requests != 1 {
		t.Fatalf("expected 1 request, got %d", dc.Requests)
	}
}

func TestCostTrackerMultipleSessions(t *testing.T) {
	ct := NewCostTracker()

	ct.Track("s1", "anthropic", "claude-sonnet-4-6", provider.Usage{InputTokens: 1000, OutputTokens: 500})
	ct.Track("s2", "deepseek", "deepseek-chat", provider.Usage{InputTokens: 2000, OutputTokens: 1000})

	total := ct.TotalCost()
	if total <= 0 {
		t.Fatal("total cost should be positive")
	}

	dc := ct.GetDailyCost()
	if dc.Requests != 2 {
		t.Fatalf("expected 2 requests, got %d", dc.Requests)
	}
}

func TestRateLimiter(t *testing.T) {
	rl := NewRateLimiter()
	rl.SetLimit("test-provider", 5) // 5 requests per minute

	// Should allow first few requests
	for i := 0; i < 5; i++ {
		if !rl.Allow("test-provider") {
			t.Fatalf("request %d should be allowed", i)
		}
	}

	// Should be rate limited now
	if rl.Allow("test-provider") {
		t.Fatal("should be rate limited after 5 requests")
	}
}

func TestRateLimiterNoLimit(t *testing.T) {
	rl := NewRateLimiter()
	// No limit configured — should always allow
	if !rl.Allow("unconfigured") {
		t.Fatal("should allow when no limit configured")
	}
}

func TestDefaultFallbackChain(t *testing.T) {
	chain := DefaultFallbackChain()
	if len(chain.Steps) == 0 {
		t.Fatal("default chain should have steps")
	}
	if chain.Steps[0].ProviderID != "anthropic-oauth" {
		t.Fatalf("first step should be anthropic-oauth, got %q", chain.Steps[0].ProviderID)
	}
}
