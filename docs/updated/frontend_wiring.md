# Frontend Wiring Guide

What the operator built and how the frontend should connect to it.

---

## 1. Session Memory Extraction

**Operator:** Automatic — fires on session completion, no frontend action needed.
**Storage:** `~/Library/Application Support/Construct/coder/session-memories/{session_id}.memory.json`

**What it extracts:**
- `task` — first user message
- `files[]` — path + action (read/write/edit)
- `workflow[]` — tool call sequence (bash commands, file ops)
- `errors[]` — tool errors + resolution
- `learnings[]` — assistant discoveries ("I found that...", "the issue was...")

**Frontend reads it:** Not directly. The operator injects it into the system prompt on resume.

---

## 2. Session Memory on Resume

**Operator:** When `agents.dispatch_stream` receives `session_id`, it loads that session's memory and injects it into the system prompt.

**Frontend already does this:** `useCoder.ts` sends `session_id` on follow-up messages:
```ts
operator.stream('agents.dispatch_stream', {
  agent_id: resolvedAgentId,
  task: trimmed,
  model,
  session_id: runnerSessionId.value,  // ← this triggers memory injection
  project_path: projectPath.value,
})
```

**What the agent sees on resume:**
```
## Session Memory (from previous session)
Session: abc12345 | Agent: coder | Turns: 15
**Task:** Build a habit tracker space
**Files touched:** space-habits/src/pages/index.vue (write), ...
**Workflow:** 1. bash: bun install  2. write_file: src/pages/index.vue ...
**Errors:** build failed → fixed with: edit_file
**Learnings:** The project uses @construct-space/ui for components
```

**No frontend changes needed** — already works through existing session_id flow.

---

## 3. Fork Session

**Operator endpoint:** `sessions.fork`

**Request:**
```json
{
  "type": "sessions.fork",
  "payload": {
    "source_id": "previous-session-uuid",
    "message": "Now refactor the auth module"
  }
}
```

**Response:**
```json
{
  "messages": [...copied messages + new user message...],
  "source_session_id": "previous-session-uuid",
  "source_turns": 15,
  "message_count": 32
}
```

**Frontend wired:**
1. `useCoder.ts` — `forkSession(sourceId, message)` + `listSessions()`:
   - `forkSession` calls `operator.send('sessions.fork', { source_id, message })`, clears current session, populates forked messages, kicks off new session with last user message
   - `listSessions` calls `operator.send('sessions.chat_list', {})` → returns session array
2. `SessionHistory.vue` — component in `spaces/coder/components/`:
   - Lists past sessions via `listSessions()` (excludes current, max 20)
   - Each session shows: task preview, agent, turn count, relative date
   - Collapsible panel matching BackgroundTasks style
   - Hover-reveal "Continue" (Play icon) and "Fork" (GitFork icon) buttons
3. `CoderPage.vue` — SessionHistory in right pane between BackgroundTasks and GoalProgress
   - Auto-loads when no active messages
   - Fork → `coder.forkSession(id, '')`, Continue → `coder.setProjectPath()`

---

## 4. Memory Tools (agent-facing, not user-facing)

**Operator tools:** `memory_read`, `memory_write`, `memory_search`, `memory_list`

These are tools the agent calls — the frontend doesn't interact with them directly. But the frontend DOES receive memory signals via the stream:

**Stream events to handle:**
- When the agent calls `memory_write`, the tool result appears in `tool.result` events
- Frontend can show a toast: "Saved to memory: {topic name}"

**Frontend wired:**
- `useStreamStatus.ts` — detects `tool.result` where `tool === "memory_write"`, extracts topic name from result content, surfaces as progress update: "Saved to memory: {topic}"
- `MemoryBrowser.vue` — browseable memory panel in coder right pane. Toggle via Brain icon in toolbar. Lists all topics via `memory_list`, reads content via `memory_read`. Expandable cards with type icons (user/feedback/project/reference), search/filter, lazy-loads content on expand.

---

## 5. Permission Control

**Operator endpoint:** `coder.set_permission_mode`

**Request:**
```json
{
  "type": "coder.set_permission_mode",
  "payload": { "mode": "accept_edits" }
}
```

**6 Modes:**
- `bypass` — allow everything (fast, dangerous)
- `accept_edits` — allow writes, deny bash/spawn
- `plan` — read-only
- `default` — safe allowed, write/dangerous → ask
- `dont_ask` — deny everything non-safe without prompting (for background agents)
- `auto` — LLM classifier decides per action (safe always allowed, others classified)

**Glob-style rules** (Claude Code pattern):
```json
{
  "permissions": {
    "allow": [
      "Bash(npm *)",
      "Bash(git *)",
      "Edit(src/**)",
      "Write(src/**)"
    ]
  }
}
```
Rules checked before mode. Supports: tool name, wildcard `*`, glob `Bash(npm *)`, pattern matching.

**Auto classifier:** When mode is `auto`, operator calls an `AutoClassifierFunc` for non-safe tools. Returns allow/deny/ask per action. Set via `SetAutoClassifier()` in operator. Frontend can select `auto` mode same as others.

