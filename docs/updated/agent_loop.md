  What we do well (on par or close):

- Basic loop structure (LLM → tools → LLM)
- Parallel tool execution
- Stuck loop detection
- Auto-continue with diminishing returns
- Per-tool compaction with disk persistence
- Cost tracking
- Permission pre-hooks
- Provider fallback on auth errors

  How it is now (after feature/coder-module + feature/streaming-tool-execution):

  ┌────┬───────────────────────────────┬──────────────────────────────────────────────────┬──────────────────────────┐
  │  # │ What we built                 │ How it works                                     │ File                     │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  1 │ Streaming tool execution      │ Tools start during LLM stream, not after.        │ runner/streaming_        │
  │    │                               │ StreamingToolExecutor queues from tool_call_done  │ executor.go              │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  2 │ Per-tool concurrency          │ Safe (read,glob,grep,lsp) run parallel.           │ tool/concurrency.go      │
  │    │                               │ Exclusive (bash,write,edit) run alone.            │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  3 │ Smart context budget          │ Per-tool char limits. Over-budget → persist to    │ coder/context.go         │
  │    │                               │ disk, keep smart preview in context.              │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  4 │ File state tracking           │ Tracks reads/writes/edits. Injected into system   │ coder/filestate.go       │
  │    │                               │ prompt: "don't re-read files you already have"    │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  5 │ File read LRU cache           │ In-memory cache, mtime invalidation. Second       │ coder/filecache.go       │
  │    │                               │ read of same file is instant (no disk I/O).       │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  6 │ Permission layer              │ 4 modes: bypass/plan/accept_edits/default.        │ coder/permission.go      │
  │    │                               │ Pre-hook blocks disallowed tools. Space tools     │                          │
  │    │                               │ always safe.                                      │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  7 │ Cost tracking                 │ Per-token-type (input/output/cache_read/write).   │ coder/cost.go            │
  │    │                               │ USD budgets, diminishing returns detection.        │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  8 │ Prompt cache break detection  │ Hashes system prompt + tools. Detects changes     │ coder/cache_detect.go    │
  │    │                               │ and TTL expiry. Tracks hit rate.                  │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  9 │ Time-based microcompact       │ Clears stale tool results after idle session.     │ coder/microcompact.go    │
  │    │                               │ Keeps recent N turns intact.                      │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │ 10 │ Context analysis              │ Detects duplicate file reads, largest results,    │ coder/context_           │
  │    │                               │ waste. Generates recommendations.                 │ analysis.go              │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │ 11 │ Auto-continue + diminishing   │ Extends turn budget if productive. Stops if       │ coder/autocontinue.go    │
  │    │ returns                        │ 3 turns with <500 token delta.                    │ runner/runner.go         │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │ 12 │ Sub-agent system              │ Registry of specialists. Space sub-agent with     │ coder/subagent.go        │
  │    │                               │ full CLI knowledge. Auto-detect from task text.   │ coder/subagent_space.go  │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │ 13 │ Background task manager       │ Spawn async agents. Track progress. Check/cancel  │ coder/task.go            │
  │    │                               │ tools. Events: task.spawned/progress/complete.    │ coder/spawn_bg.go        │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │ 14 │ LSP integration               │ JSON-RPC 2.0 client. Auto-detects tsserver,      │ lsp/client.go            │
  │    │                               │ gopls, pylsp, rust-analyzer. Tools: diagnostics,  │ lsp/manager.go           │
  │    │                               │ definition, references.                           │ lsp/tools.go             │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │ 15 │ Session state                 │ Capture/restore file state, stored refs,          │ coder/session_state.go   │
  │    │                               │ permission mode for resume.                       │                          │
  └────┴───────────────────────────────┴──────────────────────────────────────────────────┴──────────────────────────┘

  The 10 things Claude Code does that we don't:

  ┌─────┬──────────────────┬────────┬─────────────────────────────────────────────────────┬────────────────────────┐
  │  #  │       Gap        │ Impact │                    What they do                     │       What we do       │
  ├─────┼──────────────────┼────────┼─────────────────────────────────────────────────────┼────────────────────────┤
  │     │ Streaming tool   │        │ Tools start executing while model is still          │ We wait for full       │
  │ 1   │ execution        │ Huge   │ streaming. StreamingToolExecutor queues tools as    │ response, then execute │
  │     │                  │        │ they arrive from the stream.                        │  all tools             │
  ├─────┼──────────────────┼────────┼─────────────────────────────────────────────────────┼────────────────────────┤
  │     │ Retry with       │        │ On 413 (context overflow): sends                    │                        │
  │ 2   │ native context   │ Huge   │ context_management.edits to API to clear stale tool │ We fail on 413, no 529 │
  │     │ clearing         │        │  results server-side. On 529: retries with backoff, │  retry                 │
  │     │                  │        │  falls back to non-streaming                        │                        │
  ├─────┼──────────────────┼────────┼─────────────────────────────────────────────────────┼────────────────────────┤
  │     │ Snip + context   │        │ Two-phase compression: snip boundaries (safe cut    │ We only have           │
  │ 3   │ collapse         │ High   │ points) + context collapse (replace ranges with     │ microcompact           │
  │     │                  │        │ summaries). Separate from microcompact              │ (time-based clearing)  │
  ├─────┼──────────────────┼────────┼─────────────────────────────────────────────────────┼────────────────────────┤
  │     │ Stop hooks +     │        │ After each turn: runs background tasks (memory      │ We do nothing between  │
  │ 4   │ speculation      │ High   │ extraction, prompt suggestions, skill prefetch)     │ turns except append    │
  │     │                  │        │ while loop continues                                │ messages               │
  ├─────┼──────────────────┼────────┼─────────────────────────────────────────────────────┼────────────────────────┤
  │     │ Inline           │        │ Tool can return ask_user → pauses, prompts user,    │ We check permissions   │
  │ 5   │ permission       │ High   │ resumes if approved. Mid-turn interactive approval  │ upfront only, deny if  │
  │     │ elicitation      │        │                                                     │ not allowed            │
  ├─────┼──────────────────┼────────┼─────────────────────────────────────────────────────┼────────────────────────┤
  │     │ Per-tool         │        │ Each tool declares isConcurrencySafe(input). Bash   │ We run all tools in    │
  │ 6   │ concurrency      │ Medium │ is always exclusive. Read/Grep can run parallel     │ parallel blindly       │
  │     │ control          │        │                                                     │                        │
  ├─────┼──────────────────┼────────┼─────────────────────────────────────────────────────┼────────────────────────┤
  │     │ Structured       │        │ SyntheticOutputTool forces JSON schema output,      │ We don't support       │
  │ 7   │ output with      │ Medium │ retries up to 5x on schema validation failure       │ structured outputs     │
  │     │ retry            │        │                                                     │                        │
  ├─────┼──────────────────┼────────┼─────────────────────────────────────────────────────┼────────────────────────┤
  │     │                  │        │ Checks token budget after each turn (90%            │ We have cost tracker   │
  │ 8   │ Token/USD budget │ Medium │ threshold), USD cost limit, diminishing returns     │ but don't use it as    │
  │     │  stopping        │        │ after 3 low-delta turns                             │ stop condition in the  │
  │     │                  │        │                                                     │ loop                   │
  ├─────┼──────────────────┼────────┼─────────────────────────────────────────────────────┼────────────────────────┤
  │     │ Sibling abort    │        │ Bash error → abort all sibling tools. Read error →  │ We use shared context  │
  │ 9   │ coordination     │ Medium │ don't cascade. Different abort semantics per tool   │ timeout for all        │
  │     │                  │        │ type                                                │                        │
  ├─────┼──────────────────┼────────┼─────────────────────────────────────────────────────┼────────────────────────┤
  │ 10  │ Streaming        │ Medium │ If streaming 529 → drops to Complete(), discards    │ We have no streaming   │
  │     │ fallback on 529  │        │ queued tools, retries immediately                   │ fallback               │
  └─────┴──────────────────┴────────┴─────────────────────────────────────────────────────┴────────────────────────┘

