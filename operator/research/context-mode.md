# context-mode Research

**Repository:** https://github.com/flakerimi/context-mode (fork of mksglu/context-mode)
**Author:** Mert Koseoğlu
**License:** Elastic License 2.0 (ELv2)
**Version:** 1.0.18
**Tagline:** "MCP is the protocol for tool access. We're the virtualization layer for context."

---

## What It Does

context-mode is an MCP server that solves the context window exhaustion problem in AI coding agents. It does two things:

1. **Context Saving** -- Sandboxes tool execution so raw data (logs, API responses, web pages, git history) never enters the conversation context window. 315 KB of raw output becomes 5.4 KB. 98% reduction.

2. **Session Continuity** -- Tracks every file edit, git operation, task, error, and user decision in SQLite. When the conversation compacts (the agent drops older messages to free space), context-mode rebuilds working state from the database. The model picks up exactly where it left off.

The core insight: every MCP tool call dumps raw data into context. A Playwright snapshot costs 56 KB. Twenty GitHub issues cost 59 KB. After 30 minutes, 40% of the context is gone. And when the agent compacts to free space, it forgets everything.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    AI Agent (Claude, Gemini, etc.)       │
│                                                         │
│  PreToolUse Hook ──> Intercepts tool calls              │
│  PostToolUse Hook ──> Captures session events            │
│  PreCompact Hook ──> Builds resume snapshot              │
│  SessionStart Hook ──> Restores state after compaction   │
└────────────────┬────────────────────────────────────────┘
                 │ MCP Protocol
┌────────────────▼────────────────────────────────────────┐
│                  MCP Server (server.ts)                  │
│                                                         │
│  Tools:                                                 │
│  - ctx_execute        (sandbox code in 11 languages)    │
│  - ctx_execute_file   (process files in sandbox)        │
│  - ctx_batch_execute  (multiple commands + queries)     │
│  - ctx_index          (chunk markdown into FTS5)        │
│  - ctx_search         (BM25-ranked retrieval)           │
│  - ctx_fetch_and_index (fetch URL, convert, index)      │
└──────┬──────────────┬──────────────────────────────────┘
       │              │
┌──────▼──────┐ ┌─────▼──────────────────────────────────┐
│ PolyglotExec│ │ ContentStore (store.ts)                 │
│ (executor)  │ │                                         │
│             │ │ SQLite FTS5 + BM25 ranking              │
│ 11 language │ │ Porter stemming + Trigram + Fuzzy        │
│ runtimes    │ │ Smart snippet extraction                 │
│ Sandboxed   │ │ Progressive throttling                   │
│ subprocesses│ └─────────────────────────────────────────┘
└─────────────┘
       │