**Frontend already wired:**
- `PermissionControl.vue` — cycle button in toolbar
- `CoderPage.vue` — calls `operator.send('coder.set_permission_mode', { mode })`
- `useStreamStatus.ts` — handles `permission.mode` and `permission.denied` events

---

## 6. Background Tasks

**Stream events:**
- `task.spawned` — `{ task_id, label, agent_id }` → show in BackgroundTasks panel
- `task.progress` — `{ task_id, tool_count, last_tool, tokens }` → update progress
- `task.complete` — `{ task_id, result }` → mark done
- `task.failed` — `{ task_id, error }` → mark failed

**Frontend already wired:**
- `BackgroundTasks.vue` — shows in right panel of CoderPage
- `useStreamStatus.ts` — handles all task.* events
- `useCoder.ts` — exposes `backgroundTasks` ref

---

## 7. Construct Space Detection

**Frontend:** `useProjectRunner.ts` — detects `space.manifest.json` in project root or `space-*/` subdirectory.

**What it does:** Shows "Construct Space" as project type in RunControls toolbar instead of "Vite + Vue".

**Run configurations for spaces:**
- Development → `construct dev` (watch mode)
- Build → `construct build`
- Install → `bun install`
- Test → `construct check`

---

## 8. Editor Space

**Route:** `/app/projects/:projectId/editor` or `/app/editor`
**Requires:** Developer mode enabled in settings

**Components:**
- `EditorPage.vue` — main page (Monaco + file tree + tabs + bottom panel + status bar)
- `EditorMonaco.vue` — Monaco editor with Construct dark theme
- `EditorTabs.vue` — tab bar with dirty indicators
- `EditorFileTreeItem.vue` — recursive file tree with vscode-icons
- `EditorBottomPanel.vue` — resizable bottom panel with Terminal + Problems tabs. Collapsible via Cmd+J or Cmd+`. Drag handle to resize (100-600px). Collapsed state shows minimal tab bar.
- `EditorTerminal.vue` — xterm.js terminal backed by Tauri PTY. Uses `pty_spawn`, `pty_write`, `pty_resize`, `pty_kill` IPC commands. Listens to `pty-output` and `pty-exit` events. Auto-fits on resize, restart button on exit.

**Keyboard shortcuts:**
- `Cmd+S` — save file
- `Cmd+B` — toggle sidebar
- `Cmd+W` — close tab
- `Cmd+J` / `Cmd+`` — toggle bottom panel

**Settings:** Persisted to `~/Library/Application Support/Construct/editor.json`
- Icon theme (Material / VS Code / Seti)
- Font family, size, ligatures
- Tab size, word wrap, line numbers, minimap
- Settings tab inside Developer settings page

---

## 9. Budget Milestones

**Operator:** Emits `status` event at 25%, 50%, 80%, 90%, 95%, 100% budget usage.

**Stream event:**
```json
{
  "type": "status",
  "data": {
    "state": "thinking",
    "message": "Budget: 80% used — Tokens: 50000 input, 12000 output | Cost: $0.42"
  }
}
```

**Frontend already handles:** `useStreamStatus.ts` processes status events → shows in UI.

---

## 10. LSP Tools

**Operator tools:** `lsp_diagnostics`, `lsp_definition`, `lsp_references`

These are agent tools — the coder agent uses them after editing files to check for errors. No frontend wiring needed. The agent's tool calls appear in the stream as `tool.call` / `tool.result` events.

---

## 11. Agent Loop Changes (operator internals — no frontend wiring but affects behavior)

These are all in `runner/runner.go` Run() loop. The frontend sees the effects through existing stream events.

### Streaming tool execution
**What:** Tools start executing during LLM streaming, not after full response.
**Effect:** Faster turns — tool latency hidden under model output time.
**Frontend sees:** `tool.call` and `tool.result` events arrive sooner. No code changes needed.

### Per-tool concurrency
**What:** Read-only tools (read_file, glob, grep, lsp_*) run in parallel. Write tools (bash, write_file) run exclusively.
**Effect:** Multiple file reads happen simultaneously. Bash never runs alongside other tools.
**Frontend sees:** Multiple `tool.call` events may fire before their `tool.result` events.

### Retry on 413/429/529
**What:** Context overflow (413) → emergency compact + retry. Rate limit (429/529) → backoff 2s/4s/6s, retry 3x. 3rd retry falls back to non-streaming.
**Effect:** Sessions survive API errors instead of failing.
**Frontend sees:** `status` event: "Rate limited — retrying in Xs..." then normal resume.

### Snip compaction
**What:** When context > 80K chars and > 10 turns, old turns replaced with summary. Keeps last 6 turns intact.
**Effect:** Long sessions stay within context window. Agent sees summary of early work.
**Frontend sees:** `status` event: "Compacted context (freed N chars)".

### Structured output validation
**What:** For strict JSON schemas (architect.v1), validates response is valid JSON. Retries up to 5x.
**Effect:** Architect structured responses always parse correctly.
**Frontend sees:** No change — already parses JSON from assistant content.