# Agent Loop — Detail

See `comparison.md` for the overall feature table vs Claude Code.

## The 10 gaps — all closed (9 DONE, 1 PARTIAL)

| # | Gap | Impact | Status | Files |
|---|-----|--------|--------|-------|
| 1 | Streaming tool execution | Huge | **DONE** | `runner/streaming_executor.go`, `tool/concurrency.go` |
| 2 | Retry with context clearing | Huge | **DONE** | `runner/runner.go` (retry loop), `runner/compact.go` (emergencyCompact) |
| 3 | Snip + context collapse | High | **DONE** | `coder/snip.go` |
| 4 | Stop hooks | High | **DONE** | `runner/stop_hooks.go` |
| 5 | Inline permission elicitation | High | **PARTIAL** | `coder/permission.go` (deny works). Interactive ask→approve needs frontend. |
| 6 | Per-tool concurrency | Medium | **DONE** | `tool/concurrency.go` |
| 7 | Structured output + retry | Medium | **DONE** | `runner/structured_output.go` |
| 8 | Token/USD budget stopping | Medium | **DONE** | `runner/runner.go` (budget check + milestone notifications at 25/50/80/90/95/100%) |
| 9 | Sibling abort coordination | Medium | **DONE** | `runner/streaming_executor.go` (siblingCtx/siblingCancel) |
| 10 | Streaming fallback on 529 | Medium | **DONE** | `runner/runner.go` (3rd retry → Complete) |

