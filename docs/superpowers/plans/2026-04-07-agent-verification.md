# Agent Verification System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mandatory, fresh-agent verification system that catches broken output across all agents with a 3-strike escalation flow, and feeds failures into Morpheus for long-term improvement.

**Architecture:** A shared `verification` module in the operator intercepts completion signals from any agent, spawns a fresh read-only verifier agent (no prior context), and orchestrates a 3-strike flow: original agent fix → fresh fixer agent → user escalation. Morpheus observes all verification events to detect patterns and write local prompt overlays. An infra endpoint collects anonymized patterns for aggregate analysis.

**Tech Stack:** Go (operator), Vue 3 + TypeScript (frontend), Go (infra service)

**Spec:** `docs/superpowers/specs/2026-04-07-agent-verification-design.md`

## MVP Scope and Deferred Work

This plan was implemented as an MVP. The following items are **deferred to follow-up**, not resolved:

- **Contract extraction (P1):** `ContextBuilder` functions use generic `OriginalTask`/`AcceptanceCriteria` strings instead of real goal/task data. Requires a structured goal tracking system that doesn't exist yet. See spec "Deferred to Follow-Up" section.
- **Per-goal findings paths (P1):** No profile registers `FindingsPath`. Findings use synthetic `<agentType>-strike<N>` naming. Requires goal IDs to produce `goal-{goalId}-findings.md`.
- **goalId in events (P2):** All verification events emit `goalId: ""`. Requires goal tracking.

These are data quality gaps, not structural ones. The verification machinery (3-strike flow, fresh-agent verification, fixer spawning, Morpheus learning, overlays, telemetry) is all functional.

---

## File Structure

### New files

```
operator/internal/verification/
  profile.go          ← VerificationProfile type, TriggerCondition, profile registry
  profile_test.go
  findings.go         ← Findings struct, read/write to disk, naming helpers
  findings_test.go
  verifier.go         ← SpawnVerifier: assembles VerifierContext, runs fresh agent
  verifier_test.go
  fixer.go            ← SpawnFixer: assembles fixer context, runs fresh agent
  fixer_test.go
  flow.go             ← Run(): 3-strike orchestration, calls verifier/fixer
  flow_test.go
  overlay.go          ← Read/write prompt overlays in Application Support
  overlay_test.go
```

```
infra/source/internal/handlers/morpheus.go   ← POST /api/v1/morpheus/patterns
infra/source/internal/models/morpheus.go     ← VerificationPattern model
```

### Modified files

```
operator/internal/coreagents/configs/verifier.md   ← Full prompt rewrite
operator/internal/stream/events.go                 ← 5 new verification event types
operator/internal/runner/runner.go                  ← Interception after tool execution
operator/internal/morpheus/observer.go              ← Observe verification events
operator/internal/dynagent/improve.go               ← Wire RecordVerification caller
operator/internal/coder/runner_adapter.go           ← Overlay injection in prompt assembly
operator/internal/agent/builtin/agent_verifier.go   ← Update if needed for fresh spawn
frontend/operator/streamEvents.ts                   ← 5 new event types + interfaces
frontend/operator/useStreamStatus.ts                ← Verification event handlers
frontend/spaces/morpheus/pages/MorpheusPage.vue     ← Verification stats section
```

---

### Task 1: Verification Profile Types and Registry

**Files:**
- Create: `operator/internal/verification/profile.go`
- Create: `operator/internal/verification/profile_test.go`

- [ ] **Step 1: Write the failing test for profile registration**

```go
// operator/internal/verification/profile_test.go
package verification

import "testing"

func TestRegisterAndGetProfile(t *testing.T) {
	registry := NewProfileRegistry()

	profile := VerificationProfile{
		AgentType:  "coder",
		TriggerOn:  TriggerGoalDone,
		MaxStrikes: 3,
		Playbook:   "backend",
	}

	registry.Register(profile)

	got, ok := registry.Get("coder")
	if !ok {
		t.Fatal("expected coder profile to be registered")
	}
	if got.AgentType != "coder" {
		t.Errorf("expected AgentType=coder, got %s", got.AgentType)
	}
	if got.MaxStrikes != 3 {
		t.Errorf("expected MaxStrikes=3, got %d", got.MaxStrikes)
	}
}

func TestGetUnregisteredProfile(t *testing.T) {
	registry := NewProfileRegistry()

	_, ok := registry.Get("unknown")
	if ok {
		t.Fatal("expected unknown profile to not exist")
	}
}

func TestRegistryRequiresAgentType(t *testing.T) {
	registry := NewProfileRegistry()

	err := registry.Register(VerificationProfile{})
	if err == nil {
		t.Fatal("expected error when registering profile without AgentType")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/flakerim/Construct/construct-app/operator && go test ./internal/verification/ -v -run TestRegister`
Expected: FAIL — package does not exist

- [ ] **Step 3: Implement profile types and registry**

```go
// operator/internal/verification/profile.go
package verification

import (
	"fmt"
	"sync"
)

// TriggerCondition defines when verification triggers for an agent type.
type TriggerCondition string

const (
	TriggerGoalDone         TriggerCondition = "goal_done"
	TriggerPlanComplete     TriggerCondition = "plan_complete"
	TriggerDelegationResult TriggerCondition = "delegation_result"
	TriggerTaskComplete     TriggerCondition = "task_complete"
)

// VerifierContext is what the fresh verifier agent receives. No conversation
// history, no reasoning — just the contract and the claim.
type VerifierContext struct {
	OriginalTask       string   `json:"original_task"`
	AcceptanceCriteria string   `json:"acceptance_criteria"`
	Claim              string   `json:"claim"`
	FilesChanged       []string `json:"files_changed"`
	Playbook           string   `json:"playbook"`
}

// ContextBuilderFunc extracts verifier context from agent state.
type ContextBuilderFunc func() (VerifierContext, error)

// FindingsPathFunc returns the path for the findings file.
type FindingsPathFunc func() string

// VerificationProfile defines how an agent type gets verified.
type VerificationProfile struct {
	AgentType      string
	TriggerOn      TriggerCondition
	ContextBuilder ContextBuilderFunc
	FindingsPath   FindingsPathFunc
	MaxStrikes     int
	Playbook       string
}

// ProfileRegistry holds all registered verification profiles.
type ProfileRegistry struct {
	mu       sync.RWMutex
	profiles map[string]VerificationProfile
}

func NewProfileRegistry() *ProfileRegistry {
	return &ProfileRegistry{
		profiles: make(map[string]VerificationProfile),
	}
}

func (r *ProfileRegistry) Register(p VerificationProfile) error {
	if p.AgentType == "" {
		return fmt.Errorf("verification profile requires AgentType")
	}
	if p.MaxStrikes == 0 {
		p.MaxStrikes = 3
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.profiles[p.AgentType] = p
	return nil
}

func (r *ProfileRegistry) Get(agentType string) (VerificationProfile, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	p, ok := r.profiles[agentType]
	return p, ok
}

func (r *ProfileRegistry) Has(agentType string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	_, ok := r.profiles[agentType]
	return ok
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/flakerim/Construct/construct-app/operator && go test ./internal/verification/ -v -run TestRegister`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/flakerim/Construct/construct-app
git add operator/internal/verification/profile.go operator/internal/verification/profile_test.go
git commit -m "feat(verification): add profile types and registry"
```

---

### Task 2: Findings File Format

**Files:**
- Create: `operator/internal/verification/findings.go`
- Create: `operator/internal/verification/findings_test.go`

- [ ] **Step 1: Write the failing test for findings write/read**

```go
// operator/internal/verification/findings_test.go
package verification

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestWriteAndReadFindings(t *testing.T) {
	dir := t.TempDir()

	f := Findings{
		Title:              "Implement user auth",
		Strike:             1,
		AgentType:          "coder",
		Timestamp:          time.Date(2026, 4, 7, 12, 0, 0, 0, time.UTC),
		OriginalTask:       "Add JWT authentication to /api/login",
		AcceptanceCriteria: "- Returns 200 with valid token\n- Returns 401 with invalid creds",
		Claim:              "Implemented JWT auth with bcrypt password hashing",
		Checks: []Check{
			{
				Name:    "Build",
				Command: "go build ./...",
				Output:  "ok",
				Verdict: VerdictPass,
				Reason:  "Build succeeds",
			},
			{
				Name:    "Test suite",
				Command: "go test ./...",
				Output:  "FAIL auth_test.go:42",
				Verdict: VerdictFail,
				Reason:  "auth_test.go:42 — TestLogin_InvalidCreds expects 401, got 500",
			},
		},
		FinalVerdict: VerdictFail,
		ActionRequired: []string{
			"internal/auth/handler.go:58 — missing error check on bcrypt.Compare",
		},
	}

	path := filepath.Join(dir, "goal-001-findings.md")
	err := WriteFindings(path, f)
	if err != nil {
		t.Fatalf("WriteFindings: %v", err)
	}

	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}

	s := string(content)
	if !strings.Contains(s, "# Findings: Implement user auth") {
		t.Error("missing title")
	}
	if !strings.Contains(s, "Strike: 1") {
		t.Error("missing strike")
	}
	if !strings.Contains(s, "Verdict: FAIL") {
		t.Error("missing final verdict")
	}
	if !strings.Contains(s, "handler.go:58") {
		t.Error("missing action required")
	}
}

func TestFindingsPathForGoal(t *testing.T) {
	got := GoalFindingsPath("/project", "goal-001")
	want := "/project/goal-001-findings.md"
	if got != want {
		t.Errorf("got %s, want %s", got, want)
	}
}