### Stop hooks
**What:** Runs after each turn. Can prevent continuation. Foundation for memory extraction, skill prefetch.
**Effect:** Agent may stop early if a hook says so.
**Frontend sees:** Normal `done` event with `stop_reason: "hook"`.

### Sibling abort
**What:** Exclusive tool (bash) error cancels all parallel safe tools. Safe tool errors don't cascade.
**Effect:** If bash fails, pending file reads are cancelled. If a file read fails, bash keeps running.
**Frontend sees:** Some `tool.result` events may show as errors with cancelled context.

### Auto-continue with budget
**What:** Extends turn budget if agent is productive. Stops if budget exceeded or 3 low-delta turns.
**Effect:** Agent runs longer on complex tasks, stops on spinning.
**Frontend sees:** Budget milestone `status` events at 25%, 50%, 80%, 90%, 95%, 100%.

### Prompt cache split
**What:** System prompt split into static (cacheable) + dynamic (per-turn) with boundary marker.
**Effect:** API caches the static prefix. Only dynamic suffix costs tokens per turn.
**Frontend sees:** No visible change. Cost savings show in token usage events.

### Memory index in system prompt
**What:** MEMORY.md index (layer 1) loaded into system prompt every turn.
**Effect:** Agent always knows what memories exist. Can call `memory_read` to load details.
**Frontend sees:** Agent may use `memory_read`, `memory_write`, `memory_search` tools — visible as `tool.call`/`tool.result` events.

### Session memory on resume
**What:** When resuming a session, previous session's memory (task, files, workflow, errors, learnings) injected into prompt.
**Effect:** Agent on resume knows what happened before, even after compaction dropped old messages.
**Frontend sees:** No visible change — agent just behaves more contextually on resume.

### autoDream LLM consolidation
**What:** Background memory consolidation powered by an LLM sub-agent. Runs after idle period (>1h, >5 sessions, >3 topics). Semantically reviews memories — detects contradictions, merges duplicates, rewrites unclear entries, prunes stale ones.
**Effect:** Memory stays clean and accurate over time without user intervention.
**Frontend sees:** No direct visibility. Optional: show status indicator "Memory consolidation running..." when dream is active.
**Operator:** `DreamRunner.RunDream()` spawns a sub-agent with system prompt + memory tools. Falls back to structural (string matching) if LLM fails.

### Session memory extraction
**What:** On session completion, extracts structured summary: task, files touched, workflow steps, errors+resolutions, learnings.
**Storage:** `~/Library/Application Support/Construct/coder/session-memories/{session_id}.memory.json` (XOR+base64 encoded).
**Effect:** On resume, agent sees what happened before — even after old messages were compacted away.
**Frontend sees:** No direct visibility. The agent just behaves more contextually on resume.
**Trigger:** Automatic on session end. Extracted in a background goroutine.

### Session memory on resume
See §2 above — already works through existing `session_id` flow. No frontend changes needed.

---

## 12. Stop / Cancel Tool Execution

**Frontend already has:** `useCoder.stop()` calls `operator.stopStream(activeRequestId)` which cancels the TCP stream.

**What happens in the operator:**
- `transport.CancelStream(requestId)` → cancels the context for that stream
- `runner.Run()` checks `ctx.Err()` at the top of each turn → exits with "cancelled"
- `StreamingToolExecutor` — running tools get their context cancelled
- Sibling abort: if an exclusive tool is running, its cancel propagates to safe siblings

**Stream events on stop:**
- Running `tool.call` events that haven't completed → no `tool.result` (frontend should mark as cancelled)
- `done` event may or may not arrive depending on timing

**Frontend handling (already in useCoder.ts):**
```ts
async function stop() {
  if (activeRequestId) {
    try { await operator.stopStream(activeRequestId) } catch { /* ignore */ }
  }
  abortController?.abort()
  if (unlisten) { unlisten(); unlisten = null }
  activeRequestId = null
  isRunning.value = false
  persist()
  streamStatus.reset()
}
```

**No changes needed** — stop already works. The streaming executor respects context cancellation.

---

## What still needs frontend work

| Feature | What's needed | Priority |
|---------|--------------|----------|
| ~~Session History panel~~ | DONE — `SessionHistory.vue` in right pane | ~~High~~ |
| ~~Fork session~~ | DONE — `forkSession()` + `listSessions()` in `useCoder.ts` | ~~High~~ |
| ~~Memory notifications~~ | DONE — `useStreamStatus.ts` detects `memory_write` → progress update | ~~Low~~ |
| ~~Memory browser~~ | DONE — `MemoryBrowser.vue` in right pane, toggle via Brain icon in toolbar. Uses `memory_list` + `memory_read` tools | ~~Low~~ |
| ~~Editor terminal~~ | DONE — `EditorTerminal.vue` with xterm.js + Tauri PTY (`pty_spawn/write/resize/kill`) | ~~Medium~~ |
| ~~Editor bottom panel~~ | DONE — `EditorBottomPanel.vue` with Terminal + Problems tabs, resizable, collapsible (Cmd+J / Cmd+`) | ~~Medium~~ |
