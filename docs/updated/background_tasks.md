# Background Tasks — Claude Code vs Construct

  What Claude Code does:

  - Full task system with spawn, polling, and notifications
  - Fork-based: spawned tasks inherit parent context for cache sharing
  - Teammate mode: separate tmux/iterm panes for visual parallel work
  - Worktree mode: git worktree isolation per task
  - Task polling and progress tracking
  - Results communicated back to parent agent

  How it is now:

  ┌────┬───────────────────────────────┬──────────────────────────────────────────────────┬──────────────────────────┐
  │  # │ What we built                 │ How it works                                     │ File                     │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  1 │ Task manager                  │ Thread-safe map of TaskID → Task. States:        │ coder/task.go            │
  │    │                               │ running, completed, failed, cancelled. Register  │                          │
  │    │                               │ creates task with cancel func. List/Running      │                          │
  │    │                               │ queries.                                         │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  2 │ Task lifecycle                │ Register → running. Complete(id, result) or      │ coder/task.go            │
  │    │                               │ Fail(id, errMsg) → terminal state. Cancel(id)   │                          │
  │    │                               │ calls context cancel func + sets cancelled.      │                          │
  │    │                               │ Terminal states are final (no re-transition).    │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  3 │ Progress tracking             │ UpdateProgress(id, toolName, tokensUsed): bumps  │ coder/task.go            │
  │    │                               │ ToolCount, accumulates TokensUsed, records       │                          │
  │    │                               │ LastTool and LastUpdate timestamp. Only for      │                          │
  │    │                               │ running tasks.                                    │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  4 │ spawn_background tool         │ Agent tool: takes agent_id + task + optional     │ coder/spawn_bg.go        │
  │    │                               │ label. Creates context with cancel. Registers    │                          │
  │    │                               │ task. Spawns goroutine that runs spawnFn and     │                          │
  │    │                               │ calls Complete/Fail on exit. Returns task ID     │                          │
  │    │                               │ immediately.                                     │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  5 │ Stream event forwarding       │ Child agent gets its own emitter. Background     │ coder/spawn_bg.go        │
  │    │                               │ goroutine subscribes and forwards tool.call and  │                          │
  │    │                               │ token.usage events to parent emitter as          │                          │
  │    │                               │ task.progress events with task_id.               │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  6 │ check_task tool               │ Agent tool: returns JSON with id, agent_id,      │ coder/coder.go           │
  │    │                               │ label, state, tool_count, tokens, last_tool,     │                          │
  │    │                               │ result, error.                                   │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  7 │ cancel_task tool              │ Agent tool: calls TaskManager.Cancel(). Returns  │ coder/coder.go           │
  │    │                               │ success/not-found message.                       │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  8 │ Lifecycle events              │ 4 event types: task.spawned (id, label,          │ coder/coder.go           │
  │    │                               │ agent_id), task.progress (task_id, tool_count,   │ coder/spawn_bg.go        │
  │    │                               │ last_tool, tokens), task.complete (task_id,      │                          │
  │    │                               │ result), task.failed (task_id, error).           │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  9 │ Random task IDs               │ "bg-" prefix + 8 random chars from base-36       │ coder/task.go            │
  │    │                               │ alphabet. Fallback to timestamp-based on         │                          │
  │    │                               │ crypto/rand failure.                             │                          │
  └────┴───────────────────────────────┴──────────────────────────────────────────────────┴──────────────────────────┘

  The 3 gaps — Claude Code vs Construct:

  ┌─────┬──────────────────────┬────────┬──────────────────────────────────────────┬────────────────────────────┐
  │  #  │        Gap           │ Impact │            What they do                  │       What we do           │
  ├─────┼──────────────────────┼────────┼──────────────────────────────────────────┼────────────────────────────┤
  │  1  │ Cache-shared forking │ High   │ Forked tasks inherit byte-identical      │ Background tasks get a     │
  │     │                      │        │ parent context. API cache shared across  │ fresh emitter and run      │
  │     │                      │        │ parent + all forks. 5x cheaper.          │ independently. No cache    │
  │     │                      │        │                                          │ sharing with parent.       │
  ├─────┼──────────────────────┼────────┼──────────────────────────────────────────┼────────────────────────────┤
  │  2  │ Visual separation    │ Medium │ Teammate mode: separate tmux/iterm pane. │ Background tasks are       │
  │     │                      │        │ User sees parallel agents working.       │ invisible goroutines.      │
  │     │                      │        │                                          │ Progress via events only.  │
  ├─────┼──────────────────────┼────────┼──────────────────────────────────────────┼────────────────────────────┤
  │  3  │ Git worktree         │ Medium │ Each task gets its own git worktree.     │ All tasks share the same   │
  │     │ isolation            │        │ No file conflicts between parallel       │ working directory. File    │
  │     │                      │        │ agents.                                  │ conflicts possible.        │
  └─────┴──────────────────────┴────────┴──────────────────────────────────────────┴────────────────────────────┘

---

## Problem → Solution Log

### Task manager — DONE
**Problem:** No way to run agents in parallel. Long-running tasks blocked the main conversation.
**Solution:** `TaskManager` with thread-safe task map. Task lifecycle: Register (running) → Complete/Fail/Cancel (terminal). Progress tracking per task: tool count, token usage, last tool, timestamp. Cancel uses context.CancelFunc for clean shutdown. Random "bg-" prefixed IDs.
**Files:** `coder/task.go`

### spawn_background tool — DONE
**Problem:** The agent needs to be able to delegate work to parallel sub-agents and return to the user immediately.
**Solution:** `RegisterSpawnBackgroundTool()` adds a tool that takes agent_id + task. Creates a fresh context with cancel, registers the task, spawns a goroutine. The goroutine runs the SpawnFunc (maps to runner.Run), forwards progress events to the parent emitter, and calls Complete/Fail on exit. Returns task ID immediately so the agent can continue.
**Files:** `coder/spawn_bg.go`

### Progress forwarding — DONE
**Problem:** Background tasks run silently. Parent agent and user have no visibility into what's happening.
**Solution:** Child agent gets its own `stream.Emitter`. Background goroutine subscribes to all child events. `tool.call` events → `UpdateProgress()` + emit `task.progress` to parent. `token.usage` events → accumulate tokens. On completion: `task.complete` with result. On failure: `task.failed` with error. Parent emitter forwards all to frontend.
**Files:** `coder/spawn_bg.go`

### Check and cancel tools — DONE
**Problem:** Agent spawns a background task but has no way to check if it finished or cancel if it's stuck.
**Solution:** `check_task` tool returns full task state as JSON (id, agent_id, label, state, progress, result/error). `cancel_task` tool calls `TaskManager.Cancel()` which invokes the context cancel function and transitions to cancelled state. Both registered in `Module.RegisterTools()`.
**Files:** `coder/coder.go`
