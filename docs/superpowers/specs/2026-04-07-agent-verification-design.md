# Agent Verification System

Date: 2026-04-07

## Problem

Verification is broken across all agents. The verifier agent exists but is optional and manual. No agent is forced to verify its output before claiming "done." Self-verification is fundamentally flawed — the same agent that produced the work is biased by its own reasoning and cannot objectively evaluate it.

Specific gaps:
- Coder marks goals done without independent verification
- Architect produces plans nobody checks for missing logic
- Coordinator returns delegation results without validating them
- Morpheus creates dynamic agents but never evaluates their output
- The existing verifier prompt is weaker than Claude's (8 documented gaps in Verification.md)
- The `improve.go` feedback loop exists but is only called in tests

## Design Principles

1. **Fresh agent verification** — a new agent with no prior context verifies the work. No self-verification. Less tokens, no bias.
2. **Contract-based** — verifier gets the task description + acceptance criteria + a claim of what was done. It checks reality against the contract, not the reasoning.
3. **Mandatory** — runner enforces verification. Agents cannot skip it.
4. **3-strike escalation** — verify → agent fixes → verify → fresh fixer → verify → escalate to user.
5. **Morpheus learns** — verification failures feed Morpheus's pattern detection for long-term improvement.

## Architecture

### Module: `operator/internal/verification/`

A shared service called by any agent module. Not tied to any single agent.

```
operator/internal/verification/
  profile.go      ← VerificationProfile type, profile registry
  flow.go         ← 3-strike orchestration logic
  findings.go     ← findings file format, read/write
  verifier.go     ← spawn fresh verifier with context assembly
  fixer.go        ← spawn fresh fixer with findings + original task
```

### Verification Profile

Each agent type registers a profile. Runner checks: no profile = agent cannot be used.

```go
type VerificationProfile struct {
    AgentType       string                    // "coder", "architect", "morpheus"
    TriggerOn       TriggerCondition          // GoalDone, PlanComplete, DelegationResult
    ContextBuilder  func(ctx) VerifierContext  // extracts what the verifier needs
    FindingsPath    func(ctx) string           // "goal-xxxx-findings.md" or "plan-findings.md"
    MaxStrikes      int                        // default 3
    Playbook        string                     // change-type verification playbook to inject
}
```

### Verifier Context

What the fresh verifier agent receives — nothing more:

```go
type VerifierContext struct {
    OriginalTask       string   // what was requested
    AcceptanceCriteria string   // what success looks like
    Claim              string   // what the agent says it did
    FilesChanged       []string // paths modified
    Playbook           string   // change-type specific guidance
}
```

No conversation history. No reasoning. Just the contract and the claim.

### 3-Strike Flow

```
Strike 1: Agent marks done
  → Runner calls verification.Run(profile, context)
  → Spawns fresh verifier agent (new session, read-only tools)
  → Verifier checks claim against reality
  → Writes findings file
  → PASS → done
  → FAIL → Strike 2

Strike 2: Original agent gets findings file
  → One chance to fix
  → Re-triggers verification (fresh verifier again)
  → PASS → done
  → FAIL → Strike 3

Strike 3: Fresh fixer agent spawned
  → Gets: original task + criteria + findings (no prior reasoning)
  → Same write tools as original agent
  → Fixes → re-triggers verification
  → PASS → done
  → FAIL → escalate to user with all findings
```

### Fixer Agent Context

The fixer knows WHAT to build and WHAT is wrong, but not HOW the previous agent tried:

1. Original task/goal description — what we're trying to achieve
2. Acceptance criteria — what success looks like
3. Findings file — what specifically is wrong right now
4. Read/write access to relevant files — same tools as original agent

Does NOT get:
- Original agent's conversation history
- Original agent's reasoning about approach
- First fix attempt's reasoning

## Runner Interception

### Trigger Points

The runner watches for structured signals, not natural language:

- `goal_update(status: "done")` → coder verification
- Agent final response with plan output → architect verification
- All `coordinate` workers return → coordinator verification
- Morpheus task complete event → morpheus verification

### Flow Control

