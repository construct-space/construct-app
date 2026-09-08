# Morpheus: Self-Improving Autonomous Operator

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the coordinator create, persist, evaluate, and improve specialized agents, skills, and tools at runtime. Construct becomes a system that improves itself — the coordinator acts as CTO, spawning purpose-built workers and refining them based on results.

**Architecture:** Three layers — dynamic agent creation (Go runtime + on-disk configs), self-evaluation loop (verifier-gated feedback), and Morpheus autonomous mode (wake/sleep/schedule). Built on existing primitives: agent.Config, skill.Registry, tool.Registry, spawn_background, wait_task, verifier, attachment queue.

**Tech Stack:** Go (operator), Markdown (agent/skill configs), Vue 3 (Morpheus Space)

---

## Why This Matters

Construct currently has ~8 static agents. Every agent has the same coder knowledge regardless of the task. When the coordinator spawns "researcher" or "db-specialist", it gets a generic coder with a task description.

With self-improving agents:
- Coordinator says "I need a database migration specialist"
- System creates `db-migration-specialist` agent with a custom prompt focused on migrations, schema changes, and rollback safety
- If the agent fails verification, the coordinator rewrites its prompt with lessons learned
- Good agents persist to disk and improve over sessions
- Same pattern for skills and tools

This is what makes Construct a platform that gets better the more you use it.

---

## File Structure

```
operator/
  internal/
    morpheus/
      state.go          ← CREATE: session mode, wake/sleep state machine
      loop.go           ← CREATE: event-driven wake loop
      events.go         ← CREATE: wake event queue
      prompt.go         ← CREATE: Morpheus prompt section injection
      policy.go         ← CREATE: autonomy levels and permission policy
      sleep.go          ← CREATE: sleep tool
    dynagent/
      dynagent.go       ← CREATE: dynamic agent creation + persistence
      dynagent_test.go  ← CREATE: tests
      improve.go        ← CREATE: self-evaluation + prompt rewriting
      improve_test.go   ← CREATE: tests
    tool/
      builtin.go        ← MODIFY: register sleep + agent creation tools
      metadata.go       ← MODIFY: metadata for new tools
    runner/
      runner.go         ← MODIFY: Morpheus wake integration
      system_prompt_sections.go ← MODIFY: Morpheus prompt section
    coder/
      coder.go          ← MODIFY: wire Morpheus state
      spawn_bg.go       ← MODIFY: task-complete → wake event
    attachment/
      attachment.go     ← MODIFY: add Morpheus attachment types
    coreagents/configs/
      coordinator.md    ← MODIFY: teach dynamic agent creation
      coder.md          ← MODIFY: Morpheus prompt awareness
frontend/
  spaces/morpheus/      ← CREATE: Morpheus Space (cockpit UI)
```

---

### Task 1: Dynamic Agent Creation + Persistence

The foundation — let the coordinator create agents at runtime that persist to disk.

**Files:**
- Create: `operator/internal/dynagent/dynagent.go`
- Create: `operator/internal/dynagent/dynagent_test.go`

- [ ] **Step 1: Define DynamicAgent store**

```go
package dynagent

// Store manages dynamically created agents on disk.
// Agents are stored as markdown config files in {baseDir}/agents/{id}.md
// with YAML frontmatter matching the agent.Config shape.
type Store struct {
    mu      sync.RWMutex
    baseDir string                    // e.g. ~/Library/Application Support/Construct/agents/
    agents  map[string]*agent.Config  // loaded agents
}

func NewStore(baseDir string) *Store
func (s *Store) Create(cfg agent.Config) error      // write to disk + register
func (s *Store) Update(id string, cfg agent.Config) error  // overwrite
func (s *Store) Get(id string) *agent.Config         // lookup
func (s *Store) Delete(id string) error               // remove from disk
func (s *Store) List() []*agent.Config                 // all dynamic agents
func (s *Store) LoadAll() error                        // read all .md files from disk
```

- [ ] **Step 2: Implement disk persistence**

Each agent is a markdown file with YAML frontmatter:
```markdown
---
id: db-migration-specialist
name: DB Migration Specialist
description: Database schema migration and rollback expert
category: dynamic
maxIterations: 50
tools: [read_file, edit_file, bash, grep, glob, lsp_diagnostics]
created: 2026-04-05T12:00:00Z
version: 3
score: 0.85
---

You are a database migration specialist...
```

Extra fields for self-improvement: `version`, `score` (0-1 success rate), `created`, `parentAgent` (who created it).

- [ ] **Step 3: Write tests**

Test create, load, update, delete, list, and round-trip persistence.

- [ ] **Step 4: Commit**

---

### Task 2: Agent Creation Tool

Let the coordinator create agents via a tool call.

**Files:**
- Create: `operator/internal/dynagent/tools.go`
- Modify: `operator/main.go`

- [ ] **Step 1: Create `agent_create` tool**

