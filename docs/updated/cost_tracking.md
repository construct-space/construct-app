# Cost Tracking — Claude Code vs Construct

  What Claude Code does:

  - Per-token-type tracking: input, output, cache_write, cache_read (4 token buckets)
  - USD cost calculation with per-model pricing tables
  - Budget warnings at configurable thresholds
  - Diminishing returns detection: 3 low-delta turns in a row triggers stop
  - Budget check after each turn (90% threshold), stops loop if exceeded
  - Session cost summaries in status bar
  - Model-specific pricing (Opus vs Sonnet vs Haiku different rates)

  How it is now:

  ┌────┬───────────────────────────────┬──────────────────────────────────────────────────┬──────────────────────────┐
  │  # │ What we built                 │ How it works                                     │ File                     │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  1 │ 4-bucket token tracking       │ Record(input, output, cacheWrite, cacheRead)     │ coder/cost.go            │
  │    │                               │ per API call. Cumulative counters. Per-turn       │                          │
  │    │                               │ deltas stored in turns[] slice.                   │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  2 │ USD cost calculation          │ costUSD() = sum of (tokens * price/1M) across    │ coder/cost.go            │
  │    │                               │ all 4 types. Default pricing: Sonnet 4 rates     │                          │
  │    │                               │ ($3/15/3.75/0.30 per 1M).                        │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  3 │ Budget enforcement            │ WithBudget(maxUSD) sets limit. Status() returns  │ coder/cost.go            │
  │    │                               │ BudgetStatus with UsedPct, Warning (>=90%),      │                          │
  │    │                               │ Exceeded flags. Runner checks after each turn.    │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  4 │ Diminishing returns           │ IsDiminishingReturns(lookback, minDelta): checks │ coder/cost.go            │
  │    │                               │ if last N turns each had < minDelta output       │                          │
  │    │                               │ tokens. Default: 3 turns, 500 tokens.            │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  5 │ Cache hit rate                │ CacheHitRate() = cacheReadTokens / (input +      │ coder/cost.go            │
  │    │                               │ cacheRead). Higher = better caching. Included    │                          │
  │    │                               │ in Summary() output.                              │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  6 │ Milestone notifications       │ Budget milestones at 25%, 50%, 80%, 90%, 95%,   │ coder/runner_adapter.go  │
  │    │                               │ 100%. Each milestone emits a stream event once.  │ runner/runner.go         │
  │    │                               │ milestoneHit map prevents duplicate emissions.    │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  7 │ Human-readable summary        │ Summary() returns "Tokens: N input, N output,    │ coder/cost.go            │
  │    │                               │ N cache_read, N cache_write | Cost: $X.XXXX      │                          │
  │    │                               │ | Cache hit: N% | Budget: $X.XX (N% used)"      │                          │
  └────┴───────────────────────────────┴──────────────────────────────────────────────────┴──────────────────────────┘

  The 2 gaps — Claude Code vs Construct:

  ┌─────┬──────────────────────┬────────┬──────────────────────────────────────────┬────────────────────────────┐
  │  #  │        Gap           │ Impact │            What they do                  │       What we do           │
  ├─────┼──────────────────────┼────────┼──────────────────────────────────────────┼────────────────────────────┤
  │  1  │ Per-model pricing    │ Medium │ Each model has its own pricing table.    │ Single pricing table       │
  │     │                      │        │ Opus, Sonnet, Haiku all different rates. │ (Sonnet 4). Multi-provider │
  │     │                      │        │ OpenAI models have separate rates.       │ models use wrong rates.    │
  ├─────┼──────────────────────┼────────┼──────────────────────────────────────────┼────────────────────────────┤
  │  2  │ Model fallback on    │ Low    │ If Opus fails 3x with 529, falls back   │ We retry same model 3x     │
  │     │ repeated failures    │        │ to Sonnet automatically. Cost-aware      │ with backoff but no model  │
  │     │                      │        │ degradation.                             │ downgrade.                 │
  └─────┴──────────────────────┴────────┴──────────────────────────────────────────┴────────────────────────────┘

---

## Problem → Solution Log

### Per-token-type tracking — DONE
**Problem:** Flat "total tokens" counting missed cache savings. No way to see if caching was effective or how much money prompt cache was saving.
**Solution:** `CostTracker` with 4 separate counters: InputTokens, OutputTokens, CacheWriteTokens, CacheReadTokens. Each API response calls `Record()` with all 4 values. Cache read tokens cost 10x less than input tokens, so this matters for cost accuracy.
**Files:** `coder/cost.go`

### Budget enforcement in runner loop — DONE
**Problem:** CostTracker existed but the runner didn't check it. Sessions could run indefinitely, burning money.
**Solution:** Runner checks `ShouldAutoContinue()` after each turn. Budget milestones at 25/50/80/90/95/100% emit stream events. At 100%, the loop stops. Combined with diminishing returns detection (3 turns with < 500 token delta = spinning).
**Files:** `runner/runner.go`, `coder/runner_adapter.go`

### Cache hit rate tracking — DONE
**Problem:** No way to know if prompt cache was working. Users couldn't tell if their system prompt changes were causing expensive cache misses.
**Solution:** `CacheHitRate()` = cache_read / (input + cache_read). Included in `Summary()` output and available to cache break detector. A dropping hit rate signals the static prompt is changing too often.
**Files:** `coder/cost.go`

### Milestone notifications — DONE
**Problem:** Users had no visibility into budget consumption during a session. They'd only find out after exceeding the limit.
**Solution:** `milestoneHit` map tracks which percentages have been notified. At each milestone (25/50/80/90/95/100%), emit a stream status event with cost summary. Frontend can display these as non-intrusive notifications.
**Files:** `coder/runner_adapter.go`, `coder/coder.go`
