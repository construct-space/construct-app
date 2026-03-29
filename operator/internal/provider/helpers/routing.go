// Model routing, cost tracking, and rate limiting for multi-provider intelligence.
package helpers

import (
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"construct-operator/internal/provider"
)

// ModelTier categorizes models by capability.
type ModelTier string

const (
	TierFast   ModelTier = "fast"   // Quick responses, lower cost (haiku, grok-mini)
	TierSmart  ModelTier = "smart"  // Balanced (sonnet, gpt-4o, deepseek-chat)
	TierPower  ModelTier = "power"  // Maximum capability (opus, o1)
	TierReason ModelTier = "reason" // Extended thinking (deepseek-reasoner)
)

// ModelInfo describes a model's capabilities and cost.
type ModelInfo struct {
	ID              string    `json:"id"`
	ProviderID      string    `json:"provider_id"`
	Tier            ModelTier `json:"tier"`
	InputCostPer1M  float64   `json:"input_cost_per_1m"`  // USD per 1M input tokens
	OutputCostPer1M float64   `json:"output_cost_per_1m"` // USD per 1M output tokens
	MaxTokens       int       `json:"max_tokens"`
}

// Known model costs (as of 2025)
var knownModels = map[string]ModelInfo{
	"claude-opus-4-6":           {Tier: TierPower, InputCostPer1M: 15.0, OutputCostPer1M: 75.0, MaxTokens: 32000},
	"claude-sonnet-4-6":         {Tier: TierSmart, InputCostPer1M: 3.0, OutputCostPer1M: 15.0, MaxTokens: 64000},
	"claude-haiku-4-5-20251001": {Tier: TierFast, InputCostPer1M: 0.80, OutputCostPer1M: 4.0, MaxTokens: 8192},
	"deepseek-chat":             {Tier: TierSmart, InputCostPer1M: 0.27, OutputCostPer1M: 1.10, MaxTokens: 8192},
	"deepseek-reasoner":         {Tier: TierReason, InputCostPer1M: 0.55, OutputCostPer1M: 2.19, MaxTokens: 8192},
	"grok-3":                    {Tier: TierPower, InputCostPer1M: 3.0, OutputCostPer1M: 15.0, MaxTokens: 131072},
	"grok-3-mini":               {Tier: TierFast, InputCostPer1M: 0.30, OutputCostPer1M: 0.50, MaxTokens: 131072},
}

// GetModelInfo returns info about a model (or a default).
func GetModelInfo(modelID string) ModelInfo {
	if info, ok := knownModels[modelID]; ok {
		info.ID = modelID
		return info
	}
	// Default: assume smart tier, moderate cost
	return ModelInfo{
		ID:              modelID,
		Tier:            TierSmart,
		InputCostPer1M:  3.0,
		OutputCostPer1M: 15.0,
		MaxTokens:       8192,
	}
}

// PickModelForTask selects the best model tier based on task complexity.
func PickModelForTask(task string) ModelTier {
	lower := strings.ToLower(task)

	// Simple tasks → fast model
	simplePatterns := []string{
		"what is", "explain", "summarize", "translate",
		"list ", "show me", "how do i", "format",
	}
	for _, p := range simplePatterns {
		if strings.HasPrefix(lower, p) {
			return TierFast
		}
	}

	// Complex tasks → power model
	complexPatterns := []string{
		"refactor", "architect", "design system", "review all",
		"analyze the entire", "comprehensive", "multi-step",
	}
	for _, p := range complexPatterns {
		if strings.Contains(lower, p) {
			return TierPower
		}
	}

	// Reasoning tasks
	if strings.Contains(lower, "prove") || strings.Contains(lower, "reason about") ||
		strings.Contains(lower, "think step by step") {
		return TierReason
	}

	return TierSmart
}

// --- Cost Tracking ---

// CostTracker tracks token usage and estimated costs.
type CostTracker struct {
	mu       sync.RWMutex
	sessions map[string]*SessionCost
	daily    map[string]*DailyCost // key: "2025-01-15"
}

// SessionCost tracks costs for a single session.
type SessionCost struct {
	SessionID    string  `json:"session_id"`
	ProviderID   string  `json:"provider_id"`
	Model        string  `json:"model"`
	InputTokens  int64   `json:"input_tokens"`
	OutputTokens int64   `json:"output_tokens"`
	EstCostUSD   float64 `json:"est_cost_usd"`
}

// DailyCost aggregates costs for a day.
type DailyCost struct {
	Date         string  `json:"date"`
	InputTokens  int64   `json:"input_tokens"`
	OutputTokens int64   `json:"output_tokens"`
	EstCostUSD   float64 `json:"est_cost_usd"`
	Requests     int64   `json:"requests"`
}

func NewCostTracker() *CostTracker {
	return &CostTracker{
		sessions: make(map[string]*SessionCost),
		daily:    make(map[string]*DailyCost),
	}
}

