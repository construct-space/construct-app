# Permission System — Claude Code vs Construct

  What Claude Code does:

  - 5-level settings cascade: policy > flag > local > project > user
  - Glob pattern rules: "Bash(npm *)", "Edit(src/**)" in settings.json
  - Three permission modes: bypass, allowEdits, auto
  - Auto mode: races multiple resolvers in parallel (user click, hook classifier, bash security classifier, bridge/web UI). First to respond wins (createResolveOnce pattern)
  - Inline elicitation: tool returns ask_user, pauses, prompts user mid-turn, resumes if approved
  - Per-tool isConcurrencySafe() declaration tied to permission checks
  - Hook-based: PreToolUse can block or modify actions

  How it is now:

  ┌────┬───────────────────────────────┬──────────────────────────────────────────────────┬──────────────────────────┐
  │  # │ What we built                 │ How it works                                     │ File                     │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  1 │ 6 permission modes            │ default (safe=allow, write/dangerous=ask),        │ coder/permission.go      │
  │    │                               │ plan (read-only), accept_edits (safe+write),     │                          │
  │    │                               │ bypass (all), dont_ask (deny non-safe),           │                          │
  │    │                               │ auto (LLM classifier).                            │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  2 │ 3-tier tool classification    │ safe: read_file, glob, grep, lsp_*, memory_*,   │ coder/permission.go      │
  │    │                               │ space_*, check_task, etc.                        │                          │
  │    │                               │ write: write_file, edit_file.                     │                          │
  │    │                               │ dangerous: bash, spawn_agent, spawn_background.   │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  3 │ Per-tool rules with globs     │ PermissionRule: tool name + action (allow/deny/  │ coder/permission.go      │
  │    │                               │ ask) + optional pattern. Supports Claude Code-    │                          │
  │    │                               │ style globs: "Bash(npm *)", "Edit(src/**)".      │                          │
  │    │                               │ First matching rule wins.                        │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  4 │ Auto classifier interface     │ AutoClassifierFunc: receives ctx + toolName +     │ coder/permission.go      │
  │    │                               │ input, returns allow/deny/ask. Pluggable. In     │                          │
  │    │                               │ ModeAuto, safe tools always allowed, others go   │                          │
  │    │                               │ through classifier. Falls back to permissive.    │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  5 │ Hook integration              │ RegisterHooks() adds "coder-permissions" as a    │ coder/coder.go           │
  │    │                               │ PreTool hook. Denied tools return blocked message│                          │
  │    │                               │ with permission mode name.                        │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  6 │ Prefix-based auto-classify    │ space_* and construct_* prefixed tools auto-     │ coder/permission.go      │
  │    │                               │ classify as "safe". mcp_* auto-classifies as     │                          │
  │    │                               │ "dangerous". Unknown tools default to dangerous.  │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  7 │ Stream event emission         │ EmitPermissionChange() sends permission.mode     │ coder/coder.go           │
  │    │                               │ event. permission.denied event type defined.      │                          │
  └────┴───────────────────────────────┴──────────────────────────────────────────────────┴──────────────────────────┘

  The 3 gaps — Claude Code vs Construct:

  ┌─────┬──────────────────────┬────────┬──────────────────────────────────────────┬────────────────────────────┐
  │  #  │        Gap           │ Impact │            What they do                  │       What we do           │
  ├─────┼──────────────────────┼────────┼──────────────────────────────────────────┼────────────────────────────┤
  │  1  │ Inline elicitation   │ High   │ Tool returns ask_user, pauses turn,     │ Deny mode blocks upfront.  │
  │     │                      │        │ shows UI prompt, resumes if approved.    │ No mid-turn interactive    │
  │     │                      │        │ Mid-turn interactive approval.           │ approval. Need frontend    │
  │     │                      │        │                                          │ protocol.                  │
  ├─────┼──────────────────────┼────────┼──────────────────────────────────────────┼────────────────────────────┤
  │  2  │ Multi-resolver race  │ Medium │ Races user click, hook classifier, bash  │ Single-path: check rules   │
  │     │                      │        │ security classifier, bridge in parallel. │ then mode then classify.   │
  │     │                      │        │ First to respond wins.                   │ Sequential, not parallel.  │
  ├─────┼──────────────────────┼────────┼──────────────────────────────────────────┼────────────────────────────┤
  │  3  │ 5-level cascade      │ Low    │ policy > flag > local > project > user.  │ Single rules list +        │
  │     │                      │        │ Higher levels cannot be overridden.      │ mode. No cascade. Rules    │
  │     │                      │        │                                          │ are flat, first-match.     │
  └─────┴──────────────────────┴────────┴──────────────────────────────────────────┴────────────────────────────┘

---

## Problem → Solution Log

### 6 permission modes — DONE
**Problem:** Claude Code's 3 modes (bypass, allowEdits, auto) weren't enough. Background agents need a "deny all non-safe" mode, and we needed a pure read-only mode for planning.
**Solution:** 6 modes: default, plan, accept_edits, bypass, dont_ask, auto. Each mode defines a clear policy for safe/write/dangerous tool classes. dont_ask is specifically for background agents that should never prompt the user.
**Files:** `coder/permission.go`

### Glob pattern rules — DONE
**Problem:** Users want fine-grained control: "allow npm commands but not rm commands", "allow edits in src/ but not in config/".
**Solution:** `matchesGlobRule()` parses Claude Code-style patterns like `Bash(npm *)` and `Edit(src/**)`. Case-insensitive. Supports prefix globs (`npm*`), suffix globs (`*.ts`), and contains matching. Rules checked before mode-based defaults.
**Files:** `coder/permission.go`

### Auto classifier — DONE
**Problem:** ModeAuto needed an LLM-based decision maker for ambiguous tool calls.
**Solution:** `AutoClassifierFunc` type: `func(ctx, toolName, input) PermissionAction`. Pluggable via `SetAutoClassifier()`. In ModeAuto, safe tools bypass the classifier. Write tools default to allow (auto is permissive). Dangerous tools go through classifier or fall back to Ask.
**Files:** `coder/permission.go`

### Inline elicitation — PARTIAL
**Problem:** Can't ask user mid-turn to approve a specific action. Must decide upfront.
**Solution:** Deny works. Interactive flow needs: emit `permission.request` event, pause tool execution, wait for frontend response via stream, resume tool. Requires frontend protocol addition.
**Remaining:** Frontend permission approval UI, operator-frontend protocol for request/response.
