# Sub-agents — Claude Code vs Construct

  What Claude Code does:

  - Fork-based sub-agents: byte-identical copy of parent context, shares prompt cache
  - Three execution models: fork (same process), teammate (tmux/iterm pane), worktree (git worktree per agent)
  - Cache sharing: 5 forked agents cost barely more than 1, all hit same API cache prefix
  - No recursive forking: forked agents cannot fork again
  - File-based mailbox for teammate communication
  - Each worktree agent gets its own isolated branch
  - Sub-agent selection via task routing and model capability checks

  How it is now:

  ┌────┬───────────────────────────────┬──────────────────────────────────────────────────┬──────────────────────────┐
  │  # │ What we built                 │ How it works                                     │ File                     │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  1 │ Sub-agent registry            │ Thread-safe map of SubAgent structs. Register,   │ coder/subagent.go        │
  │    │                               │ activate, deactivate, list. Keyed by string ID.  │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  2 │ Context injection model       │ Active sub-agents inject their Prompt into the   │ coder/subagent.go        │
  │    │                               │ system prompt via SystemPromptAddition(). Also   │                          │
  │    │                               │ extend tool allowlist via ActiveTools().          │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  3 │ Auto-detect and activate      │ DetectAndActivate() scans task text for trigger  │ coder/subagent.go        │
  │    │                               │ keywords (case-insensitive Contains). Newly      │                          │
  │    │                               │ matched agents get Active=true.                  │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  4 │ Space specialist              │ Pre-registered sub-agent with full Construct CLI │ coder/subagent_space.go  │
  │    │                               │ knowledge: scaffold, build, dev, graph, manifest │                          │
  │    │                               │ patterns. Trigger: "construct space". Enables 8  │                          │
  │    │                               │ space tools.                                     │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  5 │ Agent tools                   │ activate_subagent and list_subagents tools let   │ coder/coder.go           │
  │    │                               │ the LLM manage sub-agents mid-conversation.      │                          │
  └────┴───────────────────────────────┴──────────────────────────────────────────────────┴──────────────────────────┘

  The 4 gaps — Claude Code vs Construct:

  ┌─────┬──────────────────────┬────────┬──────────────────────────────────────────┬────────────────────────────┐
  │  #  │        Gap           │ Impact │            What they do                  │       What we do           │
  ├─────┼──────────────────────┼────────┼──────────────────────────────────────────┼────────────────────────────┤
  │  1  │ Fork-based cache     │ Huge   │ Forked agent inherits byte-identical     │ Sub-agents inject prompts  │
  │     │ sharing              │        │ parent context, API caches are shared.   │ into main context. No      │
  │     │                      │        │ 5 agents ≈ cost of 1.                   │ separate agent process.     │
  ├─────┼──────────────────────┼────────┼──────────────────────────────────────────┼────────────────────────────┤
  │  2  │ Parallel agent       │ High   │ Teammate mode: separate tmux/iterm      │ spawn_background runs a    │
  │     │ execution            │        │ pane. File-based mailbox for comms.      │ goroutine, no visual       │
  │     │                      │        │ Agents work in parallel visually.        │ separation or pane.        │
  ├─────┼──────────────────────┼────────┼──────────────────────────────────────────┼────────────────────────────┤
  │  3  │ Worktree isolation   │ High   │ Each agent gets its own git worktree    │ No worktree isolation.     │
  │     │                      │        │ with isolated branch. No conflicts.      │ All agents share one       │
  │     │                      │        │                                          │ working directory.          │
  ├─────┼──────────────────────┼────────┼──────────────────────────────────────────┼────────────────────────────┤
  │  4  │ Recursive fork       │ Medium │ Agents can be forked (but not re-forked)│ Sub-agents are single-     │
  │     │ prevention           │        │ with explicit depth=1 limit enforced.    │ level. No fork depth       │
  │     │                      │        │                                          │ tracking needed.            │
  └─────┴──────────────────────┴────────┴──────────────────────────────────────────┴────────────────────────────┘

---

## Problem → Solution Log

### Sub-agent registry — DONE
**Problem:** No way to inject domain expertise mid-conversation. The agent had to know everything or nothing.
**Solution:** `SubAgentRegistry` with Register/Activate/Deactivate. Active agents inject prompt additions into system prompt and extend the tool allowlist. Thread-safe with RWMutex.
**Files:** `coder/subagent.go`

### Space specialist — DONE
**Problem:** Space development requires deep knowledge of CLI commands, manifest format, IIFE build, SDK APIs, theme variables, and the graph system. Too much to put in the main system prompt.
**Solution:** `SpaceSubAgent()` returns a pre-configured sub-agent with 8 space tools and a comprehensive prompt covering scaffold, build, dev, graph, styling, and workflow. Triggered by "construct space" in task text.
**Files:** `coder/subagent_space.go`

### Auto-detection — DONE
**Problem:** User shouldn't need to manually activate sub-agents. The system should detect when specialization is needed.
**Solution:** `DetectAndActivate()` scans task text for trigger patterns. Case-insensitive substring match. Returns list of newly activated IDs.
**Files:** `coder/subagent.go`

### Fork-based cache sharing — NOT STARTED
**Problem:** Our sub-agents inject into the main context rather than running as separate processes. This means no cache sharing benefit — each added prompt increases main context size.
**Solution:** Would require a separate agent runner that inherits the parent's message prefix byte-for-byte, enabling API-level prompt cache sharing. Architecture change needed.
**Remaining:** Fork execution model, cache topology optimization, worktree isolation.