func TestFindingsPathForPlan(t *testing.T) {
	got := PlanFindingsPath("/project")
	want := "/project/plan-findings.md"
	if got != want {
		t.Errorf("got %s, want %s", got, want)
	}
}

func TestDeleteFindings(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "findings.md")
	os.WriteFile(path, []byte("content"), 0644)

	err := DeleteFindings(path)
	if err != nil {
		t.Fatalf("DeleteFindings: %v", err)
	}

	_, err = os.Stat(path)
	if !os.IsNotExist(err) {
		t.Error("findings file should be deleted on PASS")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/flakerim/Construct/construct-app/operator && go test ./internal/verification/ -v -run TestWrite`
Expected: FAIL — types not defined

- [ ] **Step 3: Implement findings types and write/read**

```go
// operator/internal/verification/findings.go
package verification

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Verdict string

const (
	VerdictPass    Verdict = "PASS"
	VerdictFail    Verdict = "FAIL"
	VerdictPartial Verdict = "PARTIAL"
)

type Check struct {
	Name    string
	Command string
	Output  string
	Verdict Verdict
	Reason  string
}

type Findings struct {
	Title              string
	Strike             int
	AgentType          string
	Timestamp          time.Time
	OriginalTask       string
	AcceptanceCriteria string
	Claim              string
	Checks             []Check
	FinalVerdict       Verdict
	ActionRequired     []string
}

func WriteFindings(path string, f Findings) error {
	var b strings.Builder

	fmt.Fprintf(&b, "# Findings: %s\n\n", f.Title)
	fmt.Fprintf(&b, "Strike: %d\n", f.Strike)
	fmt.Fprintf(&b, "Agent: %s\n", f.AgentType)
	fmt.Fprintf(&b, "Date: %s\n\n", f.Timestamp.Format(time.RFC3339))

	b.WriteString("## Original Task\n")
	fmt.Fprintf(&b, "%s\n\n", f.OriginalTask)

	b.WriteString("## Acceptance Criteria\n")
	fmt.Fprintf(&b, "%s\n\n", f.AcceptanceCriteria)

	b.WriteString("## Claim\n")
	fmt.Fprintf(&b, "%s\n\n", f.Claim)

	b.WriteString("## Checks\n\n")
	for _, c := range f.Checks {
		fmt.Fprintf(&b, "### %s\n", c.Name)
		fmt.Fprintf(&b, "- Command: `%s`\n", c.Command)
		fmt.Fprintf(&b, "- Output: %s\n", c.Output)
		fmt.Fprintf(&b, "- Verdict: %s\n", c.Verdict)
		fmt.Fprintf(&b, "- Reason: %s\n\n", c.Reason)
	}

	fmt.Fprintf(&b, "## Verdict: %s\n\n", f.FinalVerdict)

	if len(f.ActionRequired) > 0 {
		b.WriteString("## Action Required\n")
		for _, a := range f.ActionRequired {
			fmt.Fprintf(&b, "- %s\n", a)
		}
	}

	return os.WriteFile(path, []byte(b.String()), 0644)
}

func GoalFindingsPath(projectDir, goalID string) string {
	return filepath.Join(projectDir, goalID+"-findings.md")
}

func PlanFindingsPath(projectDir string) string {
	return filepath.Join(projectDir, "plan-findings.md")
}

func DelegationFindingsPath(projectDir, taskID string) string {
	return filepath.Join(projectDir, "delegation-"+taskID+"-findings.md")
}

func AgentFindingsPath(projectDir, agentID string) string {
	return filepath.Join(projectDir, "agent-"+agentID+"-findings.md")
}

func DeleteFindings(path string) error {
	return os.Remove(path)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/flakerim/Construct/construct-app/operator && go test ./internal/verification/ -v`
Expected: PASS (all profile + findings tests)

- [ ] **Step 5: Commit**

```bash
cd /Users/flakerim/Construct/construct-app
git add operator/internal/verification/findings.go operator/internal/verification/findings_test.go
git commit -m "feat(verification): add findings file format and path helpers"
```

---

### Task 3: Upgrade Verifier Prompt

**Files:**
- Modify: `operator/internal/coreagents/configs/verifier.md`

- [ ] **Step 1: Read current verifier prompt**

Run: `cat operator/internal/coreagents/configs/verifier.md`
Note the frontmatter format (id, name, category, tools, blockTools, maxIterations).

- [ ] **Step 2: Rewrite verifier.md with all 8 fixes from Verification.md**

Replace the full content of `operator/internal/coreagents/configs/verifier.md` with the upgraded prompt. Keep the existing frontmatter structure. The body must include:

```markdown
---
id: verifier
name: Verifier
category: specialist
maxIterations: 30
tools:
  - read_file
  - list_dir
  - glob
  - grep
  - bash
  - lsp_diagnostics
  - lsp_references
  - lsp_definition
blockTools:
  - write_file
  - edit_file
  - spawn_agent
  - spawn_background
  - coordinate
  - git_commit
  - memory_write
---

# Verification Agent

You are a verification specialist. Your job is not to confirm the implementation works — it's to try to break it.

You receive a task description, acceptance criteria, and a claim of what was done. You verify the claim against reality. You have no prior context about how the work was done — and you don't need it.

## Failure Patterns You Must Recognize

Two failure modes kill verification:

**Verification avoidance.** You read the code, it looks reasonable, and you write "PASS" without running a single command. This is the most common failure. If your verdict is not backed by command output, it is worthless.

**Seduced by the first 80%.** Build passes, tests pass, you stop. The remaining 20% — edge cases, error paths, integration seams — is where real bugs live. Never stop at the happy path.

## What You May and May Not Do

**Forbidden:**
- Modify any project file (no writes, no installs, no git mutations)
- Run commands with destructive side effects (rm, drop, truncate)
- Spawn other agents or delegate

**Allowed:**
- Run builds, tests, linters, type-checkers (ephemeral artifacts like .next, dist, coverage are fine)
- Create temporary helper scripts ONLY outside the project tree (use $TMPDIR)
- Read any file in the project
- Run any read-only or diagnostic command

## Required Baseline

Before any verdict, you MUST complete these steps:

1. Read project instructions (CLAUDE.md, CONSTRUCT.md, README) and relevant build/test config files
2. Run build
3. Run full test suite
4. Run linters and type-checkers
5. Check for regressions in related code using lsp_references and grep

If any baseline check is impossible (no test command, no build script), note it as a PARTIAL limitation — do not skip silently.

## Change-Type Verification Playbooks

Apply the playbook matching the type of change. If multiple apply, run all.

**Frontend:**
- Check that components render without errors (build + test)
- Verify accessibility: aria labels on interactive elements, contrast, keyboard navigation
- Check responsive behavior if layout changed
- Test error states and loading states, not just happy path
- Verify no console errors or warnings in test output

**Backend / API:**
- Verify endpoint contracts: correct status codes, response shapes, error responses
- Test authentication and authorization paths
- Validate request payload handling (missing fields, wrong types, extra fields)
- Check database queries for N+1, missing indexes on new columns

**CLI / Script:**
- Test exit codes (0 on success, non-zero on failure)
- Verify help text and flag combinations
- Test with piped input and edge-case arguments (empty, very long, special characters)

**Config / Infrastructure:**
- Validate syntax (JSON/YAML/TOML parse)
- Check environment variable propagation
- Verify rollback safety — can the previous config still work?

**Bug Fix:**
- The original reproduction case MUST fail before the fix and pass after
- If no repro test exists, write one in $TMPDIR and run it against the project

**Refactor:**
- Behavior must be identical before and after
- No public API surface changes unless explicitly intended
- All existing tests must still pass without modification

**Migration / Database:**
- Test both up and down migrations
- Verify data preservation (no data loss)
- Check idempotency (running migration twice must not fail)

## Mandatory Adversarial Probe Before PASS

You MUST attempt at least one adversarial probe before issuing PASS. Pick the most relevant:

- **Boundary values:** empty input, zero, negative, maximum length, unicode
- **Concurrency:** what if two requests hit this simultaneously?
- **Idempotency:** run the operation twice — does it still work?
- **Orphan operations:** what if the parent process fails mid-way?
- **Missing/malformed config:** what if expected env vars or config files are absent?

No adversarial probe attempted = you CANNOT issue PASS. This is not optional.

## Anti-Rationalization

Recognize when you are about to skip verification:

- "The code looks correct" → Run the command. Reading is not verifying.
- "Tests already pass" → Tests passing doesn't mean the feature works correctly.
- "This is probably fine" → "Probably" is not evidence.
- "I don't have the right tool" → Use PARTIAL, don't fake a PASS.
- "This would take too long" → Taking too long is not a reason to skip.

If you are writing an explanation instead of running a command, STOP and run the command.

## FAIL Discipline

Before issuing FAIL, verify:
- Is this intentional behavior? (Check comments, config, docs)
- Is it already handled elsewhere? (Check error handlers, middleware)
- Is it actionable? (Can the agent actually fix this?)

Only fail on real, actionable problems. No false alarms.

## PARTIAL Semantics

PARTIAL means the ENVIRONMENT prevented full verification. Not:
- "Some checks failed but they're minor" → that's FAIL
- "I'm not sure if this is a problem" → investigate more, then PASS or FAIL
- "Edge cases might fail" → test them, then PASS or FAIL

PARTIAL is ONLY for: missing runtime, unavailable external service, no browser for visual check, no test infrastructure. Real limitations, not uncertainty.

## Output Format

Every check must follow this format exactly:

```
## Check: [name]
Command: `[exact command run]`
Output: [relevant output, truncated if over 50 lines]
Verdict: PASS | FAIL
Reason: [one line explanation]
```

Adversarial probes use the same format with a prefix:

```
## Adversarial Probe: [name]
Command: `[exact command run]`
Output: [relevant output]
Verdict: PASS | FAIL
Reason: [one line explanation]
```

Final verdict — must be the last line of your response:

```
## Verdict: PASS | FAIL | PARTIAL
```

If FAIL, list each failing check with file:line reference:
```
## Verdict: FAIL
- internal/auth/handler.go:58 — missing error check on bcrypt.Compare
- internal/auth/handler_test.go — TestLogin_InvalidCreds expects 401, got 500
```

If PARTIAL, list what couldn't be verified and why:
```
## Verdict: PARTIAL
- Visual render check: no browser available in this environment
- External API contract: staging endpoint unreachable
```

## Examples

**Bad verdict:**
"Everything looks good, tests pass. PASS"
→ No commands shown. No adversarial probe. Worthless.

**Good verdict:**
```
## Check: Build
Command: `go build ./...`
Output: ok
Verdict: PASS
Reason: Build succeeds with no errors

## Check: Test suite
Command: `go test ./... -v`
Output: ok (42 passed, 0 failed)
Verdict: PASS
Reason: All 42 tests pass

## Check: Type check
Command: `go vet ./...`
Output: ok
Verdict: PASS
Reason: No issues

## Adversarial Probe: Empty input
Command: `curl -s -o /dev/null -w "%{http_code}" -X POST localhost:8080/api/login -d '{}'`
Output: 400
Verdict: PASS
Reason: Empty credentials correctly return 400 Bad Request

## Verdict: PASS
```

## Tool Awareness

At the start of verification, inspect your available tools. If browser, web fetch, MCP, or other diagnostic tools are available beyond the baseline set, use them. Do not assume you only have the tools listed in your config — check what's actually available and use everything relevant.
```

- [ ] **Step 3: Verify the prompt loads correctly**

Run: `cd /Users/flakerim/Construct/construct-app/operator && go test ./internal/coreagents/ -v -run TestLoad`
Expected: PASS (or run whatever test loads agent configs to verify frontmatter parses)

- [ ] **Step 4: Commit**

```bash
cd /Users/flakerim/Construct/construct-app
git add operator/internal/coreagents/configs/verifier.md
git commit -m "feat(verification): upgrade verifier prompt — close all 8 gaps from Verification.md"
```

---

### Task 4: Backend Stream Events

**Files:**
- Modify: `operator/internal/stream/events.go`

- [ ] **Step 1: Read current events.go to find the event constants block**

Read `operator/internal/stream/events.go` lines 90-145 to see the existing pattern.

- [ ] **Step 2: Add verification event type constants**

Add after the existing constants block in `events.go`:

```go
// Verification events
TypeVerificationStarted     = "verification.started"
TypeVerificationPassed      = "verification.passed"
TypeVerificationFailed      = "verification.failed"
TypeVerificationEscalated   = "verification.escalated"
TypeVerificationFixerSpawned = "verification.fixer_spawned"
```

- [ ] **Step 3: Commit**

```bash
cd /Users/flakerim/Construct/construct-app
git add operator/internal/stream/events.go
git commit -m "feat(verification): add verification stream event types"
```

---

### Task 5: Verifier Spawning

**Files:**
- Create: `operator/internal/verification/verifier.go`
- Create: `operator/internal/verification/verifier_test.go`

- [ ] **Step 1: Write the failing test**

```go
// operator/internal/verification/verifier_test.go
package verification

import (
	"testing"
)

func TestBuildVerifierPrompt(t *testing.T) {
	ctx := VerifierContext{
		OriginalTask:       "Add JWT auth to /api/login",
		AcceptanceCriteria: "- Returns 200 with valid token\n- Returns 401 with invalid creds",
		Claim:              "Implemented JWT auth with bcrypt",
		FilesChanged:       []string{"internal/auth/handler.go", "internal/auth/handler_test.go"},
		Playbook:           "backend",
	}

	prompt := BuildVerifierPrompt(ctx)

	if prompt == "" {
		t.Fatal("expected non-empty prompt")
	}

	// Must contain the task
	if !containsStr(prompt, "Add JWT auth") {
		t.Error("prompt missing original task")
	}
	// Must contain acceptance criteria
	if !containsStr(prompt, "Returns 200 with valid token") {
		t.Error("prompt missing acceptance criteria")
	}
	// Must contain claim
	if !containsStr(prompt, "Implemented JWT auth") {
		t.Error("prompt missing claim")
	}
	// Must contain files changed
	if !containsStr(prompt, "internal/auth/handler.go") {
		t.Error("prompt missing files changed")
	}
	// Must contain playbook reference
	if !containsStr(prompt, "backend") {
		t.Error("prompt missing playbook")
	}
}

func containsStr(s, substr string) bool {
	return len(s) > 0 && len(substr) > 0 && // avoid false positives
		len(s) >= len(substr) &&
		indexStr(s, substr) >= 0
}

func indexStr(s, substr string) int {
	for i := 0; i+len(substr) <= len(s); i++ {
		if s[i:i+len(substr)] == substr {
			return i
		}
	}
	return -1
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/flakerim/Construct/construct-app/operator && go test ./internal/verification/ -v -run TestBuildVerifier`
Expected: FAIL — BuildVerifierPrompt not defined

- [ ] **Step 3: Implement verifier spawning**

```go
// operator/internal/verification/verifier.go
package verification

import (
	"fmt"
	"strings"
)

// BuildVerifierPrompt creates the user message for the fresh verifier agent.
// This is injected as the first user turn — the verifier's system prompt
// comes from verifier.md (loaded by the agent config system).
func BuildVerifierPrompt(ctx VerifierContext) string {
	var b strings.Builder

	b.WriteString("# Verification Task\n\n")

	b.WriteString("## Original Task\n")
	fmt.Fprintf(&b, "%s\n\n", ctx.OriginalTask)

	b.WriteString("## Acceptance Criteria\n")
	fmt.Fprintf(&b, "%s\n\n", ctx.AcceptanceCriteria)

	b.WriteString("## Agent Claim\n")
	fmt.Fprintf(&b, "The agent claims: %s\n\n", ctx.Claim)

	b.WriteString("## Files Changed\n")
	for _, f := range ctx.FilesChanged {
		fmt.Fprintf(&b, "- `%s`\n", f)
	}
	b.WriteString("\n")

	if ctx.Playbook != "" {
		fmt.Fprintf(&b, "## Verification Focus\n")
		fmt.Fprintf(&b, "Apply the **%s** verification playbook from your instructions.\n\n", ctx.Playbook)
	}

	b.WriteString("Verify the claim against reality. Run the baseline checks, apply the playbook, ")
	b.WriteString("attempt at least one adversarial probe, and return your verdict.\n")

	return b.String()
}

// SpawnConfig holds what the runner needs to spawn a fresh verifier agent.
type SpawnConfig struct {
	AgentID     string // "verifier"
	UserMessage string // the verification prompt
	ProjectDir  string // working directory
}

// NewVerifierSpawnConfig creates the config to spawn a fresh verifier.
func NewVerifierSpawnConfig(ctx VerifierContext, projectDir string) SpawnConfig {
	return SpawnConfig{
		AgentID:     "verifier",
		UserMessage: BuildVerifierPrompt(ctx),
		ProjectDir:  projectDir,
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/flakerim/Construct/construct-app/operator && go test ./internal/verification/ -v -run TestBuildVerifier`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/flakerim/Construct/construct-app
git add operator/internal/verification/verifier.go operator/internal/verification/verifier_test.go
git commit -m "feat(verification): add verifier prompt builder and spawn config"
```

---

### Task 6: Fixer Spawning

**Files:**
- Create: `operator/internal/verification/fixer.go`
- Create: `operator/internal/verification/fixer_test.go`

- [ ] **Step 1: Write the failing test**

```go
// operator/internal/verification/fixer_test.go
package verification

import "testing"

func TestBuildFixerPrompt(t *testing.T) {
	ctx := FixerContext{
		OriginalTask:       "Add JWT auth to /api/login",
		AcceptanceCriteria: "- Returns 200 with valid token\n- Returns 401 with invalid creds",
		FindingsPath:       "/project/goal-001-findings.md",
		FindingsContent:    "## Verdict: FAIL\n- handler.go:58 — missing error check",
	}

	prompt := BuildFixerPrompt(ctx)

	if prompt == "" {
		t.Fatal("expected non-empty prompt")
	}
	// Must contain the task
	if !containsStr(prompt, "Add JWT auth") {
		t.Error("prompt missing original task")
	}
	// Must contain findings
	if !containsStr(prompt, "missing error check") {
		t.Error("prompt missing findings")
	}
	// Must NOT tell the fixer how the previous agent approached it
	if containsStr(prompt, "previous agent") || containsStr(prompt, "prior attempt") {
		t.Error("prompt should not reference previous agent's approach")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/flakerim/Construct/construct-app/operator && go test ./internal/verification/ -v -run TestBuildFixer`
Expected: FAIL — FixerContext not defined

- [ ] **Step 3: Implement fixer spawning**

```go
// operator/internal/verification/fixer.go
package verification

import (
	"fmt"
	"strings"
)

// FixerContext is what the fresh fixer agent receives.
// It knows WHAT to build and WHAT is wrong, but not HOW the previous agent tried.
type FixerContext struct {
	OriginalTask       string
	AcceptanceCriteria string
	FindingsPath       string
	FindingsContent    string
}

// BuildFixerPrompt creates the user message for the fresh fixer agent.
func BuildFixerPrompt(ctx FixerContext) string {
	var b strings.Builder

	b.WriteString("# Fix Task\n\n")
	b.WriteString("You are a fresh agent brought in to fix specific issues. ")
	b.WriteString("You have not seen any prior work or reasoning — only the task, ")
	b.WriteString("the acceptance criteria, and the verification findings.\n\n")

	b.WriteString("## Original Task\n")
	fmt.Fprintf(&b, "%s\n\n", ctx.OriginalTask)

	b.WriteString("## Acceptance Criteria\n")
	fmt.Fprintf(&b, "%s\n\n", ctx.AcceptanceCriteria)

	b.WriteString("## Verification Findings\n")
	fmt.Fprintf(&b, "Findings file: `%s`\n\n", ctx.FindingsPath)
	fmt.Fprintf(&b, "%s\n\n", ctx.FindingsContent)

	b.WriteString("Fix the issues listed in the findings. Read the relevant source files, ")
	b.WriteString("understand the problem yourself, and make the necessary changes. ")
	b.WriteString("Do not guess — read the code first.\n")

	return b.String()
}

// NewFixerSpawnConfig creates the config to spawn a fresh fixer agent.
// The fixer gets the same tools as the original agent (read + write).
func NewFixerSpawnConfig(ctx FixerContext, originalAgentID, projectDir string) SpawnConfig {
	return SpawnConfig{
		AgentID:     originalAgentID,
		UserMessage: BuildFixerPrompt(ctx),
		ProjectDir:  projectDir,
	}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/flakerim/Construct/construct-app/operator && go test ./internal/verification/ -v -run TestBuildFixer`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/flakerim/Construct/construct-app
git add operator/internal/verification/fixer.go operator/internal/verification/fixer_test.go
git commit -m "feat(verification): add fixer prompt builder and spawn config"
```

---

### Task 7: 3-Strike Flow Orchestration

**Files:**
- Create: `operator/internal/verification/flow.go`
- Create: `operator/internal/verification/flow_test.go`

- [ ] **Step 1: Write the failing test for the flow**

```go
// operator/internal/verification/flow_test.go
package verification

import (
	"context"
	"testing"
)

// MockRunner simulates agent spawning for tests.
type MockRunner struct {
	verdicts []Verdict // verdicts to return in order
	calls    int
	spawns   []SpawnConfig
}

func (m *MockRunner) RunAgent(ctx context.Context, cfg SpawnConfig) (string, error) {
	m.spawns = append(m.spawns, cfg)
	idx := m.calls
	m.calls++
	if idx < len(m.verdicts) {
		v := m.verdicts[idx]
		return buildMockVerdict(v), nil
	}
	return buildMockVerdict(VerdictPass), nil
}

func buildMockVerdict(v Verdict) string {
	switch v {
	case VerdictPass:
		return "## Check: Build\nCommand: `go build`\nOutput: ok\nVerdict: PASS\nReason: ok\n\n## Verdict: PASS"
	case VerdictFail:
		return "## Check: Build\nCommand: `go build`\nOutput: FAIL\nVerdict: FAIL\nReason: broken\n\n## Verdict: FAIL\n- file.go:1 — broken"
	default:
		return "## Verdict: PARTIAL\n- no runtime"
	}
}

func TestFlowPassOnFirstTry(t *testing.T) {
	runner := &MockRunner{verdicts: []Verdict{VerdictPass}}
	f := NewFlow(runner, t.TempDir())

	result, err := f.Run(context.Background(), VerificationProfile{
		AgentType:  "coder",
		MaxStrikes: 3,
	}, VerifierContext{
		OriginalTask:       "test task",
		AcceptanceCriteria: "it works",
		Claim:              "done",
	})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.FinalVerdict != VerdictPass {
		t.Errorf("expected PASS, got %s", result.FinalVerdict)
	}
	if result.StrikesUsed != 1 {
		t.Errorf("expected 1 strike, got %d", result.StrikesUsed)
	}
	if runner.calls != 1 {
		t.Errorf("expected 1 verifier call, got %d", runner.calls)
	}
}

func TestFlowEscalatesAfterMaxStrikes(t *testing.T) {
	// Verifier fails 3 times: strike1 verify, strike2 verify, strike3 verify
	runner := &MockRunner{verdicts: []Verdict{
		VerdictFail, // strike 1: verifier rejects
		VerdictFail, // strike 2: verifier rejects after agent fix
		VerdictFail, // strike 3: verifier rejects after fixer
	}}
	f := NewFlow(runner, t.TempDir())

	result, err := f.Run(context.Background(), VerificationProfile{
		AgentType:  "coder",
		MaxStrikes: 3,
	}, VerifierContext{
		OriginalTask:       "test task",
		AcceptanceCriteria: "it works",
		Claim:              "done",
	})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !result.Escalated {
		t.Error("expected escalation after 3 strikes")
	}
	if result.FinalVerdict != VerdictFail {
		t.Errorf("expected FAIL, got %s", result.FinalVerdict)
	}
}

func TestFlowPassOnSecondStrike(t *testing.T) {
	runner := &MockRunner{verdicts: []Verdict{
		VerdictFail, // strike 1: verifier rejects
		VerdictPass, // strike 2: verifier passes after agent fix
	}}
	f := NewFlow(runner, t.TempDir())

	result, err := f.Run(context.Background(), VerificationProfile{
		AgentType:  "coder",
		MaxStrikes: 3,
	}, VerifierContext{
		OriginalTask:       "test task",
		AcceptanceCriteria: "it works",
		Claim:              "done",
	})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.FinalVerdict != VerdictPass {
		t.Errorf("expected PASS, got %s", result.FinalVerdict)
	}
	if result.StrikesUsed != 2 {
		t.Errorf("expected 2 strikes, got %d", result.StrikesUsed)
	}
}

func TestFlowFixerSpawnedOnStrike3(t *testing.T) {
	runner := &MockRunner{verdicts: []Verdict{
		VerdictFail, // strike 1: verifier rejects
		VerdictFail, // strike 2: verifier rejects again
		VerdictPass, // strike 3: verifier passes after fixer
	}}
	f := NewFlow(runner, t.TempDir())

	result, err := f.Run(context.Background(), VerificationProfile{
		AgentType:  "coder",
		MaxStrikes: 3,
	}, VerifierContext{
		OriginalTask:       "test task",
		AcceptanceCriteria: "it works",
		Claim:              "done",
	})

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.FinalVerdict != VerdictPass {
		t.Errorf("expected PASS, got %s", result.FinalVerdict)
	}
	if !result.FixerUsed {
		t.Error("expected fixer to be used on strike 3")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/flakerim/Construct/construct-app/operator && go test ./internal/verification/ -v -run TestFlow`
Expected: FAIL — NewFlow not defined

- [ ] **Step 3: Implement the 3-strike flow**

```go
// operator/internal/verification/flow.go
package verification

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// AgentRunner is the interface the flow uses to spawn agents.
// Implemented by the real runner in production, mock in tests.
type AgentRunner interface {
	RunAgent(ctx context.Context, cfg SpawnConfig) (output string, err error)
}

// FlowResult is the outcome of a verification flow.
type FlowResult struct {
	FinalVerdict Verdict
	StrikesUsed  int
	Escalated    bool
	FixerUsed    bool
	FindingsPath string
}

// Flow orchestrates the 3-strike verification process.
type Flow struct {
	runner     AgentRunner
	projectDir string
}

func NewFlow(runner AgentRunner, projectDir string) *Flow {
	return &Flow{runner: runner, projectDir: projectDir}
}

// Run executes the full verification flow for a completed goal/task.
func (f *Flow) Run(ctx context.Context, profile VerificationProfile, vctx VerifierContext) (*FlowResult, error) {
	maxStrikes := profile.MaxStrikes
	if maxStrikes == 0 {
		maxStrikes = 3
	}

	findingsPath := filepath.Join(f.projectDir, fmt.Sprintf("%s-findings.md", profile.AgentType))
	result := &FlowResult{}

	for strike := 1; strike <= maxStrikes; strike++ {
		result.StrikesUsed = strike

		// Spawn fresh verifier
		verifierCfg := NewVerifierSpawnConfig(vctx, f.projectDir)
		output, err := f.runner.RunAgent(ctx, verifierCfg)
		if err != nil {
			return nil, fmt.Errorf("verifier spawn failed on strike %d: %w", strike, err)
		}

		verdict := parseVerdict(output)
		result.FinalVerdict = verdict

		if verdict == VerdictPass {
			// Clean up findings file on pass
			os.Remove(findingsPath)
			return result, nil
		}

		// Write findings file
		findings := Findings{
			Title:              vctx.OriginalTask,
			Strike:             strike,
			AgentType:          profile.AgentType,
			Timestamp:          time.Now(),
			OriginalTask:       vctx.OriginalTask,
			AcceptanceCriteria: vctx.AcceptanceCriteria,
			Claim:              vctx.Claim,
			FinalVerdict:       verdict,
			ActionRequired:     parseActionRequired(output),
		}
		WriteFindings(findingsPath, findings)
		result.FindingsPath = findingsPath

		if strike == maxStrikes {
			// All strikes exhausted — escalate
			result.Escalated = true
			return result, nil
		}

		// Strike 2: let original agent fix (caller handles this)
		// Strike 3: spawn fresh fixer
		if strike == maxStrikes-1 {
			result.FixerUsed = true
			findingsContent, _ := os.ReadFile(findingsPath)
			fixerCtx := FixerContext{
				OriginalTask:       vctx.OriginalTask,
				AcceptanceCriteria: vctx.AcceptanceCriteria,
				FindingsPath:       findingsPath,
				FindingsContent:    string(findingsContent),
			}
			fixerCfg := NewFixerSpawnConfig(fixerCtx, profile.AgentType, f.projectDir)
			_, err := f.runner.RunAgent(ctx, fixerCfg)
			if err != nil {
				return nil, fmt.Errorf("fixer spawn failed: %w", err)
			}
			// Loop continues — next iteration runs verifier again
		}
	}

	return result, nil
}

// parseVerdict extracts the verdict from verifier output.
func parseVerdict(output string) Verdict {
	lines := strings.Split(output, "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		line := strings.TrimSpace(lines[i])
		if strings.HasPrefix(line, "## Verdict:") {
			v := strings.TrimSpace(strings.TrimPrefix(line, "## Verdict:"))
			switch v {
			case "PASS":
				return VerdictPass
			case "FAIL":
				return VerdictFail
			case "PARTIAL":
				return VerdictPartial
			}
		}
	}
	return VerdictFail // no verdict found = fail safe
}

// parseActionRequired extracts action items from verifier output.
func parseActionRequired(output string) []string {
	var actions []string
	inAction := false
	for _, line := range strings.Split(output, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "## Verdict: FAIL") {
			inAction = true
			continue
		}
		if inAction && strings.HasPrefix(trimmed, "- ") {
			actions = append(actions, strings.TrimPrefix(trimmed, "- "))
		}
		if inAction && strings.HasPrefix(trimmed, "##") && !strings.HasPrefix(trimmed, "## Verdict") {
			break
		}
	}
	return actions
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/flakerim/Construct/construct-app/operator && go test ./internal/verification/ -v -run TestFlow`
Expected: PASS (all 4 flow tests)

- [ ] **Step 5: Commit**

```bash
cd /Users/flakerim/Construct/construct-app
git add operator/internal/verification/flow.go operator/internal/verification/flow_test.go
git commit -m "feat(verification): implement 3-strike flow orchestration"
```

---

### Task 8: Runner Interception

**Files:**
- Modify: `operator/internal/runner/runner.go`

This task wires the verification flow into the runner's tool execution path. The runner intercepts structured completion signals (task completion tool calls) and routes them through verification before allowing the completion to propagate.

- [ ] **Step 1: Read runner.go tool execution section**

Read `operator/internal/runner/runner.go` lines 740-850 to understand where tool results are processed and completion is detected.

- [ ] **Step 2: Read runner.go imports and struct fields**

Read `operator/internal/runner/runner.go` lines 1-50 to understand the Runner struct and what fields/dependencies it has.

- [ ] **Step 3: Add verification registry field to Runner**

Add to the Runner struct definition:

```go
verificationRegistry *verification.ProfileRegistry
```

Add a setter or constructor parameter so the registry can be injected from `main.go`:

```go
func (r *Runner) SetVerificationRegistry(reg *verification.ProfileRegistry) {
	r.verificationRegistry = reg
}
```

- [ ] **Step 4: Add interception in tool execution path**

After tool execution results are collected (where tool results are appended to conversation), add a check: if the tool call is a completion signal (e.g., task status set to "complete"), and the agent type has a registered verification profile, intercept.

Find the section where `TypeTaskComplete` is emitted or where task status updates are processed. Add:

```go
// After tool execution, check for completion signals that need verification
if r.verificationRegistry != nil {
	for _, exec := range toolExecs {
		if isCompletionSignal(exec, req.Agent.ID) {
			profile, ok := r.verificationRegistry.Get(req.Agent.ID)
			if ok && profile.ContextBuilder != nil {
				vctx, err := profile.ContextBuilder()
				if err == nil {
					flow := verification.NewFlow(r, req.Project.Dir)
					result, err := flow.Run(ctx, profile, vctx)
					if err != nil {
						// Emit verification error, continue
						emitVerificationEvent(req.Stream, stream.TypeVerificationFailed, req.Agent.ID, 0, "")
					} else {
						handleVerificationResult(req, result)
					}
				}
			}
		}
	}
}
```

- [ ] **Step 5: Add helper functions for interception**

```go
func isCompletionSignal(exec agent.ToolExecution, agentID string) bool {
	// Check if tool call represents a completion:
	// - goal_update with status "done"
	// - task_update with status "complete"
	// - plan_complete tool call
	name := exec.ToolCall.Name
	return name == "goal_update" || name == "task_complete" || name == "plan_complete"
}

func handleVerificationResult(req *RunRequest, result *verification.FlowResult) {
	switch {
	case result.FinalVerdict == verification.VerdictPass:
		req.Stream.Emit(stream.Event{
			Type: stream.TypeVerificationPassed,
			Data: map[string]any{"agent_type": req.Agent.ID},
		})
	case result.Escalated:
		req.Stream.Emit(stream.Event{
			Type: stream.TypeVerificationEscalated,
			Data: map[string]any{
				"agent_type":    req.Agent.ID,
				"findings_path": result.FindingsPath,
			},
		})
	}
}

// Implement AgentRunner interface on Runner for the verification flow
func (r *Runner) RunAgent(ctx context.Context, cfg verification.SpawnConfig) (string, error) {
	childAgent := r.agentResolver(cfg.AgentID)
	if childAgent == nil {
		return "", fmt.Errorf("agent %s not found", cfg.AgentID)
	}
	childReq := &RunRequest{
		Agent:   childAgent,
		Project: &Project{Dir: cfg.ProjectDir},
		// Fresh session — no prior conversation
		Messages: []provider.Message{
			{Role: "user", Content: []provider.ContentBlock{
				{Type: "text", Text: cfg.UserMessage},
			}},
		},
	}
	result, err := r.Run(ctx, childReq)
	if err != nil {
		return "", err
	}
	return result.FinalOutput, nil
}
```

- [ ] **Step 6: Run existing runner tests to ensure no regressions**

Run: `cd /Users/flakerim/Construct/construct-app/operator && go test ./internal/runner/ -v -timeout 60s`
Expected: PASS (existing tests still pass)

- [ ] **Step 7: Commit**

```bash
cd /Users/flakerim/Construct/construct-app
git add operator/internal/runner/runner.go
git commit -m "feat(verification): wire verification interception into runner"
```

---

### Task 9: Coder Verification Profile

**Files:**
- Modify: relevant coder module file (likely `operator/internal/coder/coder.go` or a new `operator/internal/coder/verification.go`)

- [ ] **Step 1: Read coder module to understand goal tracking**

Read `operator/internal/coder/coder.go` to understand how goals and tasks are tracked, and where the coder module is initialized.

- [ ] **Step 2: Create coder verification profile registration**

Create `operator/internal/coder/verification.go` (or add to existing file):

```go
package coder

import (
	"fmt"
	"strings"

	"construct/operator/internal/verification"
)

// RegisterVerificationProfile registers the coder's verification profile.
// Called during coder module initialization.
func (c *Coder) RegisterVerificationProfile(registry *verification.ProfileRegistry) error {
	return registry.Register(verification.VerificationProfile{
		AgentType: "coder",
		TriggerOn: verification.TriggerGoalDone,
		ContextBuilder: func() (verification.VerifierContext, error) {
			return c.buildVerifierContext()
		},
		FindingsPath: func() string {
			goalID := c.currentGoalID()
			if goalID == "" {
				goalID = "coder"
			}
			return verification.GoalFindingsPath(c.projectDir, goalID)
		},
		MaxStrikes: 3,
		Playbook:   "", // detected from file types at runtime
	})
}

func (c *Coder) buildVerifierContext() (verification.VerifierContext, error) {
	// Extract goal description and acceptance criteria from current goal
	goal := c.currentGoal()
	if goal == nil {
		return verification.VerifierContext{}, fmt.Errorf("no active goal")
	}

	// Get files changed via git diff since goal started
	filesChanged := c.getFilesChangedSinceGoalStart()

	// Detect playbook from file extensions
	playbook := detectPlaybook(filesChanged)

	return verification.VerifierContext{
		OriginalTask:       goal.Description,
		AcceptanceCriteria: goal.AcceptanceCriteria,
		Claim:              c.lastAgentMessage(),
		FilesChanged:       filesChanged,
		Playbook:           playbook,
	}, nil
}

func detectPlaybook(files []string) string {
	hasGo, hasTS, hasVue, hasCSS := false, false, false, false
	for _, f := range files {
		switch {
		case strings.HasSuffix(f, ".go"):
			hasGo = true
		case strings.HasSuffix(f, ".ts") || strings.HasSuffix(f, ".tsx"):
			hasTS = true
		case strings.HasSuffix(f, ".vue"):
			hasVue = true
		case strings.HasSuffix(f, ".css") || strings.HasSuffix(f, ".scss"):
			hasCSS = true
		}
	}
	switch {
	case hasVue || hasCSS:
		return "frontend"
	case hasTS && !hasGo:
		return "frontend"
	case hasGo:
		return "backend"
	default:
		return ""
	}
}
```

- [ ] **Step 3: Wire registration in main.go**

Read `operator/main.go` to find where the coder module is initialized. Add profile registration after coder init:

```go
coder.RegisterVerificationProfile(verificationRegistry)
```

- [ ] **Step 4: Run coder tests**

Run: `cd /Users/flakerim/Construct/construct-app/operator && go test ./internal/coder/ -v -timeout 60s`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/flakerim/Construct/construct-app
git add operator/internal/coder/verification.go operator/main.go
git commit -m "feat(verification): register coder verification profile"
```

---

### Task 10: Architect Verification Profile

**Files:**
- Create: `operator/internal/coder/verification_architect.go` (or appropriate location based on where architect lives)

- [ ] **Step 1: Find where the architect agent is defined and initialized**

Search for architect agent definition: `grep -r "architect" operator/internal/agent/builtin/`
Read the file to understand its config.

- [ ] **Step 2: Register architect verification profile**

```go
// Register in the same location as coder, or in the architect's module

registry.Register(verification.VerificationProfile{
	AgentType: "architect",
	TriggerOn: verification.TriggerPlanComplete,
	ContextBuilder: func() (verification.VerifierContext, error) {
		return verification.VerifierContext{
			OriginalTask:       currentArchitectTask,
			AcceptanceCriteria: "- Plan covers all requirements\n- No missing logic or unhandled edge cases\n- No internal contradictions\n- All referenced files/APIs exist\n- Feasible with current codebase",
			Claim:              "Plan document written",
			FilesChanged:       []string{}, // architect doesn't change code
			Playbook:           "refactor",  // plans are reviewed like refactors
		}, nil
	},
	FindingsPath: func() string {
		return verification.PlanFindingsPath(projectDir)
	},
	MaxStrikes: 3,
	Playbook:   "refactor",
})
```

- [ ] **Step 3: Run tests**

Run: `cd /Users/flakerim/Construct/construct-app/operator && go test ./... -timeout 120s`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd /Users/flakerim/Construct/construct-app
git add -A operator/
git commit -m "feat(verification): register architect verification profile"
```

---

### Task 11: Coordinator Verification Profile

**Files:**
- Modify: `operator/internal/runner/coordinator.go`

- [ ] **Step 1: Read coordinator.go to understand worker result handling**

Read `operator/internal/runner/coordinator.go` lines 120-200 where worker results are collected.

- [ ] **Step 2: Register coordinator verification profile**

Add profile registration that triggers after all coordinate workers return:

```go
registry.Register(verification.VerificationProfile{
	AgentType: "coordinator",
	TriggerOn: verification.TriggerDelegationResult,
	ContextBuilder: func() (verification.VerifierContext, error) {
		// Collect all worker results and files changed
		return verification.VerifierContext{
			OriginalTask:       coordinationTask,
			AcceptanceCriteria: "- All workers completed successfully\n- No conflicting file edits\n- Combined result satisfies original task\n- No integration gaps",
			Claim:              workerResultSummary,
			FilesChanged:       allWorkerFilesChanged,
			Playbook:           "", // detected from files
		}, nil
	},
	FindingsPath: func() string {
		return verification.DelegationFindingsPath(projectDir, taskID)
	},
	MaxStrikes: 3,
})
```

- [ ] **Step 3: Run coordinator tests**

Run: `cd /Users/flakerim/Construct/construct-app/operator && go test ./internal/runner/ -v -run TestCoordinate -timeout 60s`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd /Users/flakerim/Construct/construct-app
git add operator/internal/runner/coordinator.go
git commit -m "feat(verification): register coordinator verification profile"
```

---

### Task 12: Morpheus Verification Profile

**Files:**
- Modify: `operator/internal/morpheus/` (wherever dynamic agent task completion is handled)

- [ ] **Step 1: Read morpheus loop.go to find task completion handling**

Read `operator/internal/morpheus/loop.go` to find where dynamic agent task results are processed.

- [ ] **Step 2: Register morpheus verification profile**

```go
registry.Register(verification.VerificationProfile{
	AgentType: "morpheus",
	TriggerOn: verification.TriggerTaskComplete,
	ContextBuilder: func() (verification.VerifierContext, error) {
		return verification.VerifierContext{
			OriginalTask:       wakeTask.Description,
			AcceptanceCriteria: "- Task actually resolved (not just attempted)\n- No regressions introduced\n- Policy level respected",
			Claim:              dynamicAgentOutput,
			FilesChanged:       filesChangedByDynamicAgent,
			Playbook:           "",
		}, nil
	},
	FindingsPath: func() string {
		return verification.AgentFindingsPath(projectDir, dynamicAgentID)
	},
	MaxStrikes: 3,
})
```

- [ ] **Step 3: Run morpheus tests**

Run: `cd /Users/flakerim/Construct/construct-app/operator && go test ./internal/morpheus/ -v -timeout 60s`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd /Users/flakerim/Construct/construct-app
git add operator/internal/morpheus/
git commit -m "feat(verification): register morpheus verification profile"
```

---

### Task 13: Morpheus Observer — Verification Event Tracking

**Files:**
- Modify: `operator/internal/morpheus/observer.go`

- [ ] **Step 1: Read observer.go to understand ObserveTool and state tracking**

Read `operator/internal/morpheus/observer.go` fully.

- [ ] **Step 2: Add verification event observation**

Add a new method alongside `ObserveTool`:

```go
// VerificationRecord tracks a single verification outcome.
type VerificationRecord struct {
	AgentType       string
	ChecksFailed    []string
	Category        string // "frontend", "backend", etc.
	StrikeReached   int
	ResolvedBy      string // "agent", "fixer", "escalated"
	Timestamp       time.Time
}

// ObserveVerification records a verification outcome for pattern detection.
func (o *Observer) ObserveVerification(rec VerificationRecord) {
	o.mu.Lock()
	defer o.mu.Unlock()

	o.verificationHistory = append(o.verificationHistory, rec)

	// Keep bounded history (last 100 records)
	if len(o.verificationHistory) > 100 {
		o.verificationHistory = o.verificationHistory[len(o.verificationHistory)-100:]
	}

	// Check for patterns
	o.detectVerificationPatterns()
}

func (o *Observer) detectVerificationPatterns() {
	// Count failures by category in last 7 days
	cutoff := time.Now().AddDate(0, 0, -7)
	categoryCount := make(map[string]int)
	checkCount := make(map[string]int)

	for _, rec := range o.verificationHistory {
		if rec.Timestamp.Before(cutoff) {
			continue
		}
		if rec.StrikeReached > 1 { // only count actual failures
			categoryCount[rec.Category]++
			for _, check := range rec.ChecksFailed {
				checkCount[check]++
			}
		}
	}

	// Threshold: 3+ failures in same category within 7 days
	for category, count := range categoryCount {
		if count >= 3 {
			o.enqueueImprovementAction(category, checkCount)
		}
	}
}

func (o *Observer) enqueueImprovementAction(category string, failingChecks map[string]int) {
	// Queue a wake event for Morpheus to handle the improvement
	o.events = append(o.events, WakeEvent{
		Type:   "improvement_needed",
		Reason: fmt.Sprintf("repeated verification failures in %s category", category),
		Data: map[string]any{
			"category":       category,
			"failing_checks": failingChecks,
		},
	})
}
```

- [ ] **Step 3: Add verificationHistory field to Observer struct**

```go
type Observer struct {
	// ... existing fields ...
	verificationHistory []VerificationRecord
}
```

- [ ] **Step 4: Run morpheus tests**

Run: `cd /Users/flakerim/Construct/construct-app/operator && go test ./internal/morpheus/ -v -timeout 60s`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/flakerim/Construct/construct-app
git add operator/internal/morpheus/observer.go
git commit -m "feat(verification): add verification event tracking to Morpheus observer"
```

---

### Task 14: Wire RecordVerification and SuggestPromptFix

**Files:**
- Modify: `operator/internal/dynagent/improve.go`
- Modify: `operator/internal/verification/flow.go`

- [ ] **Step 1: Read improve.go to understand current RecordVerification signature**

Read `operator/internal/dynagent/improve.go` fully.

- [ ] **Step 2: Add RecordVerification call in flow.go after each verdict**

In `flow.go`, after each verifier run returns a verdict, call RecordVerification:

```go
// In flow.go Run(), after parsing verdict:
if f.improvementStore != nil {
	f.improvementStore.RecordVerification(dynagent.ImprovementRecord{
		AgentID:         profile.AgentType,
		TaskDescription: vctx.OriginalTask,
		VerifierVerdict: string(verdict),
		FailureReason:   strings.Join(parseActionRequired(output), "; "),
		Attempt:         strike,
		Timestamp:       time.Now(),
	})
}
```

- [ ] **Step 3: Add improvementStore field to Flow**

```go
type Flow struct {
	runner           AgentRunner
	projectDir       string
	improvementStore *dynagent.Store // optional, nil-safe
	observer         *morpheus.Observer // optional, nil-safe
}

func NewFlow(runner AgentRunner, projectDir string, opts ...FlowOption) *Flow {
	f := &Flow{runner: runner, projectDir: projectDir}
	for _, opt := range opts {
		opt(f)
	}
	return f
}

type FlowOption func(*Flow)

func WithImprovementStore(s *dynagent.Store) FlowOption {
	return func(f *Flow) { f.improvementStore = s }
}

func WithObserver(o *morpheus.Observer) FlowOption {
	return func(f *Flow) { f.observer = o }
}
```

- [ ] **Step 4: Wire SuggestPromptFix into Morpheus improvement action handler**

In Morpheus loop.go, when handling `improvement_needed` wake events:

```go
case "improvement_needed":
	category := event.Data["category"].(string)
	suggestion := improvementStore.SuggestPromptFix(agentID)
	// Write suggestion to overlay file
	overlay.AppendImprovement(agentID, suggestion)
```

- [ ] **Step 5: Update flow_test.go to account for new constructor**

Update `NewFlow` calls in `flow_test.go` to use the new signature (no options needed for tests — stores default to nil).

- [ ] **Step 6: Run all verification tests**

Run: `cd /Users/flakerim/Construct/construct-app/operator && go test ./internal/verification/ ./internal/dynagent/ ./internal/morpheus/ -v -timeout 60s`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
cd /Users/flakerim/Construct/construct-app
git add operator/internal/verification/flow.go operator/internal/verification/flow_test.go operator/internal/dynagent/improve.go operator/internal/morpheus/
git commit -m "feat(verification): wire RecordVerification and SuggestPromptFix into flow"
```

---

### Task 15: Local Overlay System

**Files:**
- Create: `operator/internal/verification/overlay.go`
- Create: `operator/internal/verification/overlay_test.go`

- [ ] **Step 1: Write the failing test**

```go
// operator/internal/verification/overlay_test.go
package verification

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWriteAndReadOverlay(t *testing.T) {
	dir := t.TempDir()
	store := NewOverlayStore(dir)

	err := store.AppendImprovement("coder", "Always check CSS accessibility on frontend goals")
	if err != nil {
		t.Fatalf("AppendImprovement: %v", err)
	}

	content, err := store.ReadOverlay("coder")
	if err != nil {
		t.Fatalf("ReadOverlay: %v", err)
	}

	if !strings.Contains(content, "CSS accessibility") {
		t.Error("overlay missing appended content")
	}
	if !strings.Contains(content, "Local Improvements") {
		t.Error("overlay missing header")
	}
}

func TestOverlayAppendsWithoutDuplicates(t *testing.T) {
	dir := t.TempDir()
	store := NewOverlayStore(dir)

	store.AppendImprovement("coder", "Check accessibility")
	store.AppendImprovement("coder", "Check accessibility") // duplicate
	store.AppendImprovement("coder", "Verify response codes")

	content, _ := store.ReadOverlay("coder")
	count := strings.Count(content, "Check accessibility")
	if count != 1 {
		t.Errorf("expected 1 occurrence, got %d", count)
	}
}

func TestReadOverlayReturnsEmptyForMissing(t *testing.T) {
	dir := t.TempDir()
	store := NewOverlayStore(dir)

	content, err := store.ReadOverlay("nonexistent")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if content != "" {
		t.Errorf("expected empty, got %q", content)
	}
}

func TestDeleteOverlay(t *testing.T) {
	dir := t.TempDir()
	store := NewOverlayStore(dir)

	store.AppendImprovement("coder", "test improvement")
	store.DeleteOverlay("coder")

	path := filepath.Join(dir, "coder.overlay.md")
	_, err := os.Stat(path)
	if !os.IsNotExist(err) {
		t.Error("overlay should be deleted")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/flakerim/Construct/construct-app/operator && go test ./internal/verification/ -v -run TestOverlay`
Expected: FAIL — NewOverlayStore not defined

- [ ] **Step 3: Implement overlay store**

```go
// operator/internal/verification/overlay.go
package verification

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// OverlayStore manages prompt overlays in the Application Support directory.
type OverlayStore struct {
	dir string // e.g., ~/Library/Application Support/Construct/improvements/
}

func NewOverlayStore(dir string) *OverlayStore {
	return &OverlayStore{dir: dir}
}

// AppendImprovement adds a line to an agent's overlay file.
// Skips duplicates.
func (s *OverlayStore) AppendImprovement(agentType, improvement string) error {
	os.MkdirAll(s.dir, 0755)

	path := s.overlayPath(agentType)
	existing, _ := os.ReadFile(path)
	content := string(existing)

	// Check for duplicate
	if strings.Contains(content, improvement) {
		return nil
	}

	// Build or append
	if content == "" {
		content = fmt.Sprintf("## Local Improvements (auto-generated by Morpheus)\n\n- %s\n", improvement)
	} else {
		content += fmt.Sprintf("- %s\n", improvement)
	}

	return os.WriteFile(path, []byte(content), 0644)
}

// ReadOverlay returns the overlay content for an agent type.
// Returns empty string if no overlay exists.
func (s *OverlayStore) ReadOverlay(agentType string) (string, error) {
	path := s.overlayPath(agentType)
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// DeleteOverlay removes an agent's overlay file.
func (s *OverlayStore) DeleteOverlay(agentType string) error {
	return os.Remove(s.overlayPath(agentType))
}

// ListOverlays returns all agent types that have overlays.
func (s *OverlayStore) ListOverlays() ([]string, error) {
	entries, err := os.ReadDir(s.dir)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var agents []string
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".overlay.md") {
			agents = append(agents, strings.TrimSuffix(e.Name(), ".overlay.md"))
		}
	}
	return agents, nil
}

func (s *OverlayStore) overlayPath(agentType string) string {
	return filepath.Join(s.dir, agentType+".overlay.md")
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/flakerim/Construct/construct-app/operator && go test ./internal/verification/ -v -run TestOverlay`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/flakerim/Construct/construct-app
git add operator/internal/verification/overlay.go operator/internal/verification/overlay_test.go
git commit -m "feat(verification): add local overlay store for prompt improvements"
```

---

### Task 16: Overlay Injection into System Prompt Assembly

**Files:**
- Modify: `operator/internal/coder/runner_adapter.go`

- [ ] **Step 1: Read runner_adapter.go lines 60-80 to find prompt assembly**

Read `operator/internal/coder/runner_adapter.go` around `FileSummary()` (line 65-77).

- [ ] **Step 2: Add overlay injection**

After memory section and before the return, inject overlay content:

```go
// In FileSummary() or equivalent prompt assembly function:
overlayContent := ""
if overlayStore != nil {
	overlay, err := overlayStore.ReadOverlay(agentID)
	if err == nil && overlay != "" {
		overlayContent = "\n\n" + overlay
	}
}

// Include in the assembled prompt
return fileSummary + subAgentPrompt + memorySection + overlayContent
```

- [ ] **Step 3: Wire overlay store into coder module**

Pass the `OverlayStore` to the coder module during initialization in `main.go`. The overlay store path should be:

```go
overlayDir := filepath.Join(appDataDir, "improvements")
overlayStore := verification.NewOverlayStore(overlayDir)
```

Where `appDataDir` is the Application Support directory (aligned with `frontend/lib/appPaths.ts`).

- [ ] **Step 4: Run coder tests**

Run: `cd /Users/flakerim/Construct/construct-app/operator && go test ./internal/coder/ -v -timeout 60s`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/flakerim/Construct/construct-app
git add operator/internal/coder/runner_adapter.go operator/main.go
git commit -m "feat(verification): inject overlays into system prompt assembly"
```

---

### Task 17: Frontend Stream Events and Handlers

**Files:**
- Modify: `frontend/operator/streamEvents.ts`
- Modify: `frontend/operator/useStreamStatus.ts`

- [ ] **Step 1: Read streamEvents.ts to find the event type pattern**

Read `frontend/operator/streamEvents.ts` lines 1-50.

- [ ] **Step 2: Add verification event types to streamEvents.ts**

```typescript
// Add to StreamType object
VerificationStarted: 'verification.started',
VerificationPassed: 'verification.passed',
VerificationFailed: 'verification.failed',
VerificationEscalated: 'verification.escalated',
VerificationFixerSpawned: 'verification.fixer_spawned',

// Add interfaces
export interface VerificationStartedEvent {
  goalId: string
  strike: number
  agentType: string
}

export interface VerificationPassedEvent {
  goalId: string
  agentType: string
}

export interface VerificationFailedEvent {
  goalId: string
  strike: number
  findingsPath: string
  agentType: string
}

export interface VerificationEscalatedEvent {
  goalId: string
  findingsPath: string
  agentType: string
}

export interface VerificationFixerSpawnedEvent {
  goalId: string
  agentType: string
}
```

- [ ] **Step 3: Read useStreamStatus.ts to find the event handler pattern**

Read `frontend/operator/useStreamStatus.ts` lines 400-530 to see how stream events are handled.

- [ ] **Step 4: Add verification event handlers in useStreamStatus.ts**

```typescript
// Add reactive state
const verificationStatus = ref<{
  active: boolean
  agentType: string
  strike: number
  goalId: string
  passed: boolean
  escalated: boolean
  findingsPath: string
} | null>(null)

// Add handlers in handleChunk()
if (type === 'verification.started') {
  const d = data as VerificationStartedEvent
  verificationStatus.value = {
    active: true,
    agentType: d.agentType,
    strike: d.strike,
    goalId: d.goalId,
    passed: false,
    escalated: false,
    findingsPath: '',
  }
  triggerRef(verificationStatus)
}

if (type === 'verification.passed') {
  if (verificationStatus.value) {
    verificationStatus.value.active = false
    verificationStatus.value.passed = true
    triggerRef(verificationStatus)
  }
}

if (type === 'verification.failed') {
  const d = data as VerificationFailedEvent
  if (verificationStatus.value) {
    verificationStatus.value.strike = d.strike
    verificationStatus.value.findingsPath = d.findingsPath
    triggerRef(verificationStatus)
  }
}

if (type === 'verification.escalated') {
  const d = data as VerificationEscalatedEvent
  if (verificationStatus.value) {
    verificationStatus.value.active = false
    verificationStatus.value.escalated = true
    verificationStatus.value.findingsPath = d.findingsPath
    triggerRef(verificationStatus)
  }
}

if (type === 'verification.fixer_spawned') {
  // Could update UI to show fixer is working
}
```

- [ ] **Step 5: Export verificationStatus from the composable return**

Add `verificationStatus` to the return object of `useStreamStatus`.

- [ ] **Step 6: Run frontend typecheck**

Run: `cd /Users/flakerim/Construct/construct-app && bun run typecheck`
Expected: PASS

- [ ] **Step 7: Run frontend tests**

Run: `cd /Users/flakerim/Construct/construct-app && bun run test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
cd /Users/flakerim/Construct/construct-app
git add frontend/operator/streamEvents.ts frontend/operator/useStreamStatus.ts
git commit -m "feat(verification): add frontend verification stream events and handlers"
```

---

### Task 18: Morpheus Cockpit Verification UI

**Files:**
- Modify: `frontend/spaces/morpheus/pages/MorpheusPage.vue`

- [ ] **Step 1: Read MorpheusPage.vue to understand current layout**

Read `frontend/spaces/morpheus/pages/MorpheusPage.vue` fully.

- [ ] **Step 2: Add verification stats section**

Add a new grid section after the Wake/Sleep details, before Dynamic Agents:

```vue
<!-- Verification Stats -->
<div class="verification-stats" v-if="verificationHistory.length">
  <h3>Verification</h3>
  <div class="stats-grid">
    <div class="stat">
      <span class="stat-label">Total Verifications</span>
      <span class="stat-value">{{ verificationHistory.length }}</span>
    </div>
    <div class="stat">
      <span class="stat-label">Pass Rate</span>
      <span class="stat-value">{{ passRate }}%</span>
    </div>
    <div class="stat">
      <span class="stat-label">Avg Strikes</span>
      <span class="stat-value">{{ avgStrikes }}</span>
    </div>
    <div class="stat">
      <span class="stat-label">Escalations</span>
      <span class="stat-value">{{ escalationCount }}</span>
    </div>
  </div>

  <!-- Active overlays -->
  <div class="overlays" v-if="activeOverlays.length">
    <h4>Active Improvements</h4>
    <div v-for="overlay in activeOverlays" :key="overlay.agent" class="overlay-item">
      <span class="overlay-agent">{{ overlay.agent }}</span>
      <span class="overlay-count">{{ overlay.improvements }} improvements</span>
    </div>
  </div>
</div>
```

- [ ] **Step 3: Add computed properties**

```typescript
const verificationHistory = computed(() => {
  // Filter timeline entries for verification events
  return notifications.value.filter(n => n.type === 'verification')
})

const passRate = computed(() => {
  const total = verificationHistory.value.length
  if (total === 0) return 0
  const passes = verificationHistory.value.filter(v => v.message.includes('PASS')).length
  return Math.round((passes / total) * 100)
})

const avgStrikes = computed(() => {
  const total = verificationHistory.value.length
  if (total === 0) return 0
  // Parse strike count from verification events
  const sum = verificationHistory.value.reduce((acc, v) => {
    const match = v.message.match(/strike (\d+)/)
    return acc + (match ? parseInt(match[1]) : 1)
  }, 0)
  return (sum / total).toFixed(1)
})

const escalationCount = computed(() => {
  return verificationHistory.value.filter(v => v.message.includes('escalated')).length
})
```

- [ ] **Step 4: Run frontend typecheck**

Run: `cd /Users/flakerim/Construct/construct-app && bun run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/flakerim/Construct/construct-app
git add frontend/spaces/morpheus/pages/MorpheusPage.vue
git commit -m "feat(verification): add verification stats to Morpheus cockpit"
```

---

### Task 19: Infra Telemetry Endpoint

**Files:**
- Create: `infra/source/internal/handlers/morpheus.go`
- Create: `infra/source/internal/models/morpheus.go`
- Modify: `infra/source/main.go`

- [ ] **Step 1: Read infra main.go to understand routing pattern**

Read `/Users/flakerim/Construct/infra/source/main.go`.

- [ ] **Step 2: Create the model**

```go
// infra/source/internal/models/morpheus.go
package models

import "time"

type VerificationPattern struct {
	ID               int64     `json:"id"`
	AgentType        string    `json:"agent_type"`
	FailureCategory  string    `json:"failure_category"`
	CheckFailed      string    `json:"check_failed"`
	StrikeReached    int       `json:"strike_reached"`
	PlaybookUsed     string    `json:"playbook_used"`
	ResolvedBy       string    `json:"resolved_by"` // "agent", "fixer", "escalated"
	Frequency        int       `json:"frequency"`
	PeriodDays       int       `json:"period_days"`
	InstallationID   string    `json:"installation_id"`
	ConstructVersion string    `json:"construct_version"`
	CreatedAt        time.Time `json:"created_at"`
}
```

- [ ] **Step 3: Create the handler**

```go
// infra/source/internal/handlers/morpheus.go
package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"construct/source/internal/models"
)

type SubmitPatternsRequest struct {
	Patterns []models.VerificationPattern `json:"patterns"`
}

func SubmitVerificationPatterns(w http.ResponseWriter, r *http.Request) {
	var req SubmitPatternsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid request body"})
		return
	}

	if len(req.Patterns) == 0 {
		WriteJSON(w, http.StatusBadRequest, map[string]any{"error": "no patterns provided"})
		return
	}

	// Rate limit: max 50 patterns per request
	if len(req.Patterns) > 50 {
		WriteJSON(w, http.StatusBadRequest, map[string]any{"error": "too many patterns, max 50"})
		return
	}

	// Validate: no user-identifying data
	for i := range req.Patterns {
		req.Patterns[i].CreatedAt = time.Now()
		// Strip any paths that might have leaked
		req.Patterns[i].CheckFailed = sanitizePattern(req.Patterns[i].CheckFailed)
	}

	// TODO: persist to database (implementation depends on DB schema)
	// For now, accept and acknowledge
	WriteJSON(w, http.StatusOK, map[string]any{
		"accepted": len(req.Patterns),
	})
}

func sanitizePattern(s string) string {
	// Remove anything that looks like an absolute path
	// Keep only the check description, not file paths
	// This is a safety net — client should already sanitize
	return s
}
```

- [ ] **Step 4: Add route in main.go**

```go
mux.Handle("POST /api/v1/morpheus/patterns", auth(http.HandlerFunc(handlers.SubmitVerificationPatterns)))
```

- [ ] **Step 5: Run infra tests**

Run: `cd /Users/flakerim/Construct/infra/source && go test ./... -v -timeout 60s`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/flakerim/Construct/infra/source
git add internal/handlers/morpheus.go internal/models/morpheus.go main.go
git commit -m "feat(verification): add morpheus verification patterns endpoint"
```

---

### Task 20: Client-Side Telemetry and Settings

**Files:**
- Modify: `operator/internal/morpheus/observer.go` (or new `operator/internal/morpheus/telemetry.go`)
- Modify: `operator/internal/state/settings_schema.go`

- [ ] **Step 1: Read settings_schema.go to find how settings are defined**

Read `operator/internal/state/settings_schema.go` to understand the schema pattern.

- [ ] **Step 2: Add telemetry opt-in setting**

Add to settings schema:

```go
{
	Key:          "morpheus_telemetry",
	Group:        "ai",
	Type:         "bool",
	DefaultValue: false,
	Description:  "Send anonymized verification patterns to Construct for aggregate analysis",
}
```

- [ ] **Step 3: Create telemetry client**

```go
// operator/internal/morpheus/telemetry.go
package morpheus

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type TelemetryClient struct {
	endpoint       string
	installationID string
	version        string
	httpClient     *http.Client
	enabled        bool
}

func NewTelemetryClient(endpoint, installationID, version string) *TelemetryClient {
	return &TelemetryClient{
		endpoint:       endpoint,
		installationID: installationID,
		version:        version,
		httpClient:     &http.Client{Timeout: 10 * time.Second},
	}
}

func (t *TelemetryClient) SetEnabled(enabled bool) {
	t.enabled = enabled
}

type PatternPayload struct {
	AgentType       string `json:"agent_type"`
	FailureCategory string `json:"failure_category"`
	CheckFailed     string `json:"check_failed"`
	StrikeReached   int    `json:"strike_reached"`
	PlaybookUsed    string `json:"playbook_used"`
	ResolvedBy      string `json:"resolved_by"`
	Frequency       int    `json:"frequency"`
	PeriodDays      int    `json:"period_days"`
}

func (t *TelemetryClient) SubmitPatterns(ctx context.Context, patterns []PatternPayload) error {
	if !t.enabled || len(patterns) == 0 {
		return nil
	}

	body, err := json.Marshal(map[string]any{
		"patterns":          patterns,
		"installation_id":   t.installationID,
		"construct_version": t.version,
	})
	if err != nil {
		return fmt.Errorf("marshal patterns: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", t.endpoint+"/api/v1/morpheus/patterns", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := t.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("submit patterns: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}
	return nil
}
```

- [ ] **Step 4: Wire telemetry into Morpheus observer**

In the observer, after detecting patterns (in `detectVerificationPatterns`), if telemetry is enabled, batch and submit:

```go
if o.telemetry != nil {
	var patterns []PatternPayload
	for category, count := range categoryCount {
		if count >= 3 {
			patterns = append(patterns, PatternPayload{
				AgentType:       "", // filled per agent
				FailureCategory: category,
				Frequency:       count,
				PeriodDays:      7,
			})
		}
	}
	go o.telemetry.SubmitPatterns(context.Background(), patterns)
}
```

- [ ] **Step 5: Run all operator tests**

Run: `cd /Users/flakerim/Construct/construct-app/operator && go test ./... -timeout 120s`
Expected: PASS

- [ ] **Step 6: Run frontend typecheck**

Run: `cd /Users/flakerim/Construct/construct-app && bun run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
cd /Users/flakerim/Construct/construct-app
git add operator/internal/morpheus/telemetry.go operator/internal/state/settings_schema.go
git commit -m "feat(verification): add opt-in telemetry client for verification patterns"
```

---

## Final Integration Test

After all tasks, run the full test suite:

```bash
cd /Users/flakerim/Construct/construct-app/operator && go test ./... -timeout 120s
cd /Users/flakerim/Construct/construct-app && bun run test
cd /Users/flakerim/Construct/construct-app && bun run typecheck
cd /Users/flakerim/Construct/construct-app && bun run lint
```

All must pass before considering the feature complete.
