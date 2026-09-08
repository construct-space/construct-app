# Construct Operator vs Claude Code

## Codebase sizes

| Codebase | Language | Files | Lines |
|----------|----------|------:|------:|
| Claude Code (leaked source) | TypeScript | 1,900 | 133,000 |
| **Construct Operator** | **Go** | **140+** | **27,000+** |

## Feature comparison

| Feature | Claude Code | Construct Operator | Rating |
|---------|:---:|:---:|:---:|
| Core agent loop | Speculation, compaction, cache-safe | Runner + streaming exec + snip + retry + budget stop | **9/10** |
| Tool execution | StreamingToolExecutor, per-tool concurrency | StreamingToolExecutor, Safe/Exclusive, sibling abort | **9/10** |
| Sub-agents | Fork-based, worktree isolation, byte-identical cache | Sub-agent registry, Space specialist, context injection | 7/10 |
| Context management | ContentReplacementState, freeze/replace, cache_edits | Per-tool budgets, disk persistence, microcompact, snip, context analysis | **9/10** |
| Permission system | 6 modes, per-tool rules, inline elicitation | 6 modes, per-tool rules, glob patterns, auto classifier, hook-integrated | **8/10** |
| Cost tracking | Per-token-type, budget warnings, diminishing returns | Token budgets, milestone notifications, diminishing returns, cache hit rate | **9/10** |
| LSP | Full manager, diagnostics, definition, refs | Manager, 4 servers, 3 tools (definition, refs, diagnostics) | 7/10 |
| Memory system | 3-layer (index→topics→transcripts), autoDream, extractMemories | 3-layer + autoDream + extraction + staleness check, XOR encoded | **9/10** |
| Prompt cache | Break detection, TTL, cache_edits pinning, static/dynamic split | Break detection, hash tracking, static/dynamic split + boundary | **8/10** |
| File state | LRU cache, read state tracking | LRU cache + file state + system prompt injection | 8/10 |
| Session resume | Full transcript, replacement state, worktree | Session memory extraction + resume injection + fork + state restore | **8/10** |
| Streaming | StreamingOptimizer, WorkerPool, batching | Emitter + streaming tool exec + fallback on 529 | **8/10** |
| Provider support | Anthropic-only | Multi-provider OAuth (Anthropic, OpenAI, DeepSeek, etc.) | **9/10** |
| Background tasks | Full task system, polling, notifications | TaskManager, spawn_background, check/cancel tools | 7/10 |
| Structured output | SyntheticOutputTool, schema validation, retry | SyntheticOutputTool + full JSON Schema validator + 3-provider + dynamic schemas + retry 5x | **9/10** |
| Error recovery | 413 compact, 529 backoff, streaming fallback | Emergency compact, 429/529 retry 3x, streaming→Complete fallback | **8/10** |
| Desktop integration | Bridge for remote sessions | Tauri, TTS, code editor space, Monaco | **9/10** |

**Overall: 8/10** (up from 4/10 at start of this work)

## What Construct has that others don't

- Multi-provider from day one (Anthropic, OpenAI, DeepSeek, OpenRouter, GitHub Copilot, Google Gemini)
- Desktop app with Vue 3 + Tauri 2 (not just a CLI)
- Built-in code editor (Monaco, file tree, terminal)
- Space ecosystem (plugin architecture for extending the app)
- TTS (text-to-speech)
- Sub-agent system with domain-specialist context injection (vs Claude Code's fork-based isolation)

## What Claude Code has that we still need

- ~~autoDream as forked LLM subagent~~ — **DONE**: `memory_dream.go` spawns LLM sub-agent with memory tools, falls back to structural
- ~~Session continuity: --continue, --fork-session, session memory extraction~~ — **DONE**: `session_memory.go` extracts on completion, injects on resume, `sessions.fork` handler
- Prompt cache_edits pinning (surgical compaction without cache miss)
- Full session branching (worktree-style isolation for subagents)
- ~~Interactive permission elicitation~~ — **PARTIAL**: 6 modes done (default/plan/accept_edits/bypass/dont_ask/auto). Auto classifier wired. Interactive ask→approve UI still needs frontend protocol.
- Thinking blocks / adaptive thinking
- Fast mode (reduced-context model switching)
- Telemetry/analytics pipeline
