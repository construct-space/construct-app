# Context Management — Claude Code vs Construct

  What Claude Code does:

  - ContentReplacementState: freeze/replace ranges in conversation for surgical editing
  - cache_edits: send edits to API to clear stale tool results server-side without cache miss
  - 5 compaction strategies (least-lossy to most-lossy): microcompact, context collapse, session memory, full compact, PTL truncation
  - Per-tool result truncation with 8KB preview, full stored externally
  - /compact command for manual user-triggered compaction
  - 200K default context window, 1M opt-in with [1m] model suffix
  - Context pressure detection triggers automatic compaction

  How it is now:

  ┌────┬───────────────────────────────┬──────────────────────────────────────────────────┬──────────────────────────┐
  │  # │ What we built                 │ How it works                                     │ File                     │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  1 │ Per-tool context budget       │ Each tool has a char limit (read_file: 4000,     │ coder/context.go         │
  │    │                               │ bash: 3000, grep: 2000, default: 1200). Over-    │                          │
  │    │                               │ budget results persisted to disk, smart preview  │                          │
  │    │                               │ kept in context.                                 │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  2 │ Tool-aware preview strategy   │ read_file: 70/30 head/tail. bash: 60/40 (errors  │ coder/context.go         │
  │    │                               │ are at the end). grep: keep header + 65/35.      │                          │
  │    │                               │ Generic: 70/30. All include ref:ID footer.       │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  3 │ Disk persistence              │ Full results written to storageDir as .txt.      │ coder/context.go         │
  │    │                               │ Retrieve(id) reads them back. StoredResults()    │                          │
  │    │                               │ exposes all for session state persistence.        │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  4 │ Time-based microcompact       │ After idle > 60min, old tool results (before     │ coder/microcompact.go    │
  │    │                               │ recent 5 turns) truncated to 200 chars +         │                          │
  │    │                               │ "[cleared: stale]" notice.                       │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  5 │ Snip compaction               │ When total context > 80K chars and > 10 turns:   │ coder/snip.go            │
  │    │                               │ replace old turns with summary. Keep last 6      │                          │
  │    │                               │ turns. Preserve first user message. Summary       │                          │
  │    │                               │ includes tool count + files touched.             │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  6 │ Emergency compact (413)       │ On 413 context overflow: emergencyCompact()      │ runner/compact.go        │
  │    │                               │ strips old tool results, retries once.            │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  7 │ Context analysis              │ Scans message history for waste: duplicate file   │ coder/context_           │
  │    │                               │ reads, largest results, bash-heavy sessions,     │ analysis.go              │
  │    │                               │ high tool call counts. Generates recommendations.│                          │
  └────┴───────────────────────────────┴──────────────────────────────────────────────────┴──────────────────────────┘

  The 3 gaps — Claude Code vs Construct:

  ┌─────┬──────────────────────┬────────┬──────────────────────────────────────────┬────────────────────────────┐
  │  #  │        Gap           │ Impact │            What they do                  │       What we do           │
  ├─────┼──────────────────────┼────────┼──────────────────────────────────────────┼────────────────────────────┤
  │  1  │ cache_edits pinning  │ High   │ API-level: send edits to clear stale    │ We compact client-side     │
  │     │                      │        │ results without breaking prompt cache.   │ which may cause cache      │
  │     │                      │        │ Surgical server-side compaction.         │ miss on rewritten prefix.  │
  ├─────┼──────────────────────┼────────┼──────────────────────────────────────────┼────────────────────────────┤
  │  2  │ Full compact command │ Medium │ /compact user command summarizes entire  │ We have snip (auto) and    │
  │     │                      │        │ conversation into a condensed version.   │ emergency (413) but no     │
  │     │                      │        │ User controls when to "save point."     │ manual /compact command.    │
  ├─────┼──────────────────────┼────────┼──────────────────────────────────────────┼────────────────────────────┤
  │  3  │ PTL truncation       │ Low    │ Last resort: drop oldest message groups  │ Not needed yet — snip +    │
  │     │                      │        │ entirely. Least-preferred strategy.      │ emergency compact handle   │
  │     │                      │        │                                          │ overflow cases.             │
  └─────┴──────────────────────┴────────┴──────────────────────────────────────────┴────────────────────────────┘

---

## Problem → Solution Log

### Per-tool context budget — DONE
**Problem:** Blunt truncation lost important content. A 50KB bash output was cut the same way as a 5KB file read.
**Solution:** `ContextBudget` assigns per-tool char limits. Oversized results persisted to disk with `StoredResult`. Tool-specific preview strategies: read_file keeps more of the top (structure), bash keeps more of the bottom (exit codes/errors), grep preserves the header line.
**Files:** `coder/context.go`

### Snip compaction — DONE
**Problem:** Long sessions accumulated old tool results that wasted tokens. 80K+ chars of context with only recent turns being useful.
**Solution:** `SnipMessages()` triggers when total chars > 80K and > 10 turns. Replaces old turns with a summary message containing tool call count and files touched. Preserves first user message (original task) and last 6 turns (recent context).
**Files:** `coder/snip.go`

### Time-based microcompact — DONE
**Problem:** After idle sessions, old tool results fill cache but contain stale information (file may have changed on disk).
**Solution:** `MicroCompact()` checks idle duration. If > 60 minutes, old tool results (before recent 5 turns) are truncated to 200 chars with a notice. User/assistant text messages never touched. CompactableTools whitelist: bash, grep, glob, read_file, list_dir (not write/edit).
**Files:** `coder/microcompact.go`

### Context analysis — DONE
**Problem:** No visibility into where context is being wasted.
**Solution:** `AnalyzeContext()` scans full message history. Reports: total chars, tool calls by name, result chars by tool, duplicate file reads (path + count), top 5 largest results, wasted chars estimate. Generates actionable recommendations.
**Files:** `coder/context_analysis.go`

### Emergency compact — DONE
**Problem:** On 413 (context overflow) the turn failed with no recovery.
**Solution:** `emergencyCompact()` strips old tool results from the message history, retries the API call once. Part of the runner's retry loop.
**Files:** `runner/compact.go`, `runner/runner.go`
