# Prompt Cache — Claude Code vs Construct

  What Claude Code does:

  - System prompt split into static (cacheable) + dynamic (per-turn) sections
  - Explicit cache boundary between them (API caches the static prefix, 1-hour TTL)
  - cache_edits: surgical server-side edits that don't break the cache prefix
  - Break detection: tracks when the cache prefix changes and tokens are wasted
  - Ephemeral cache_control markers on last system prompt block (for OAuth)
  - Static section: role instructions, tool guidelines, coding rules, style rules
  - Dynamic section: CLAUDE.md files, environment info, git status, date, memory

  How it is now:

  ┌────┬───────────────────────────────┬──────────────────────────────────────────────────┬──────────────────────────┐
  │  # │ What we built                 │ How it works                                     │ File                     │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  1 │ Static/dynamic split          │ SplitSystemPrompt() finds earliest dynamic       │ runner/system_prompt_    │
  │    │                               │ marker (## Project Context, ## Files accessed,   │ cache.go                 │
  │    │                               │ ## Memory, ## Sub-Agent:, etc.). Everything      │                          │
  │    │                               │ before = static (cacheable), after = dynamic.    │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  2 │ Hash-based break detection    │ SHA256 hash of static portion. StaticChanged()   │ runner/system_prompt_    │
  │    │                               │ compares against previous hash. Detects when     │ cache.go                 │
  │    │                               │ stable instructions change unexpectedly.          │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  3 │ Cache boundary marker         │ CacheBoundary() returns "<!-- cache_boundary -->"│ runner/system_prompt_    │
  │    │                               │ comment. RebuildWithBoundary() inserts it between│ cache.go                 │
  │    │                               │ static and dynamic sections.                     │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  4 │ Prompt cache tracker          │ PromptCacheTracker.Track() records each turn's   │ runner/system_prompt_    │
  │    │                               │ hash. Returns (broke, reason) when static part   │ cache.go                 │
  │    │                               │ changed. Stats() returns (turns, breaks).        │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  5 │ Full cache break detector     │ CacheBreakDetector.Check() hashes system prompt  │ coder/cache_detect.go    │
  │    │                               │ + tool schemas. Detects 3 break causes: system   │                          │
  │    │                               │ prompt changed, tools changed, TTL expired (no   │                          │
  │    │                               │ reads + large write). Tracks hit rate + history.  │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  6 │ TTL expiry detection          │ ShouldPreClear(): if idle > 5min (Anthropic      │ coder/cache_detect.go    │
  │    │                               │ default TTL), cache has expired. Worth clearing   │                          │
  │    │                               │ stale content before next API call.               │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  7 │ OAuth cache_control           │ buildOAuthSystemPrompt() creates array-format    │ connectors/              │
  │    │                               │ system with cache_control: ephemeral on last     │ anthropic_oauth.go       │
  │    │                               │ block. Enables API-side prompt caching.           │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  8 │ Human-readable summary        │ Summary() returns "Cache: N/N hits (X%), N       │ coder/cache_detect.go    │
  │    │                               │ breaks". History capped at 100 events (trimmed   │                          │
  │    │                               │ to 50 when exceeded).                            │                          │
  └────┴───────────────────────────────┴──────────────────────────────────────────────────┴──────────────────────────┘

  The 2 gaps — Claude Code vs Construct:

  ┌─────┬──────────────────────┬────────┬──────────────────────────────────────────┬────────────────────────────┐
  │  #  │        Gap           │ Impact │            What they do                  │       What we do           │
  ├─────┼──────────────────────┼────────┼──────────────────────────────────────────┼────────────────────────────┤
  │  1  │ cache_edits pinning  │ High   │ API-level: send edit operations to       │ Client-side compaction     │
  │     │                      │        │ surgically remove stale content without  │ rewrites the message       │
  │     │                      │        │ changing the cached prefix. Zero cost    │ array, which may break     │
  │     │                      │        │ compaction.                              │ the prefix cache.          │
  ├─────┼──────────────────────┼────────┼──────────────────────────────────────────┼────────────────────────────┤
  │  2  │ Dynamic marker       │ Low    │ Fine-grained control over which sections │ Marker-based split works   │
  │     │ granularity          │        │ are cache-pinned vs ephemeral.           │ well but is string-based.  │
  │     │                      │        │                                          │ Adding new dynamic         │
  │     │                      │        │                                          │ sections requires updating │
  │     │                      │        │                                          │ the marker list.           │
  └─────┴──────────────────────┴────────┴──────────────────────────────────────────┴────────────────────────────┘

---

## Problem → Solution Log

### Static/dynamic split — DONE
**Problem:** Entire system prompt rebuilt every turn. API re-ingested 10K+ tokens of stable instructions that never changed, wasting money.
**Solution:** `SplitSystemPrompt()` scans for dynamic markers (## Project Context, ## Files accessed, ## Memory, ## Sub-Agent:, ## Active UI Context, ## Runtime Context, ## Instructions from, ## Available Skills). Everything before the earliest marker is static (cacheable). SHA256 hash of the static part enables break detection. `RebuildWithBoundary()` inserts an HTML comment boundary between sections.
**Files:** `runner/system_prompt_cache.go`

### Cache break detection — DONE
**Problem:** No way to know when prompt cache was broken. Silent cost increase when system prompt or tool schemas changed.
**Solution:** Two-level detection: `PromptCacheTracker` tracks static hash per turn (lightweight, in runner). `CacheBreakDetector` hashes both system prompt and tool schemas, detects 3 causes: prompt change, tools change, TTL expiry (inferred from 0 reads + large write). Tracks hit rate and break count over session.
**Files:** `runner/system_prompt_cache.go`, `coder/cache_detect.go`

### OAuth ephemeral cache_control — DONE
**Problem:** OAuth path requires array-format system prompt. Cache control must be on the last block for API-side caching.
**Solution:** `buildOAuthSystemPrompt()` creates `[{type: "text", text: required_prefix}, {type: "text", text: actual_prompt, cache_control: {type: "ephemeral"}}]`. If no additional system prompt, the ephemeral marker goes on the first (only) block.
**Files:** `connectors/anthropic_oauth.go`

### TTL-aware pre-clearing — DONE
**Problem:** After 5+ minutes idle, the API cache has expired. Sending stale tool results wastes the new cache write.
**Solution:** `ShouldPreClear(idleSince, cacheTTL)` returns true if idle longer than cache TTL (default 5 min). Combined with microcompact: clear old results before the next API call so the fresh cache write is smaller and more useful.
**Files:** `coder/cache_detect.go`
