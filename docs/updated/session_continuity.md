# Session Continuity — What Claude Code Does, What We Need

## What Claude Code has

Source: leaked source code + human_eval.md

### Session persistence
- Every conversation saved as JSONL at `~/.claude/projects/{hash}/{sessionId}.jsonl`
- `--continue` resumes last session (messages + context restored)
- `--resume` picks a specific past session by ID
- `--fork-session` branches from a past conversation (creates new session with old context as starting point)

### Session memory extraction
- After compaction: extracts key context to a structured "session memory" file
- Preserves: task specs, file lists, workflow state, errors, learnings
- This survives compaction — even when old messages are dropped, the learnings persist
- Resuming a session = messages + session memory → agent knows what happened

### autoDream as forked subagent
- Runs as a separate agent loop with limited tools
- LLM understands the memories semantically
- Can detect meaning-level contradictions ("use npm" vs "use bun")
- Can rewrite memories in clearer form
- Runs in isolation — can't corrupt main context

## What we have

### Operator
- `session.Store` — in-memory + disk, saves messages per session
- `chatsession.Store` — chat session persistence with turn blocks
- `sessions.resume` — finds most recent session for agent+project
- `ai/module.go` — loads prior messages when `session_id` sent with new task
- `coder/session_state.go` — captures/restores file state, stored refs, permission mode

### Frontend (useCoder.ts)
- Persists to localStorage: messages, runnerSessionId, toolHistory (last 100)
- Key: `coder:{agentId}:{projectPath}`
- On project change: restores session from localStorage
- Sends `session_id` to operator for message history continuity

### Memory
- 3-layer system built (index → topics → transcripts)
- autoDream runs in-process with string matching (NOT LLM-powered)
- Memory extraction: keyword-based signal detection

## What to build (desktop app equivalents)

### 1. Auto-continue (= `--continue`)
**CLI:** `--continue` flag resumes last session
**Desktop:** When user opens project → coder automatically loads last session
**What's needed:**
- Frontend: `useCoder.ts` already does this via localStorage ✓
- Operator: `sessions.resume` already finds latest session ✓
- Missing: **session memory extraction** — when context is compacted, extract learnings to a session memory file that's re-injected on resume
- Missing: **operator-side session memory** — currently only localStorage (lost if user clears browser data)

### 2. Fork session (= `--fork-session`)
**CLI:** `--fork-session <id>` branches from past conversation
**Desktop:** "Branch from here" button on session history → new session starts with that context
**What's needed:**
- Operator: `sessions.fork` handler — copies messages from source session to new session
- Frontend: session history panel in coder space → "Fork" button per session
- Frontend: fork creates new session with parent messages + new user message

### 3. Session memory extraction
**What:** After compaction or session end, extract structured summary:
- Task: what was the user trying to do
- Files: which files were read/written/edited
- Workflow: what approach was taken
- Errors: what went wrong and how it was fixed
- Learnings: what the agent discovered about the codebase
**Where:** Saved as `{session_id}.memory.json` alongside session transcript
**When:** On compaction, on session end, on explicit `/compact`
**How it's used:** On resume, session memory is injected into system prompt alongside MEMORY.md index

### 4. autoDream as LLM sub-agent
**What:** Replace string-matching dream with an LLM-powered consolidation agent
**How:**
- Fork a sub-agent with limited tools (memory_read, memory_write, memory_search only)
- System prompt: "Review all memories. Merge duplicates. Resolve contradictions. Prune stale entries. Rewrite unclear memories."
- Agent reads topics, understands them semantically, rewrites/deletes as needed
- Runs in background after idle period (same trigger as current DreamRunner)
**Why:** String matching can't detect "use npm" vs "use bun" as contradicting. LLM can.

## Implementation plan

### Phase 1: Session memory extraction (operator + frontend)
- `coder/session_memory.go` — extract structured summary from messages
- `runner/runner.go` — call extraction on compaction + session end
- `runner/system_prompt.go` — inject session memory on resume
- Test: run a coding session, compact, resume → agent remembers learnings

### Phase 2: Fork session (operator + frontend)
- `sessions/module.go` — add `sessions.fork` handler
- `frontend/spaces/coder/composables/useCoder.ts` — fork support
- `frontend/spaces/coder/components/SessionHistory.vue` — session list + fork button
- Test: fork from past session, new session has old context

### Phase 3: autoDream as LLM sub-agent (operator)
- `coder/memory_dream.go` — rewrite RunDream to fork a sub-agent
- Sub-agent system prompt for memory consolidation
- Limited tool set: memory_read, memory_write, memory_search
- Test: create conflicting memories, run dream, verify resolution

## Files to modify

| File | Change |
|------|--------|
| `coder/session_memory.go` | NEW: extract structured summary from messages |
| `coder/memory_dream.go` | Rewrite: LLM sub-agent instead of string matching |
| `runner/runner.go` | Call session memory extraction on compact + end |
| `runner/system_prompt.go` | Inject session memory on resume |
| `sessions/module.go` | Add `sessions.fork` handler |
| `frontend/spaces/coder/composables/useCoder.ts` | Fork support + session memory restore |
| `frontend/spaces/coder/components/SessionHistory.vue` | NEW: session list with fork buttons |
| `frontend/spaces/coder/pages/CoderPage.vue` | Wire session history panel |

---

## Frontend Integration

### Auto-resume (already works)
`useCoder.ts` sends `session_id` on follow-ups → operator loads session memory → agent sees previous task, files, workflow, errors, learnings in system prompt. No changes needed.

### Fork session (needs frontend)
Operator endpoint: `sessions.fork` — copies messages from source session.

**Request:** `{ "source_id": "uuid", "message": "optional first message" }`
**Response:** `{ "messages": [...], "source_session_id": "uuid", "message_count": N }`

Frontend needs:
1. `useCoder.ts` → `forkSession(sourceId, message)` method
2. `SessionHistory.vue` → NEW component: list past sessions + "Fork" / "Continue" buttons
3. `CoderPage.vue` → wire session history panel (sidebar or dropdown)

### Session list
Operator endpoint: `sessions.chat_list` → returns all past sessions with metadata.

See `docs/updated/frontend_wiring.md` section 3 for full details.