1. Runner detects completion signal
2. Runner pauses current agent turn (no response sent to user yet)
3. Runner calls `verification.Run(profile, context)`
4. Verification module spawns fresh verifier, runs checks, writes findings
5. On PASS → runner lets original completion through
6. On FAIL strike 1 → runner injects findings path into original agent's next turn as system attachment: "Verification failed. Read {findings-path} and fix the issues. You have one attempt."
7. On FAIL strike 2 → runner kills original agent's turn, spawns fixer agent, fixer works, re-triggers verification
8. On FAIL strike 3 → runner emits escalation to user with findings file path, agent pauses

### Token Budget

- Verifier agent: capped context — only VerifierContext + tool results. Short-lived, under 20 tool calls typically.
- Fixer agent: same cap as original agent, starts clean. Only reads findings + source files.
- Total overhead per verification: ~1 verifier spawn. Worst case (all 3 strikes): 3 verifier spawns + 1 fixer spawn.

## Agent Integration

### Coder

Trigger: `goal_update(status: "done")`

Context:
- Goal description + acceptance criteria (from goal store)
- Claim: agent's last message before marking done
- Files changed: git diff since goal started
- Playbook: detected from file types changed (frontend/backend/etc.)

### Architect

Trigger: architect calls `plan_complete` tool or emits structured plan output (needs a structured signal added — same pattern as coder's `goal_update`)

Context:
- Original user request / requirements
- Claim: the plan document itself
- Playbook: "refactor" or "config" depending on plan type

Verifier checks:
- Missing logic / unhandled edge cases
- Internal contradictions
- Feasibility (references to files/APIs that don't exist)
- Scope gaps (requirements not addressed in plan)

### Coordinator

Trigger: all delegated workers return results

Context:
- Original coordination task
- Each worker's result summary
- Files changed across all workers
- Playbook: based on task type

Verifier checks:
- Workers didn't conflict (no overlapping file edits)
- Combined result satisfies original task
- No integration gaps between worker outputs

### Morpheus

Trigger: dynamic agent completes a task

Context:
- Task that triggered the wake
- Dynamic agent's output
- Files changed
- Playbook: based on task type

Verifier checks:
- Task actually resolved (not just attempted)
- No regressions introduced
- Policy level was respected (no writes in observe mode)

### Registration

Each agent module calls `verification.Register(profile)` during init. Runner checks: no registered profile = agent cannot claim completion.

## Verifier Prompt Upgrade

Upgrade `operator/internal/coreagents/configs/verifier.md` to close all 8 gaps documented in `/Users/flakerim/Construct/Verification.md`.

### PARTIAL Semantics (tighten)

- PASS = all checks pass + at least one adversarial probe attempted
- FAIL = any check found a real problem
- PARTIAL = environment prevented full verification (missing runtime, no browser, external service down) — never for actual failures

### Side-Effect Contradiction (resolve)

Remove "no side effects beyond reading." Replace with:
- No project-modifying actions (no writes, installs, git mutations)
- Verification commands may create normal ephemeral artifacts (build output, coverage, caches)
- Temp helper scripts allowed only outside project tree (`$TMPDIR`)

### Mandatory Adversarial Probe Before PASS

Before issuing PASS, verifier MUST attempt at least one adversarial probe:
- Boundary values / empty inputs
- Concurrency / race conditions
- Idempotency (run it twice)
- Orphan operations (what if parent fails mid-way)
- Missing/malformed config

No probe attempted = cannot issue PASS.

### Anti-Rationalization Guardrails

Explicit failure modes the verifier must recognize in itself:
- "The code looks correct" → run the command, don't read it
- "Tests already pass" → tests passing doesn't mean the feature works
- "This is probably fine" → probably is not evidence
- "I don't have the right tool" → use PARTIAL, don't fake a PASS
- "This would take too long" → not a reason to skip

If writing an explanation instead of running a command, stop and run the command.

### Change-Type Playbooks

Injected based on profile's Playbook field:

| Change Type | Verification Focus |
|---|---|
| Frontend | Visual render check, accessibility, responsive, error states |
| Backend/API | Endpoint contracts, status codes, auth, payload validation |
| CLI/Script | Exit codes, help text, flag combinations, piped input |
| Config/Infra | Syntax validation, env propagation, rollback safety |
| Bug fix | Original repro case must fail before fix, pass after |
| Refactor | Behavior identical before/after, no API surface change |
| Migration | Up + down, data preservation, idempotency |

### Tool Awareness

Verifier inspects available tools at start. If browser, web, or MCP tools are available, use them. Don't assume a fixed narrow set.

### FAIL Discipline

Before issuing FAIL, check:
- Is this intentional behavior?
- Is it already handled elsewhere?
- Is it actionable by the agent?

Real problems only. No false alarms.

### Output Format

Per check:
```
## Check: [name]
Command: [exact command run]
Output: [relevant output]
Verdict: PASS | FAIL
Reason: [one line]
```

Final verdict:
```
## Verdict: PASS | FAIL | PARTIAL
[If FAIL: list each failing check with file:line]
[If PARTIAL: list what couldn't be verified and why]
```

Bad example: "Everything looks good, tests pass. PASS"
Good example: "Build passed. Tests passed (42/42). Adversarial: empty input to /api/tasks returns 400 with validation error as expected. PASS"

## Findings File Format

### Naming

- Coder goal: `goal-{goalId}-findings.md`
- Architect plan: `plan-findings.md`
- Coordinator delegation: `delegation-{taskId}-findings.md`
- Morpheus dynamic agent: `agent-{agentId}-findings.md`

All written to the project working directory.

### Format

```markdown
# Findings: {goal/plan description}

Strike: {1|2|3}
Agent: {agent type that produced the work}
Date: {timestamp}

## Original Task
{original task/goal description}

## Acceptance Criteria
{criteria from goal or plan requirements}

## Claim
{what the agent said it did}

## Checks

### [Check Name]
- Command: {exact command}
- Output: {relevant output, truncated if long}
- Verdict: PASS | FAIL
- Reason: {one line}

### [Adversarial Probe: Check Name]
- Command: {exact command}
- Output: {relevant output}
- Verdict: PASS | FAIL
- Reason: {one line}

## Verdict: FAIL

## Action Required
{concise list of what specifically needs fixing}
- {file:line — what's wrong}
- {file:line — what's wrong}
```

### Lifecycle

- Strike 1 findings → original agent reads, fixes, overwritten by strike 2 verification
- Strike 2 findings → fixer agent reads, fixes, overwritten by strike 3 verification
- Strike 3 findings → escalated to user as-is
- On PASS → findings file deleted (clean workspace)

## Stream Events

New events for frontend visibility:

- `verification.started` — { goalId, strike, agentType }
- `verification.passed` — { goalId, agentType }
- `verification.failed` — { goalId, strike, findingsPath, agentType }
- `verification.escalated` — { goalId, findingsPath, agentType }
- `verification.fixer_spawned` — { goalId, agentType }

## Morpheus as Verification Observer

Morpheus does not interfere with the 3-strike flow. It watches all verification events and learns from patterns over time. Verification module handles fixing. Morpheus handles improving.

### What Morpheus Observes

Every verification event feeds into Morpheus observer:
- Which agent type failed
- Which checks failed (from findings file)
- What category (frontend, API, config, etc.)
- Which strike it reached before passing (or escalating)
- The adversarial probe that caught it

### Pattern Detection

| Pattern | Action |
|---|---|
| Coder repeatedly fails same check type | Install relevant skill or add to coder overlay |
| Architect plans keep missing same gap | Adjust architect overlay or create planning checklist |
| Specific tool keeps erroring | Create specialist agent for that domain |
| Strike 3 reached frequently for a domain | Create persistent specialist agent |
| Fixer agent succeeds where original failed | Analyze what fixer did differently, feed insight back |

### Wiring Existing Code

- `RecordVerification()` in `dynagent/improve.go` — called by verification module after every verdict
- `SuggestPromptFix()` in `dynagent/improve.go` — called by Morpheus when pattern threshold hit

Both currently exist but only called in tests. This design gives them real callers.

## Improvement Delivery — Local + Remote

Core agent prompts are baked into the Go binary. Morpheus can't edit them at runtime. Two paths for improvements:

### Path 1: Local — Application Support Overlays

Morpheus writes prompt overlays to the app data dir:

```
~/Library/Application Support/Construct/
  improvements/
    coder.overlay.md
    architect.overlay.md
    verifier.overlay.md
    patterns.json           ← tracked failure patterns with timestamps
```

At runtime, system prompt assembly becomes:

```
base prompt (from binary)
  + overlay (from Application Support, if exists)
  + project context + CLAUDE.md + memory + skills
```

Overlays are additive only — they append guidance, cannot remove core prompt sections. Example:

```markdown
## Local Improvements (auto-generated by Morpheus)

- Always check CSS accessibility (aria labels, contrast) on frontend goals — recurring failure pattern detected
- When editing API endpoints, verify response codes match OpenAPI spec — 3 past failures
```

User can review, edit, or delete overlays from the Morpheus cockpit.

### Path 2: Remote — Construct Telemetry Endpoint

Morpheus posts anonymized verification patterns to a Construct endpoint in the infra service (`/Users/flakerim/Construct/infra/source/`).

```json
{
  "agent_type": "coder",
  "failure_category": "frontend/accessibility",
  "check_failed": "aria-labels missing on interactive elements",
  "strike_reached": 2,
  "playbook_used": "frontend",
  "resolved_by": "fixer",
  "frequency": 3,
  "period_days": 7
}
```

What gets sent: failure categories, patterns, which playbook/check caught it, how resolved, frequency.

What does NOT get sent: user code, file contents, project names, paths, conversation history, anything identifying the user's work.

Opt-in only — telemetry sent only if user enables it in Settings.

### What Construct Does With Remote Data

- Aggregate across users to identify common failure patterns
- Improve core agent prompts in next release
- Strengthen weak verification playbooks
- After update, overlays addressing the same issues become redundant — Morpheus cleans up

### Overlay Lifecycle

- Overlays include the Construct version they were generated on
- After an update, Morpheus re-evaluates whether each overlay is still needed
- Redundant overlays auto-cleaned

## Infra Endpoint

New endpoint in `/Users/flakerim/Construct/infra/source/`:

- `POST /api/v1/morpheus/patterns` — receives anonymized verification pattern data
- Stores in database for aggregate analysis
- No user-identifying information accepted or stored
- Rate-limited per installation ID

## Deferred to Follow-Up

The following items from this spec are **not implemented in the MVP** and require follow-up work. They are explicitly deferred, not forgotten.

### Contract extraction requires goal/task tracking (P1)

The spec describes contract-based verification where the verifier receives the real goal description, real acceptance criteria, real changed files, and a per-goal findings path. The MVP passes the agent's actual response as the claim and (for coder) derives changed files from `git diff`, but `OriginalTask` and `AcceptanceCriteria` are still generic strings because there is no structured goal tracking system in the coder runtime.

To fix this:
- Build a goal tracking system (typed structs, not just prompt-level concepts)
- Wire each profile's `ContextBuilder` to pull the real goal/task/plan data at verification time
- Wire each profile's `FindingsPath` to produce `goal-{goalId}-findings.md`, `plan-findings.md`, etc.

Affected profiles: coder, architect, coordinator, morpheus.

### goalId in verification events (P2)

The spec and frontend event contracts include `goalId` on all verification events. The MVP emits `goalId: ""` because no goal ID exists at runtime. The frontend stores the empty value. Once goal tracking exists, populate `goalId` from the active goal in each profile's context.

### What IS shipped in the MVP

- Mandatory fresh-agent verification at runner completion (cannot be skipped)
- 3-strike cross-turn flow: verify → agent fixes → verify → fixer → verify → escalate
- Bulletproof verifier prompt (all 8 gaps from Verification.md closed)
- Findings files written on failure, deleted on pass
- Stream events emitted for all verification lifecycle stages
- Morpheus observer tracks verification patterns, detects recurring failures
- Local overlay system for prompt improvements
- Overlay injection into system prompt assembly
- Remote telemetry endpoint for aggregate analysis
- Telemetry opt-in setting

## Full System Flow

```
Agent works → marks goal/plan done
  → Runner intercepts → verification.Run()
    → Fresh verifier spawns (no prior context)
    → Checks claim against reality
    → PASS → done
    → FAIL → original agent fixes (strike 2)
      → FAIL → fresh fixer spawns (strike 3)
        → FAIL → escalate to user

Meanwhile, Morpheus observes all verification events:
  → Tracks patterns across sessions
  → Local: writes overlays → user's agents improve immediately
  → Remote: posts patterns → Construct improves core agents → next release is better
  → After update: redundant overlays cleaned up
```
