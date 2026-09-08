# Memory System — Claude Code vs Construct

## Claude Code's 3-layer memory architecture

Source: leaked source code + community analysis

```
Write paths                          Read paths
─────────────                        ──────────
Manual write ──→ MEMORY.md ←──────── System prompt (always loaded)
(on user request)  Layer 1 — index     MEMORY.md injected every turn
                     │
autoDream ─────→ Topic files (*.md) ← FileReadTool (on-demand)
(background)       Layer 2 — loaded     Topic files fetched when relevant
                     │
extractMemories → Session transcripts ← Targeted grep
(per-turn)         Layer 3 — grepped     Narrow terms only
                     never fully read
```

### Layer 1: MEMORY.md (always in context)
- Index file, always loaded into system prompt
- ~150 chars per line — just pointers, not content
- Truncated at 200 lines to prevent context pollution
- Format: `- [Title](file.md) — one-line hook`

### Layer 2: Topic files (*.md) (on-demand)
- Actual knowledge stored in separate files
- Loaded by FileReadTool only when the agent needs them
- Categories: user, feedback, project, reference
- Frontmatter: name, description, type

### Layer 3: Session transcripts (.json) (grep only)
- Never fully read — only grepped for narrow terms
- Preserves conversation history without loading it
- consolidationLock.ts prevents race conditions

### autoDream — background memory consolidation
- Fires after >24h and >5 sessions
- Runs in a forked subagent with limited tools (prevents corruption)
- 4 phases: Orient → Gather signal → Consolidate → Prune & Index
- Merges duplicates, removes contradictions
- Converts relative dates to absolute
- Aggressively prunes stale entries

### Key principles
1. Memory = index, not storage
2. What they DON'T store is the insight (no code structure, no PR history, no debug logs)
3. If it's derivable from code, don't persist it
4. Staleness is first-class — if memory ≠ reality, memory is wrong
5. Retrieval is skeptical — memory is a hint, model must verify

---

  How it is now (all 4 phases DONE):

  ┌────┬───────────────────────────────┬──────────────────────────────────────────────────┬──────────────────────────┐
  │  # │ What we built                 │ How it works                                     │ File                     │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  1 │ MEMORY.md index (Layer 1)     │ Always in system prompt. ~150 chars/line.        │ coder/memory_index.go    │
  │    │                               │ Pointers to topics, not content. Truncated 200.  │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  2 │ Topic files (Layer 2)         │ On-demand via memory_read tool. Frontmatter:     │ coder/memory_topic.go    │
  │    │                               │ name, description, type, created, updated.        │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  3 │ Session transcripts (Layer 3) │ JSONL per session. Never loaded — grep only.     │ coder/memory_            │
  │    │                               │ memory_search greps across all transcripts.       │ transcript.go            │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  4 │ Memory tools                  │ memory_read, memory_write, memory_search.        │ coder/memory_tools.go    │
  │    │                               │ Agent uses these to persist knowledge.            │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  5 │ XOR + base64 encoding         │ All memory files encoded on disk. Operator       │ coder/memory_encode.go   │
  │    │                               │ reads them, users can't browse in Finder.         │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  6 │ autoDream consolidation       │ 4 phases: Orient → Gather → Consolidate →        │ coder/memory_dream.go    │
  │    │                               │ Prune. Merges dupes, prunes stale. Background.   │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  7 │ Memory extraction             │ Per-turn: detects "remember this", corrections,  │ coder/memory_extract.go  │
  │    │                               │ preferences. Injects hint for memory_write.       │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  8 │ Staleness checking            │ Extracts file refs from memory body. Verifies    │ coder/memory_stale.go    │
  │    │                               │ on disk. Prunes if files missing or >90 days.     │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  9 │ Prompt cache split            │ Static (cacheable) + dynamic (per-turn).          │ runner/system_prompt_    │
  │    │                               │ Cache boundary marker. Hash-based break detect.   │ cache.go                 │
  └────┴───────────────────────────────┴──────────────────────────────────────────────────┴──────────────────────────┘

---

## Problem → Solution Log

### Phase 1: 3-layer architecture — DONE
**Problem:** Flat memory store — all entries in one dir, all searchable, all in context. No separation between index and content.
**Solution:** 3-layer design matching Claude Code: MEMORY.md index (always loaded, pointers only) → topic files (on-demand via tool) → session transcripts (grep-only). XOR+base64 on disk.
**Files:** `memory_index.go`, `memory_topic.go`, `memory_transcript.go`, `memory_tools.go`, `memory_encode.go`

### Phase 2: autoDream + extraction — DONE
**Problem:** No background consolidation. Memories accumulated without dedup or pruning.
**Solution:** DreamRunner with 4 phases (orient/gather/consolidate/prune). Merges duplicate topics by name. Prunes stale project/reference memories (>30 days). Per-turn extraction detects "remember this", corrections, preferences — injects hint for agent to use memory_write.
**Files:** `memory_dream.go`, `memory_extract.go`