// Track records token usage for a session.
func (ct *CostTracker) Track(sessionID, providerID, model string, usage provider.Usage) {
	info := GetModelInfo(model)
	cost := (float64(usage.InputTokens) / 1_000_000 * info.InputCostPer1M) +
		(float64(usage.OutputTokens) / 1_000_000 * info.OutputCostPer1M)

	ct.mu.Lock()
	defer ct.mu.Unlock()

	// Update session cost
	sc, ok := ct.sessions[sessionID]
	if !ok {
		sc = &SessionCost{SessionID: sessionID, ProviderID: providerID, Model: model}
		ct.sessions[sessionID] = sc
	}
	sc.InputTokens += int64(usage.InputTokens)
	sc.OutputTokens += int64(usage.OutputTokens)
	sc.EstCostUSD += cost

	// Update daily cost
	today := time.Now().Format("2006-01-02")
	dc, ok := ct.daily[today]
	if !ok {
		dc = &DailyCost{Date: today}
		ct.daily[today] = dc
	}
	dc.InputTokens += int64(usage.InputTokens)
	dc.OutputTokens += int64(usage.OutputTokens)
	dc.EstCostUSD += cost
	dc.Requests++
}

// GetSessionCost returns the cost for a session.
func (ct *CostTracker) GetSessionCost(sessionID string) *SessionCost {
	ct.mu.RLock()
	defer ct.mu.RUnlock()
	return ct.sessions[sessionID]
}

// GetDailyCost returns the cost for today.
func (ct *CostTracker) GetDailyCost() *DailyCost {
	ct.mu.RLock()
	defer ct.mu.RUnlock()
	today := time.Now().Format("2006-01-02")
	return ct.daily[today]
}

// TotalCost returns the total estimated cost across all sessions.
func (ct *CostTracker) TotalCost() float64 {
	ct.mu.RLock()
	defer ct.mu.RUnlock()
	var total float64
	for _, sc := range ct.sessions {
		total += sc.EstCostUSD
	}
	return total
}

// --- Rate Limiting ---

// RateLimiter provides per-provider rate limiting.
type RateLimiter struct {
	mu       sync.Mutex
	limiters map[string]*tokenBucket
}

type tokenBucket struct {
	tokens     atomic.Int64
	maxTokens  int64
	refillRate int64 // tokens per second
	lastRefill time.Time
}

func NewRateLimiter() *RateLimiter {
	return &RateLimiter{
		limiters: make(map[string]*tokenBucket),
	}
}

// SetLimit configures rate limiting for a provider.
func (rl *RateLimiter) SetLimit(providerID string, requestsPerMinute int) {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	maxTokens := int64(requestsPerMinute)
	refillRate := maxTokens / 60
	if refillRate < 1 {
		refillRate = 1
	}

	tb := &tokenBucket{
		maxTokens:  maxTokens,
		refillRate: refillRate,
		lastRefill: time.Now(),
	}
	tb.tokens.Store(maxTokens)
	rl.limiters[providerID] = tb
}

// Allow checks if a request is allowed for the given provider.
// Returns true if allowed, false if rate limited.
func (rl *RateLimiter) Allow(providerID string) bool {
	rl.mu.Lock()
	tb, ok := rl.limiters[providerID]
	rl.mu.Unlock()

	if !ok {
		return true // no limit configured
	}

	// Refill tokens
	now := time.Now()
	elapsed := now.Sub(tb.lastRefill)
	refill := int64(elapsed.Seconds()) * tb.refillRate
	if refill > 0 {
		current := tb.tokens.Load()
		newTokens := current + refill
		if newTokens > tb.maxTokens {
			newTokens = tb.maxTokens
		}
		tb.tokens.Store(newTokens)
		tb.lastRefill = now
	}

	// Try to take a token
	for {
		current := tb.tokens.Load()
		if current <= 0 {
			return false
		}
		if tb.tokens.CompareAndSwap(current, current-1) {
			return true
		}
	}
}

// WaitString returns a human-readable wait time for the rate limiter.
func (rl *RateLimiter) WaitString(providerID string) string {
	rl.mu.Lock()
	tb, ok := rl.limiters[providerID]
	rl.mu.Unlock()

	if !ok || tb.tokens.Load() > 0 {
		return ""
	}

	waitSeconds := 1.0 / float64(tb.refillRate)
	return fmt.Sprintf("rate limited, retry in %.1fs", waitSeconds)
}

// --- Fallback Chain ---

// FallbackChain defines a sequence of providers to try.
type FallbackChain struct {
	Steps []FallbackStep `json:"steps"`
}

// FallbackStep is one step in a fallback chain.
type FallbackStep struct {
	ProviderID string `json:"provider_id"`
	Model      string `json:"model"`
}

// DefaultFallbackChain returns a reasonable default chain.
func DefaultFallbackChain() *FallbackChain {
	return &FallbackChain{
		Steps: []FallbackStep{
			{ProviderID: "anthropic-oauth", Model: "claude-sonnet-4-6"},
			{ProviderID: "anthropic", Model: "claude-sonnet-4-6"},
			{ProviderID: "deepseek", Model: "deepseek-chat"},
			{ProviderID: "xai", Model: "grok-3"},
		},
	}
}