┌──────▼──────────────────────────────────────────────────┐
│ SessionDB (session/db.ts)                                │
│                                                         │
│ Per-project SQLite database                             │
│ - session_events (deduped via SHA256)                    │
│ - session_meta (timestamps, event counts)                │
│ - session_resume (snapshots for recovery)                │
│                                                         │
│ Event extraction (session/extract.ts)                    │
│ Snapshot builder (session/snapshot.ts)                    │
└─────────────────────────────────────────────────────────┘
```

### Key Source Files

| File | Role |
|------|------|
| `src/server.ts` | MCP server entrypoint -- registers tools, handles requests, wires subsystems |
| `src/store.ts` | FTS5/BM25 knowledge base -- indexes chunks, manages search |
| `src/executor.ts` | PolyglotExecutor -- sandboxed subprocess runner for 11 languages |
| `src/db-base.ts` | SQLite base class -- WAL pragmas, prepared statement caching, lifecycle |
| `src/session/db.ts` | SessionDB -- persists session events with deduplication |
| `src/session/extract.ts` | Pure-function event extraction from tool calls and user messages |
| `src/session/snapshot.ts` | Priority-tiered XML snapshot builder for compaction recovery |
| `src/security.ts` | Permission system -- deny/allow patterns, command chain splitting |
| `src/adapters/detect.ts` | Platform auto-detection (Claude Code, Gemini CLI, Cursor, etc.) |
| `src/adapters/types.ts` | HookAdapter interface -- contract for platform-specific hooks |
| `hooks/core/routing.mjs` | Pure routing logic -- intercepts, blocks, redirects tool calls |

---

## How Context Saving Works

### The Sandbox Pattern

Each `ctx_execute` call spawns an isolated subprocess. The subprocess runs code, captures stdout, and only that stdout enters the conversation context. Raw data (log files, API responses, snapshots) never leaves the sandbox.

The PolyglotExecutor (`src/executor.ts`) supports 11 language runtimes: JavaScript, TypeScript, Python, Shell, Ruby, Go, Rust, PHP, Perl, R, and Elixir. Key design decisions:

- **Process isolation**: Each call gets its own subprocess with its own process boundary
- **Credential passthrough**: Authenticated CLIs (gh, aws, gcloud, kubectl, docker) inherit env vars without exposing them to the conversation
- **Hard byte cap**: A stream-level cap kills processes that exceed 100MB combined stdout+stderr (prevents `yes` or `/dev/urandom` from eating memory)
- **Smart truncation**: Output is truncated to keep head (60%) and tail (40%) -- preserving both initial context and final error messages
- **Background mode**: Long-running processes can be detached, returning partial output while the process continues

### Intent-Driven Filtering

When output exceeds 5 KB and an `intent` is provided, context-mode switches from returning raw output to:
1. Indexing the full output into the knowledge base
2. Searching for sections matching the intent
3. Returning only relevant matches with searchable terms for follow-up

### The Knowledge Base (store.ts)

The ContentStore uses SQLite FTS5 with BM25 ranking. Three indexing strategies:

- **Markdown**: Chunks by headings, preserves code blocks intact, splits oversized sections at paragraph boundaries
- **Plain text**: Splits by blank lines or fixed line counts with overlap
- **JSON**: Walks object trees using key paths as hierarchical titles, batches arrays intelligently

Search uses a three-layer fallback:
1. **Porter stemming** (FTS5 MATCH) -- "caching" matches "cached", "caches"
2. **Trigram substring** (FTS5 trigram tokenizer) -- "useEff" finds "useEffect"
3. **Fuzzy correction** (Levenshtein distance) -- "kuberntes" corrects to "kubernetes"

Smart snippet extraction finds where query terms appear in content and returns windows around those matches, rather than truncating from the start.

Progressive throttling prevents search abuse:
- Calls 1-3: Normal (2 results per query)
- Calls 4-8: Reduced (1 per query) + warning
- Calls 9+: Blocked -- redirects to batch_execute

---

## How Session Continuity Works

### Event Capture

The PostToolUse hook fires after every tool call and extracts structured events into 13+ categories:

| Category | Examples | Priority |
|----------|----------|----------|
| Files | read, edit, write, glob, grep | P1 (Critical) |
| Tasks | create, update, complete | P1 |
| Rules | CLAUDE.md paths + content | P1 |
| User Prompts | Every user message | P1 |
| Decisions | User corrections, preferences | P2 |
| Git | checkout, commit, merge, push, diff | P2 |
| Errors | Tool failures, non-zero exits | P2 |
| Environment | cwd changes, venv, package installs | P2 |
| MCP Tools | Tool call counts | P3 |
| Subagents | Agent tool invocations | P3 |
| Intent | Session mode (investigate, implement, debug) | P4 |

Events are deduplicated via SHA256 hashing (checks last 5 events). Sessions exceeding 1,000 events evict lowest-priority entries using FIFO.

### Compaction Recovery Flow

```
PreCompact fires
  -> Read all session events from SQLite
  -> Build priority-tiered XML snapshot (<=2 KB budget)
  -> Store snapshot in session_resume table