---

## Problem → Solution Log

### #1 Streaming tool execution — DONE
**Problem:** Tools waited for full LLM response before executing. Model streams 3 tool calls over 2s, but execution starts at 2s instead of 0.5s.
**Solution:** `runner/streaming_executor.go` — queues tools during stream via `tool_call_done` events. Safe tools run in parallel. Exclusive tools wait for in-flight to finish. Results in submission order.
**Files:** `tool/concurrency.go`, `runner/streaming_executor.go`, `runner/provider.go`, `connectors/anthropic_oauth.go`, `runner/runner.go`
**Tests:** 7 (parallel, exclusive wait, ordering, serialization, cancellation, concurrency defaults)

### #2 Retry with context clearing — DONE
**Problem:** On 413 (context overflow) we failed. On 529 (overload) we didn't retry.
**Solution:** 413 → `emergencyCompact()` strips old tool results, retries once. 429/529 → backoff 2s/4s/6s, retry up to 3x. Supports `RateLimitError.RetryAfter` header.
**Files:** `runner/runner.go` (retry loop), `runner/compact.go` (emergencyCompact)

### #3 Snip + context collapse — DONE
**Problem:** Long sessions accumulated old tool results that wasted tokens.
**Solution:** When total context > 80K chars and > 10 turns: replace old turns with summary. Keeps last 6 turns intact. Preserves first user message. Summary includes tool call count + files touched.
**Files:** `coder/snip.go`

### #4 Stop hooks — DONE
**Problem:** Nothing happened between turns except appending messages.
**Solution:** `StopHookFunc` type + `WithStopHook` option. Runs after each turn. If hook returns `preventContinuation=true`, loop stops. Foundation for memory extraction, skill prefetch.
**Files:** `runner/stop_hooks.go`

### #5 Inline permission elicitation — PARTIAL
**Problem:** Permissions checked upfront only. Can't ask user mid-turn.
**Solution:** Deny mode works via `coder/permission.go`. Interactive ask→approve flow needs frontend protocol: emit `permission.request` event, wait for response via stream, resume tool.
**Remaining:** Frontend permission approval UI + operator↔frontend protocol.

### #6 Per-tool concurrency — DONE
**Problem:** All tools ran in parallel blindly — bash alongside write_file.
**Solution:** `ConcurrencySafe` (read_file, glob, grep, lsp_*) vs `ConcurrencyExclusive` (bash, write_file, edit_file). Enforced by StreamingToolExecutor.
**Files:** `tool/concurrency.go`

### #7 Structured output with retry — DONE
**Problem:** No way to validate JSON schema output from the model.
**Solution:** `validateStructuredOutput()` checks JSON validity for strict schemas. Retries up to 5x with nudge message. Strips markdown code fences.
**Files:** `runner/structured_output.go`

### #8 Token/USD budget stopping — DONE
**Problem:** Cost tracker existed but didn't stop the loop.
**Solution:** After each turn: check `ShouldAutoContinue()`. Budget milestone notifications at 25%, 50%, 80%, 90%, 95%, 100% via stream event. Cost summary emitted at each milestone.
**Files:** `runner/runner.go`, `coder/runner_adapter.go` (BudgetMilestone)

### #9 Sibling abort coordination — DONE
**Problem:** All parallel tools shared one context — bash error cancelled safe tools unnecessarily.
**Solution:** StreamingToolExecutor uses `siblingCtx` for safe tools. Exclusive tool (bash) error → `siblingCancel()` → cancels all safe siblings. Safe tool errors don't cascade.
**Files:** `runner/streaming_executor.go`

### #10 Streaming fallback on 529 — DONE
**Problem:** If streaming failed with 529, the turn failed.
**Solution:** On 3rd retry attempt, falls back to `Complete()` (non-streaming). Discards streaming executor, retries synchronously.
**Files:** `runner/runner.go`

---

## Frontend Integration

All agent loop changes are operator-internal. The frontend sees effects through existing stream events:

| Change | Stream event frontend sees | Frontend action needed |
|--------|--------------------------|----------------------|
| Streaming tool execution | `tool.call`/`tool.result` arrive faster | None |
| Per-tool concurrency | Multiple `tool.call` before `tool.result` | None |
| 413/429/529 retry | `status`: "Rate limited — retrying..." | None |
| Snip compaction | `status`: "Compacted context (freed N chars)" | None |
| Structured output | No change — JSON in assistant content | None |
| Stop hooks | `done` with `stop_reason: "hook"` | None |
| Sibling abort | Some `tool.result` with cancelled errors | None |
| Budget milestones | `status`: "Budget: 80% used — ..." at 25/50/80/90/95/100% | None |
| Prompt cache split | No visible change | None |

See `docs/updated/frontend_wiring.md` for full integration guide.