```go
// agent_create — create a new specialized agent
// Input: { "id": "db-specialist", "name": "DB Specialist", "description": "...", "system_prompt": "...", "tools": ["bash", "read_file"] }
// Output: agent config JSON
```

- [ ] **Step 2: Create `agent_list_dynamic` tool**

Lists all dynamically created agents with their version and score.

- [ ] **Step 3: Create `agent_update` tool**

Updates an existing dynamic agent's system prompt (for self-improvement).

- [ ] **Step 4: Create `agent_delete` tool**

Removes a dynamic agent.

- [ ] **Step 5: Wire into main.go agent resolver**

The agent resolver in main.go currently only checks `allAgents` (builtin). Add fallback to `dynagentStore.Get(id)`.

- [ ] **Step 6: Commit**

---

### Task 3: Self-Evaluation Loop

The coordinator evaluates agent output and rewrites prompts when verification fails.

**Files:**
- Create: `operator/internal/dynagent/improve.go`
- Create: `operator/internal/dynagent/improve_test.go`

- [ ] **Step 1: Define improvement cycle**

```go
// ImprovementRecord tracks what happened when an agent was used.
type ImprovementRecord struct {
    AgentID        string
    TaskDescription string
    VerifierVerdict string   // PASS, FAIL, PARTIAL
    FailureReason   string   // from verifier output
    Attempt         int      // which attempt this was
    Timestamp       time.Time
}

// RecordAttempt stores the result and updates the agent's score.
func (s *Store) RecordAttempt(rec ImprovementRecord) error

// SuggestPromptFix returns guidance for improving the agent's system prompt
// based on failure patterns. This is injected into the coordinator's context
// so it can rewrite the agent prompt intelligently.
func (s *Store) SuggestPromptFix(agentID string) string
```

- [ ] **Step 2: Score tracking**

Each agent tracks: total attempts, passes, fails, current score (passes/total).
Low-score agents get flagged for improvement or deletion.

- [ ] **Step 3: Improvement prompt**

When verification fails, the coordinator gets:
```
Agent "db-specialist" (v2, score: 0.4) failed verification.
Verifier said: "Migration rollback not tested. No idempotency check."
Previous failures: "Missing foreign key constraint check" (v1)

Rewrite the agent's system prompt to address these failures.
Use agent_update to save the improved version.
```

- [ ] **Step 4: Write tests**

- [ ] **Step 5: Commit**

---

### Task 4: Coordinator Prompt — CTO Mode

Teach the coordinator to create, evaluate, and improve agents.

**Files:**
- Modify: `operator/internal/coreagents/configs/coordinator.md`

- [ ] **Step 1: Add dynamic agent section**

```markdown
## Dynamic Agents

You can create specialized agents on the fly for specific tasks:

1. **Create** with `agent_create` — give it a focused system prompt for the job
2. **Spawn** with `spawn_background` or `swarm_spawn` — run it on the task
3. **Verify** with the verifier agent — check if the work is correct
4. **Improve** if verification fails — use `agent_update` to rewrite the prompt

Good agent prompts are:
- Focused on one type of work (not generic)
- Include concrete rules for the domain
- Reference specific tools the agent should use
- Include verification criteria

When creating agents, think like a CTO hiring a specialist:
- What expertise does this task need?
- What mistakes should the specialist avoid?
- What tools should they use vs avoid?
- How should they verify their own work?

Agents you create persist across sessions. If an agent works well (high score),
reuse it. If it fails repeatedly, improve its prompt or delete it.
```

- [ ] **Step 2: Commit**

---

### Task 5: Morpheus State Machine

The autonomous mode core — state transitions and session flag.

**Files:**
- Create: `operator/internal/morpheus/state.go`

- [ ] **Step 1: Define states and transitions**

```go
package morpheus

type Mode string
const (
    ModeDisabled     Mode = "disabled"
    ModeActive       Mode = "active"
    ModeSleeping     Mode = "sleeping"
    ModeWaitingTask  Mode = "waiting_on_task"
    ModeWaitingUser  Mode = "waiting_on_user"
    ModePaused       Mode = "paused"
)

type WakeReason string
const (
    WakeUserMessage  WakeReason = "user_message"
    WakeScheduled    WakeReason = "scheduled"
    WakeTaskComplete WakeReason = "task_complete"
    WakeTaskFailed   WakeReason = "task_failed"
    WakeManual       WakeReason = "manual"
)

type SessionState struct {
    Mode           Mode
    WakeReason     WakeReason
    LastWakeAt     time.Time
    NextWakeAt     *time.Time
    WaitingTaskIDs []string
    PolicyLevel    PolicyLevel
}

type PolicyLevel string
const (
    PolicyObserve          PolicyLevel = "observe"
    PolicyLocalExecute     PolicyLevel = "local_execute"
    PolicyExecuteAndCommit PolicyLevel = "local_execute_and_commit"
)
```

- [ ] **Step 2: Commit**