SessionStart fires (source: "compact")
  -> Retrieve stored snapshot
  -> Write structured events file -> auto-indexed into FTS5
  -> Build Session Guide with 15 categories
  -> Inject <session_knowledge> directive into context
  -> Model continues from last user prompt with full working state
```

The snapshot builder (`session/snapshot.ts`) implements a priority-tier budget allocation:
- P1 (50% of 2KB): Files, tasks, rules -- core work artifacts
- P2 (35%): Environment, errors, decisions, completed subagents
- P3 (15%): Intent, MCP tools, launched subagents

If the budget is tight, lower-priority events are dropped first. Critical state (active files, tasks, rules, decisions) is always preserved.

### The Session Guide

After compaction, the model receives a structured narrative with actionable sections:
- Last Request (so it continues without asking "what were we doing?")
- Tasks with checkbox format ([x] completed, [ ] pending)
- Key Decisions (user corrections and preferences)
- Files Modified
- Unresolved Errors
- Git operations performed
- Project Rules
- MCP Tools Used with call counts
- Environment state

---

## Hook System and Multi-Platform Support

### The Routing Layer

The PreToolUse hook (`hooks/core/routing.mjs`) is the enforcement layer. It intercepts tool calls before execution and decides:

- **Deny**: Block the tool (e.g., WebFetch always blocked -- redirected to sandbox)
- **Modify**: Replace the command (e.g., curl/wget replaced with redirect message)
- **Context**: Inject guidance (e.g., nudge Read toward execute_file)
- **Ask**: Prompt user for confirmation (security policy match)
- **Passthrough**: Allow the tool to proceed

Specific routing rules:
- `curl`/`wget` in Bash: **blocked**, replaced with echo redirecting to ctx_fetch_and_index
- Inline HTTP (fetch(), requests.get(), http.get()): **blocked**
- Build tools (gradle, maven): **redirected** to execute sandbox
- WebFetch: **always denied**, redirected to ctx_fetch_and_index
- Agent/Task tools: **modified** to inject routing instructions into subagent prompts
- Read: **context injected** nudging toward execute_file
- Grep: **context injected** nudging toward execute

### Platform Adapter Pattern

The adapter system (`src/adapters/`) abstracts platform differences behind a common `HookAdapter` interface. Three paradigms:

1. **JSON stdin/stdout** -- Claude Code, Gemini CLI, VS Code Copilot, Cursor
2. **TS Plugin Functions** -- OpenCode
3. **MCP-only (no hooks)** -- Codex CLI

Platform detection (`src/adapters/detect.ts`) uses a confidence-ranked approach:
1. Environment variables (high confidence): CLAUDE_PROJECT_DIR, GEMINI_PROJECT_DIR, etc.
2. Config directory existence (medium): ~/.claude/, ~/.gemini/, etc.
3. Fallback to Claude Code (low)

Each adapter normalizes platform-specific I/O into canonical event types (PreToolUseEvent, PostToolUseEvent, etc.) and formats responses back into platform-specific output.

### Routing Instructions (Soft Enforcement)

Each platform gets a routing instructions file (CLAUDE.md, GEMINI.md, AGENTS.md, copilot-instructions.md) that teaches the model to prefer sandbox tools. This provides ~60% compliance alone. With hooks: ~98%.

---

## Security Model

context-mode extends the host agent's permission system to the sandbox:

```json
{
  "permissions": {
    "deny": ["Bash(sudo *)", "Bash(rm -rf /*)", "Read(.env)", "Read(**/.env*)"],
    "allow": ["Bash(git:*)", "Bash(npm:*)"]
  }
}
```

- Deny always wins over allow
- Chained commands (`&&`, `;`, `|`) are split and each part checked separately
- Shell escape detection finds embedded shell commands in Python, JS, Ruby, Go, PHP, Rust code
- Project-level rules override global ones

---

## What Makes It Interesting (Patterns for Agent Systems)

### 1. Context as a First-Class Resource

The fundamental insight is treating context window space like memory -- a finite resource that needs a virtual memory system. context-mode is essentially a paging/swapping layer for LLM context. Raw data stays on "disk" (SQLite), and only relevant fragments are paged into "memory" (context window).

### 2. Hook-Based Behavioral Enforcement

Rather than relying on prompt instructions alone (~60% compliance), context-mode uses programmatic hooks to enforce behavior (~98% compliance). The routing layer intercepts tool calls before they execute and can block, modify, or redirect them. This is a general pattern: **do not trust the model to follow instructions -- enforce them mechanically**.

### 3. Priority-Tiered Event Budgeting

The snapshot builder uses a clever budget allocation system. When rebuilding state after compaction, it allocates byte budgets by priority tier and progressively drops lower-priority events. This is a general-purpose pattern for any system that needs to compress a large event history into a fixed-size summary.

### 4. Multi-Layer Search Fallback

The three-layer search (Porter stemming -> Trigram -> Fuzzy/Levenshtein) provides robust retrieval even with typos and partial terms. Each layer is fast and the fallback only triggers when the previous layer returns nothing.

### 5. Platform Abstraction via Adapter Pattern

The adapter system cleanly separates "what to do" (core routing, event extraction) from "how this platform works" (I/O format, hook registration, config paths). This allows one codebase to support 6+ platforms with different hook paradigms.

### 6. Dual Enforcement (Hooks + Instructions)

The combination of programmatic hooks (hard enforcement) and routing instruction files (soft enforcement) provides defense in depth. Even if hooks fail or aren't supported, the instructions file catches some percentage of cases.

### 7. Session State as Indexed Knowledge

Instead of dumping the full session snapshot back into context after compaction, context-mode indexes session events into FTS5 and retrieves only what's relevant via BM25 search. This means the model gets just enough to continue working, not a raw dump of everything that happened.

### 8. SQLite as the Universal Persistence Layer

Both the knowledge base (ContentStore) and session database (SessionDB) use SQLite with:
- WAL mode for concurrent reads during writes
- FTS5 virtual tables for full-text search
- Prepared statement caching
- Per-process DB paths to prevent multi-instance conflicts
- Automatic cleanup on session end

### 9. Smart Truncation (Head + Tail)

The truncation strategy keeps 60% head and 40% tail of output. This preserves both the initial setup/context and the final results/errors -- which is where the actionable information usually lives. Better than naive truncation from one end.

### 10. Progressive Throttling

Search calls are progressively limited (3 calls at full results, then reduced, then blocked). This prevents a pattern where the model keeps searching without making progress -- a common failure mode in agent systems.

---

## Benchmarks

| Scenario | Raw Size | In Context | Savings |
|----------|----------|------------|---------|
| Playwright snapshot | 56.2 KB | 299 B | 99% |
| GitHub Issues (20) | 58.9 KB | 1.1 KB | 98% |
| Access log (500 requests) | 45.1 KB | 155 B | 100% |
| Analytics CSV (500 rows) | 85.5 KB | 222 B | 100% |
| Git log (153 commits) | 11.6 KB | 107 B | 99% |
| Repo research (subagent) | 986 KB | 62 KB | 94% |

Full session: 315 KB raw -> 5.4 KB context. Session extends from ~30 min to ~3 hours.

---

## Relevance to Construct

Key takeaways for building agent systems:

1. **Context management is infrastructure**: Any long-running agent needs something like this. The naive approach (dump everything into context) breaks after 30 minutes.

2. **Hooks > Instructions**: Programmatic enforcement of agent behavior is dramatically more reliable than prompt-based instructions. Build hook systems.

3. **Session persistence**: SQLite + FTS5 is a lightweight, proven pattern for agent memory. No vector DB needed for this use case -- BM25 on structured events works well.

4. **Budget-aware summarization**: The priority-tiered snapshot pattern is reusable anywhere you need to compress a large state into a fixed-size representation.

5. **Platform adapter pattern**: If building tools that work across multiple AI platforms, the adapter interface here is a clean reference implementation.

---

*Research date: 2026-03-13*