### Phase 3: Staleness checking — DONE
**Problem:** Memories could reference files/paths that no longer exist. Agent would act on stale info.
**Solution:** CheckStaleness extracts backtick-quoted file paths from memory body, verifies each exists on disk. Marks stale if files missing or not updated in >90 days. PruneStaleMemories auto-removes stale project/reference types.
**Files:** `memory_stale.go`

### Phase 4: Prompt cache optimization — DONE
**Problem:** Full system prompt rebuilt every turn — no caching, wasted tokens on static instructions.
**Solution:** SplitSystemPrompt divides at dynamic markers (Project Context, Memory, Files, etc.). Static part hashed for cache break detection. Cache boundary marker inserted. PromptCacheTracker logs breaks with reason + turn number.
**Files:** `runner/system_prompt_cache.go`, `runner/system_prompt.go` (wired in)

---

## Detail

## Our memory system — all 4 phases DONE

### Phase 1: 3-layer architecture — DONE
- [x] **MEMORY.md index** — always in system prompt, ~150 chars/line, truncated at 200 lines → `coder/memory_index.go`
- [x] **Topic files** — separate .md files with frontmatter (name, description, type, created, updated) → `coder/memory_topic.go`
- [x] **Session transcripts** — JSONL per session, grep-only access → `coder/memory_transcript.go`
- [x] Tools: `memory_read`, `memory_write`, `memory_search` → `coder/memory_tools.go`
- [x] XOR + base64 encoding on disk (operator reads, users can't browse) → `coder/memory_encode.go`
- [x] Memory index injected into system prompt every turn via `runner_adapter.go`

### Phase 2: autoDream consolidation — DONE
- [x] Background dream runner with 4 phases: Orient → Gather → Consolidate → Prune → `coder/memory_dream.go`
- [x] Detects duplicate topics by name, merges content
- [x] Prunes stale project/reference memories (>30 days)
- [x] Preserves user/feedback memories (long-lived)
- [x] Rebuilds MEMORY.md index after changes
- [x] Triggered via stop hooks (checks idle time + session count)
- [x] Per-turn memory extraction: detects "remember this", corrections, preferences → `coder/memory_extract.go`
- [x] Injects memory hints into system prompt for agent to use memory_write

### Phase 3: Staleness & verification — DONE
- [x] Extracts file path references from memory body (backtick-quoted paths) → `coder/memory_stale.go`
- [x] Verifies referenced files exist on disk
- [x] Marks stale if: files missing OR not updated in >90 days
- [x] `PruneStaleMemories()` removes stale project/reference memories
- [x] User/feedback memories preserved regardless of age

### Phase 4: Prompt cache optimization — DONE
- [x] `SplitSystemPrompt()` — static (role, tools, rules) + dynamic (memory, files, context) → `runner/system_prompt_cache.go`
- [x] Detects split point from dynamic markers (Project Context, Memory, Files, Sub-Agent, etc.)
- [x] Cache boundary marker: `<!-- cache_boundary -->`
- [x] `PromptCacheTracker` — hashes static portion, detects breaks across turns
- [x] Logs cache breaks with reason + turn number
- [x] Wired into `buildSystemWithContextAndState()` — runs every turn

## Files created

| File | What |
|------|------|
| `coder/memory_index.go` | MEMORY.md index — add/remove/truncate, encoded I/O |
| `coder/memory_topic.go` | Topic file CRUD with frontmatter, encoded I/O |
| `coder/memory_transcript.go` | Session transcript JSONL storage + grep |
| `coder/memory_dream.go` | autoDream 4-phase consolidation runner |
| `coder/memory_extract.go` | Per-turn memory signal detection (save/correction/preference) |
| `coder/memory_stale.go` | Staleness checking — file ref verification + pruning |
| `coder/memory_tools.go` | memory_read, memory_write, memory_search tools |
| `coder/memory_encode.go` | XOR + base64 encoding for disk storage |
| `runner/system_prompt_cache.go` | Static/dynamic prompt split with cache boundary + tracker |

---

## Frontend Integration

### Memory index in system prompt
Automatic — MEMORY.md loaded every turn. No frontend action.

### Memory tools (agent-facing)
`memory_read`, `memory_write`, `memory_search` — agent calls these. Frontend sees as `tool.call`/`tool.result` events.

**Optional frontend enhancement:** Detect `tool.result` where `tool === "memory_write"` → show notification toast "Saved to memory: {topic}".

### Memory extraction signals
Automatic — operator detects "remember this", corrections, preferences in user messages → injects hint for agent to call memory_write. No frontend action.

### autoDream consolidation
Runs in background after idle. No frontend action. Future: status indicator showing "Memory consolidation running..."

### Memory browser (future)
New page/panel to browse memory topics. Would need:
- `memory.list` operator endpoint (new)
- `memory.read` operator endpoint (new, or use existing memory_read tool)
- UI: list topics by type, read content, delete stale entries

See `docs/updated/frontend_wiring.md` for full integration guide.
