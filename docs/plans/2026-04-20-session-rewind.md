# Session Rewind ("Start from here")

## Idea

When a session goes off the rails — LLM hallucinates, side quest with no end, wrong tool path — let the user point at any earlier user message and say **"rewind to here"**. The conversation is truncated to that point, files are restored to their snapshot at that turn, and the chat resumes as if the bad stretch never happened.

Inspired by Claude Code's double-ESC ("edit previous message") and pi code's `/tree`. Ships as MVP (linear rewind); a tree-of-branches variant is a follow-up.

## Requirements

- **Rewind entry point**: hover/right-click any user message in the session view → "Rewind to here" action. Keyboard shortcut: double-ESC.
- **Preview before commit**: modal shows (a) turn count that will be discarded, (b) list of irreversible side effects that rewind will NOT undo (git commits, pushes, network mutations, background tasks).
- **Conversation truncation**: session events after turn N are removed from the session state on disk.
- **File restore**: files touched since turn N are restored from the per-turn snapshot in `harness/file_snapshot.go`.
- **Budget + cache reset**: turn budget counters, context budget stored results, and cache markers that belong to discarded turns are dropped.
- **Resume seamlessly**: UI reloads the session; the input composer shows the message the user had sent at turn N+1 (or empty), ready to re-prompt.
- **Non-destructive option**: an advisory toggle "keep a branch of the old timeline" that writes the discarded tail to `<sessionDir>/branches/<ts>.json`. Not browsable in MVP — only safety net for `construct session restore`.

## Out of Scope (MVP)

- Tree UI for multi-branch navigation (`/tree`).
- Automatic rewind heuristics (detect hallucination, auto-suggest).
- Undoing side effects (git revert, API rollback).
- Partial rewind (rewind files but keep conversation, or vice versa).

## Architecture

### Operator

- New route `session.rewind` in `internal/sessions/module.go` (or wherever session.* routes live).
  - Payload: `{ session_id, turn_index, keep_branch: bool }`.
  - Steps:
    1. Load session state.
    2. Compute `events[:cutoff]` where `cutoff` is the event index at `turn_index`.
    3. Optionally snapshot `events[cutoff:]` to `branches/<ts>.json`.
    4. Restore file snapshot from `harness.FileSnapshot` at turn N.
    5. Truncate budget counters, stored tool results in `ContextBudget`, file cache entries that belong to discarded events.
    6. Emit `session.rewound` event.
- Extend `harness.SaveSessionState` to accept a truncation parameter, or expose `TruncateSessionState(state, cutoff)`.
- `harness/file_snapshot.go` already snapshots per turn; verify it supports "restore to turn N" and add if missing.
- Detect irreversible operations during the rewind preview call (`session.rewind_preview`):
  - Git commits since turn N (parse `bash` tool results for `git commit`, or query repo).
  - `git push` calls.
  - Background tasks spawned and still running (from `harness.Tasks`).
  - Network-mutation tools (curl POST/PUT/DELETE, MCP side-effect tools).

### Frontend

- `frontend/operator/useAgentSession.ts` — add `rewind(turnId)` and `rewindPreview(turnId)` composable methods.
- Session view component (wherever messages render) — hover action + context menu on user-message bubbles.
- Modal: `frontend/components/session/RewindConfirmModal.vue`
  - Shows: turns discarded, files that will be restored, warnings for irreversible ops.
  - Actions: Cancel, "Keep branch" checkbox, Rewind.
- Global shortcut: double-ESC triggers rewind on the most recent user message.
- After rewind: refresh session from operator, clear local transient state, focus composer.

### Data Model

- Session state on disk already sequential; just truncate.
- New dir: `<sessionDir>/branches/` for safety snapshots when `keep_branch=true`.
- File snapshot store: confirm retention policy — need snapshots to live as long as the session, not be pruned.

## Tradeoffs

- **File rollback only covers files.** Git commits/pushes, API calls, DB writes, outgoing messages do not unwind. The preview modal must make this explicit.
- **Snapshot storage cost.** Per-turn filesystem snapshots can get expensive for big projects. Mitigation: snapshots are already content-addressed (see `harness/file_snapshot.go`) — verify dedup, set a retention cap per session.
- **Tree vs. linear.** Linear is simple and matches 90% of the "oh no, rewind" use case. Branching (tree) is a much bigger UI + model change; defer until we see users asking for it.
- **Resume from mid-turn vs. clean cut.** MVP cuts at user-message boundaries only (turn N = "before this user message"). Cutting mid-assistant-response is messier — skip.

## Milestones

1. **M1 — Preview only.** `session.rewind_preview` route + modal that shows "this would discard N turns, restore M files". No actual rewind. Lets us validate the detection of irreversible ops.
2. **M2 — Rewind without file restore.** Conversation-only truncation + UI. Useful for chat where no files were touched.
3. **M3 — File restore.** Wire `harness/file_snapshot` restore into the rewind flow.
4. **M4 — Safety branch.** `keep_branch=true` path + CLI `construct session restore <branch>` to recover accidental rewinds.
5. **M5 — Double-ESC shortcut + polish.**

## Open Questions

- Do we rewind just in the current session, or offer "fork into new session" too? (Probably add later as variant.)
- Snapshot retention: keep snapshots for all past turns, or only the last N?
- Should background tasks spawned in discarded turns be cancelled automatically, or only warned about?
- Do we integrate with the existing verification system — i.e. can a failed verification auto-prompt "rewind to last green"?

## Open File Pointers

- `operator/internal/harness/session_state.go` — session persistence
- `operator/internal/harness/file_snapshot.go` — per-turn file snapshots
- `operator/internal/harness/context.go` — stored tool results that may need truncating
- `operator/internal/harness/task.go` — background tasks to check
- `operator/internal/sessions/module.go` — session IPC routes
- `frontend/operator/useAgentSession.ts` — session state on the client
