# Construct Operator vs Claude Code

Date: 2026-04-01

## Scope

This document compares:

- `construct-app/operator`
- `claude-code-source-code`

The focus is the operator runtime: agent loop, tool system, permissions, memory,
MCP, sessions, streaming, and delegation.

## Overall Assessment

Construct Operator is not a Claude Code clone. It is a cleaner Go sidecar that
ports many of Claude Code's runtime ideas into a local desktop service:

- one runner
- one shared tool registry
- provider abstraction
- hooks
- skills
- MCP integration
- project-context injection
- prompt caching
- sub-agent support

This is a strong architectural direction. The current gap is mostly harness
maturity, not the core design.

## What Operator Already Gets Right

- Central runtime assembly is clear and modular in `construct-app/operator/main.go`.
- The runner has the right core shape: provider -> prompt assembly -> tool use ->
  loop -> persistence.
- Tools, hooks, skills, spaces, plugins, and MCP all converge into one runtime
  surface.
- Agent config is compact and understandable.
- Prompt cache boundary logic exists and is explicitly modeled.
- Streaming transport and stream cancellation are present.
- The coder module already includes compaction, memory, cost tracking, file
  state, and sub-agent activation primitives.

## Where Claude Code Is Still Meaningfully Ahead

Claude Code has a much deeper product harness around the same loop:

- richer tool lifecycle and UI-facing tool context
- real permission pipeline with rules, prompts, and classifiers
- append-only JSONL transcript model with resume/fork restoration
- layered memory loading from global, user, project, and local sources
- more advanced stop-hook and background post-turn behavior
- richer multi-agent modes: fork, worktree, remote, shared task systems

Operator currently feels closer to "runtime core" than "full agent product."

## Key Findings

### 1. Streaming Tool Execution Has A Correctness Risk

The biggest issue I found is in the streaming tool path.

`streamCallWithExecutor()` submits streamed tool calls to the executor and calls
`MarkStreamDone()`, but the runner then immediately reads `executor.Results()`
without actually waiting for in-flight tool executions to finish.

Relevant files:

- `construct-app/operator/internal/runner/provider.go`
- `construct-app/operator/internal/runner/runner.go`
- `construct-app/operator/internal/runner/streaming_executor.go`

Impact:

- tool results can be missing from conversation state
- later turns may run without completed tool outputs
- this can also explain flaky stream-event behavior in integration tests

This is the highest-priority runtime bug.

### 2. Permission System Is Present But Not Yet Product-Grade

The permission model is conceptually on the right track, but the behavior is
still incomplete.

What exists:

- permission modes
- tool classification
- pre-hook enforcement in the coder module

Current limitations:

- `Ask` exists in the type model but is not truly implemented
- `ModeDefault` effectively denies non-safe tools instead of prompting
- `ModeAcceptEdits` still denies dangerous tools instead of asking
- the coder module currently initializes in `ModeBypass`

Relevant files:

- `construct-app/operator/internal/coder/permission.go`
- `construct-app/operator/internal/coder/coder.go`

Compared to Claude Code, this is still far behind its full rule engine and
interactive approval flow.

### 3. Session Persistence Is Simpler Than Claude Code's Transcript Model

Operator stores sessions as full JSON snapshots.

Relevant file:

- `construct-app/operator/internal/session/session.go`

Claude Code uses append-only JSONL transcripts with richer restore, resume,
fork, compaction-boundary handling, and sub-agent transcript handling.

Relevant file:

- `claude-code-source-code/src/utils/sessionStorage.ts`

Operator's approach is simpler and easier to understand, but less flexible for:

- partial recovery
- large sessions
- replay/debugging
- sophisticated resume semantics

### 4. Instruction Loading Is Too Shallow Relative To Claude Code

Operator reads only root-level:

- `agents.md`
- `AGENTS.md`
- `CLAUDE.md`

Relevant file:

- `construct-app/operator/internal/runner/system_prompt.go`

Claude Code has a much richer instruction and memory model:

- managed memory
- user memory
- project memory
- local memory
- nested discovery
- include support
- priority ordering

Relevant file:

- `claude-code-source-code/src/utils/claudemd.ts`

Operator is directionally correct here, but still much more basic.

### 5. Coder Memory Infrastructure Exists But Is Only Partially Wired

The coder layer already has:

- memory index
- topic files
- transcript search
- dream/consolidation support
- transcript recording helpers

Relevant files:

- `construct-app/operator/internal/coder/runner_adapter.go`
- `construct-app/operator/internal/coder/memory_index.go`
- `construct-app/operator/internal/coder/memory_transcript.go`

However, the main runner wiring only injects:

- compactor
- file tracker
- agent resolver

It does not wire the stop-hook or transcript/dream behavior into the runner in
the same way the code comments suggest.

Relevant file:

- `construct-app/operator/main.go`

So part of the memory architecture exists in code but is not fully activated in
the shipped runtime path.

### 6. Sub-Agent Support Is Simpler Than Claude Code's

Operator's `spawn_agent` is synchronous nested delegation through the same
runner.

Relevant file:

- `construct-app/operator/internal/runner/spawn.go`

This is useful, but much smaller in scope than Claude Code's multi-mode agent
model:

- in-process
- forked
- worktree
- remote
- shared task/message coordination

Operator has the beginnings of this idea, but not the full operating model.

### 7. Transport Is Practical And Clear

Operator's shipped runtime is a local TCP sidecar with newline-delimited JSON.

Relevant files:

- `construct-app/operator/internal/transport/tcp.go`
- `construct-app/operator/docs/how-it-works.md`

This is a good fit for Construct desktop. It is much narrower than Claude
Code's CLI, SDK, and bridge layers, but the local transport is straightforward
and easy to reason about.

## Strengths

- Small enough to understand end-to-end.
- Better dependency visibility than Claude Code's much larger TS runtime.
- Good modular boundaries between runner, providers, tools, hooks, skills, and
  transport.
- Strong base for a desktop-first agent service.
- Already captures several real Claude Code patterns instead of superficial UI
  mimicry.

## Risks

- Streaming correctness bug around tool completion.
- Permissions are not yet trustworthy enough for a "safe by default" claim.
- Session model may become limiting as resume/fork/history grows.
- Memory system may look more complete than it is because some pieces are not
  fully wired into the live runner.
- Live integration tests currently depend on nondeterministic provider behavior.

## Test Note

I ran:

```bash
go test ./...
```

in:

```bash
/Users/flakerimi/Construct/construct-app/operator
```

Result:

- most packages passed
- `internal/integration` failed in live-model tests

Observed failures:

- `TestAgentResponse`
- `TestToolExecution`
- `TestSessionPersistence`

These failures are consistent with stream/event-contract fragility and
live-provider nondeterminism.

## Priority Recommendations

1. Fix the streaming executor wait bug first.
2. Turn the permission model into a real allow/ask/deny pipeline.
3. Wire transcript recording and post-turn memory behavior into the live runner.
4. Upgrade session persistence toward append-only transcript logs.
5. Expand instruction loading beyond root-only `CLAUDE.md` style files.
6. Keep the current Go modularity while borrowing more of Claude Code's harness
   behavior selectively.

## Bottom Line

Construct Operator is already a credible agent runtime. It is not yet at Claude
Code's harness depth, but the architecture is strong and the gaps are mostly
specific, fixable runtime/product issues rather than a bad foundation.