---

### Task 6: Sleep Tool + Wake Events

**Files:**
- Create: `operator/internal/morpheus/sleep.go`
- Create: `operator/internal/morpheus/events.go`

- [ ] **Step 1: Sleep tool**

```go
// sleep — suspend autonomous work until a time or event
// Input: { "duration_seconds": 300, "reason": "waiting for tests" }
// Behavior: updates Morpheus state, returns immediately, wakes on timer/event
```

- [ ] **Step 2: Wake event queue**

```go
type WakeEvent struct {
    ID        string
    Reason    WakeReason
    Payload   map[string]any
    Timestamp time.Time
}

type EventQueue struct {
    mu     sync.Mutex
    events []WakeEvent
    notify chan struct{} // signal for the wake loop
}
```

- [ ] **Step 3: Wire task completion → wake events**

In `spawn_bg.go`, when a task completes/fails, enqueue a wake event.

- [ ] **Step 4: Commit**

---

### Task 7: Morpheus Wake Loop

The core autonomous loop.

**Files:**
- Create: `operator/internal/morpheus/loop.go`

- [ ] **Step 1: Event-driven loop**

```go
// Run blocks until context is cancelled. Waits for events, runs agent turns.
func (m *Morpheus) Run(ctx context.Context) error {
    for {
        select {
        case <-ctx.Done():
            return nil
        case <-m.events.Notify():
            event := m.events.Drain()
            m.state.Mode = ModeActive
            m.state.WakeReason = event.Reason
            // Inject wake attachment
            m.attachments.Enqueue(MorpheusWakeAttachment(event))
            // Run one agent turn via the runner
            m.runTurn(ctx, event)
        case <-m.sleepTimer.C:
            m.state.Mode = ModeActive
            m.state.WakeReason = WakeScheduled
            m.runTurn(ctx, scheduledWakeEvent())
        }
    }
}
```

- [ ] **Step 2: Commit**

---

### Task 8: Morpheus Prompt Section

**Files:**
- Create: `operator/internal/morpheus/prompt.go`
- Modify: `operator/internal/runner/system_prompt_sections.go`

- [ ] **Step 1: Morpheus prompt**

```go
func MorpheusPromptSection(state SessionState) string {
    if state.Mode == ModeDisabled {
        return ""
    }
    return fmt.Sprintf(`
# Morpheus Mode (Autonomous)
You are operating autonomously. Wake reason: %s

Prefer:
- spawn_background for non-trivial work
- wait_task instead of polling
- verifier before reporting completion
- agent_create for specialized workers
- sleep when no useful work remains

Keep text brief. Do not narrate routine actions.
Never claim completion without verification.
`, state.WakeReason)
}
```

- [ ] **Step 2: Inject into system prompt assembly**

- [ ] **Step 3: Commit**

---

### Task 9: Morpheus Space (Frontend)

**Files:**
- Create: `frontend/spaces/morpheus/manifest.json`
- Create: `frontend/spaces/morpheus/pages/MorpheusPage.vue`

- [ ] **Step 1: Create manifest**

Scope: app, icon: lucide:brain, navigation in sidebar.

- [ ] **Step 2: Build cockpit page**

Panels: Status, Active Tasks, Dynamic Agents, Schedule, Timeline.
Reads from operator via RPC: `morpheus.status`, `morpheus.list_agents`, `morpheus.timeline`.

- [ ] **Step 3: Commit**

---

### Task 10: Wire Everything in main.go

**Files:**
- Modify: `operator/main.go`

- [ ] **Step 1: Initialize dynagent store**

```go
dynStore := dynagent.NewStore(filepath.Join(appdir.Dir, "agents"))
dynStore.LoadAll()
```

- [ ] **Step 2: Update agent resolver to check dynamic agents**

```go
runner.WithAgentResolver(func(id string) *agent.Config {
    // Check dynamic agents first
    if cfg := dynStore.Get(id); cfg != nil {
        return cfg
    }
    return resolveAgentFromList(allAgents, fallbackAgent, id)
}),
```

- [ ] **Step 3: Register dynagent tools**

- [ ] **Step 4: Initialize Morpheus (disabled by default)**

- [ ] **Step 5: Commit**

---

## Self-Review

**Coverage:** Dynamic agent creation (Tasks 1-2), self-improvement loop (Task 3), coordinator CTO mode (Task 4), Morpheus state machine (Task 5), sleep/wake (Tasks 6-7), prompt injection (Task 8), frontend cockpit (Task 9), wiring (Task 10).

**Dependencies:** Tasks 1-4 are the self-improving agent system (standalone value). Tasks 5-8 are Morpheus autonomous mode (builds on 1-4). Task 9 is UI. Task 10 is wiring.

**Incremental delivery:** Tasks 1-4 ship dynamic agents without Morpheus. Tasks 5-8 add autonomous mode. Task 9 adds visibility. Each group is independently useful.
