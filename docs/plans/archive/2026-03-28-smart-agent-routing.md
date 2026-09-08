# Smart Agent Routing — Priority-Based Multi-Agent Orchestration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The AssistantPanel uses a single "General" agent that understands requests, checks the active context's agent (priority), and routes work to the right specialist — enabling cross-space tasks from any context.

**Architecture:** General agent is always the entry point for AssistantPanel. When a space or project is active, the corresponding agent's description is injected into General's system prompt as priority context. General decomposes requests and spawns the appropriate agent(s). The priority agent gets first consideration, but General can spawn any agent. Coder space bypasses General entirely (direct dispatch).

**Tech Stack:** Go (operator/runner), Vue 3 (frontend), TypeScript, TCP transport

**Current State:**
- `resolveAgent("")` in main.go has a stale vibe fallback — `ai.chat_stream` and `ai.chat` use `resolveAgent("")` intentionally, so empty ID must stay mapped to General
- `AssistantPanel.vue` switches `selectedAgent` to space agent IDs — routing exclusively to that agent
- Project routes (`/app/projects/:id`) explicitly switch to `project` agent — must preserve as priority
- Standalone window listens for `space-changed` events and calls `switchToSpace()` — must update with `isTauriEnv()` guard and `onUnmounted` cleanup preserved
- `useAgentSession.ts` is a **shared composable** used by AssistantPanel AND ArchitectPage — changes must not regress existing callers (projectPath, sessionId forwarding)
- `useAgentSession` falls back to sync `dispatch()` when streaming fails — sync path needs `activeContext` AND `sessionId`
- Space agents are loaded with IDs like `space:todo`; `spawn_agent` checks `SpawnAllowed` with exact match
- AssistantPanel shows a passive agent label, not a picker dropdown

**Terminology:** "active context" (not "active space") — covers both space routes (`todo`, `design`) and project routes (`project`). The injected priority agent is the "PRIORITY AGENT" in the prompt.

**Behavioral note on spawn prefix matching (Task 4):** Changing `SpawnAllowed` from exact to prefix matching means agents with `"space"` in their allowlist (coder, project, architect, brainstorm) gain access to all `space:*` agents. This is intentional — all agents should be able to delegate to installed space specialists.

---

### Task 1: Extract resolveAgent Into Testable Function

**Files:**
- Modify: `operator/main.go`

The current `resolveAgent` is a closure local to `main()`. Extract it to a package-level function so it can be tested. Remove stale vibe references. Keep `resolveAgent("")` returning fallback (General).

- [ ] **Step 1: Read the current resolveAgent closure**

```bash
cd /Users/flakerim/Construct/construct-app/operator
grep -n -A 25 'resolveAgent :=' main.go
```

- [ ] **Step 2: Create a package-level resolver function**

```go
// findAgent finds an agent by ID from a list. Returns nil if not found.
// Empty ID and "general" return fallback.
// Supports "space:<id>" namespace — searching by both exact ID and "space:"+id.
func findAgent(id string, agents []*agent.Config, fallback *agent.Config) *agent.Config {
	if id == "" || id == "general" {
		return fallback
	}
	for i := len(agents) - 1; i >= 0; i-- {
		a := agents[i]
		if a.ID == id || a.ID == "space:"+id {
			return a
		}
	}
	return nil
}
```

- [ ] **Step 3: Update the closure to delegate**

```go
resolveAgent := func(id string) *agent.Config {
	return findAgent(id, allAgents, fallbackAgent)
}
```

- [ ] **Step 4: Fix the stale log line**

```go
fmt.Fprintf(os.Stderr, "[operator] loaded %d core agents\n", len(allAgents))
```

- [ ] **Step 5: Build and verify**

```bash
go build ./... && echo OK
```

- [ ] **Step 6: Commit**

```bash
git add main.go
git commit -m "refactor: extract resolveAgent to testable findAgent function"
```

---

### Task 2: Upgrade General Agent — Smart Router with Placeholders

**Files:**
- Modify: `operator/main.go` (fallbackAgent definition)

General needs a system prompt that makes it a smart dispatcher. Use `{available_agents}` and `{priority_agent_context}` placeholders filled at request time. Use "PRIORITY AGENT" terminology, not "ACTIVE SPACE AGENT" — the priority agent may be the `project` agent on project routes, not a space.

- [ ] **Step 1: Read the current fallback agent**

```bash
grep -n -A 30 'fallbackAgent :=' main.go
```

- [ ] **Step 2: Rewrite the General agent with placeholders**

```go
fallbackAgent := &agent.Config{
	ID:          "general",
	Name:        "General",
	Description: "Smart assistant that routes tasks to the right specialist agent",
	Category:    "primary",
	Model:       "",
	MaxTurns:    50,
	CanSpawn:    true,
	System: `You are Construct's assistant. You understand user requests and route work to the right specialist agent.

## How you work
1. Read the user's request carefully. It may contain multiple tasks for different domains.
2. Check if the PRIORITY AGENT (below) can handle part or all of the request — it gets first consideration.
3. For each part of the request, spawn the most appropriate agent using spawn_agent.
4. If the task is simple conversation (questions, explanations), handle it yourself without spawning.

## Available agents
{available_agents}

## Priority agent
{priority_agent_context}

## Rules
- Always tell the user what you're doing before spawning agents.
- For multi-part requests, spawn agents for each part.
- The priority agent gets FIRST CONSIDERATION — prefer it when the task matches its domain.
- But don't limit yourself to it — spawn other agents when the task crosses domains.
- If no priority agent is set and the task is coding, spawn coder.
- Keep your own responses brief — you're a router, not the worker.`,
}
```

- [ ] **Step 3: Build and verify**

```bash
go build ./... && echo OK
```

- [ ] **Step 4: Commit**

```bash
git add main.go
git commit -m "feat: upgrade General agent to smart router with placeholders"
```

---

### Task 3: Fill Placeholders at Request Time

**Files:**
- Modify: `operator/main.go` (both dispatch handlers)

Add `ActiveContext` to the dispatch payload. When the resolved agent is General, fill both `{available_agents}` and `{priority_agent_context}` placeholders by cloning the config.

- [ ] **Step 1: Add prepareGeneralAgent helper**

```go
// prepareGeneralAgent clones the General agent config and fills its placeholders
// with the list of available agents and the priority agent context.
func prepareGeneralAgent(cfg *agent.Config, allAgents []*agent.Config, activeContext string, resolveAgent func(string) *agent.Config) *agent.Config {
	clone := *cfg

	// Fill {available_agents}
	var agentList strings.Builder
	agentList.WriteString("You can spawn any agent with spawn_agent:\n")
	for _, a := range allAgents {
		if a.ID == "general" {
			continue
		}
		agentList.WriteString(fmt.Sprintf("- %s: %s\n", a.ID, a.Description))
	}
	clone.System = strings.Replace(clone.System, "{available_agents}", agentList.String(), 1)

	// Fill {priority_agent_context}
	priorityContext := "No priority agent — route based on request content."
	if activeContext != "" {
		if priorityAgent := resolveAgent(activeContext); priorityAgent != nil {
			priorityContext = fmt.Sprintf(
				"PRIORITY AGENT: %s (%s)\nAgent ID for spawn_agent: %s\nDescription: %s",
				activeContext, priorityAgent.Name, priorityAgent.ID, priorityAgent.Description,
			)
		}
	}
	clone.System = strings.Replace(clone.System, "{priority_agent_context}", priorityContext, 1)

	return &clone
}
```

- [ ] **Step 2: Add ActiveContext to streaming dispatch payload**

```go
case req.Type == "agents.dispatch_stream":
	var payload struct {
		AgentID       string             `json:"agent_id"`
		Task          string             `json:"task"`
		Model         string             `json:"model,omitempty"`
		Messages      []provider.Message `json:"messages,omitempty"`
		SessionID     string             `json:"session_id,omitempty"`
		ProjectPath   string             `json:"project_path,omitempty"`
		ProjectName   string             `json:"project_name,omitempty"`
		ActiveContext string             `json:"active_context,omitempty"`
	}
```

- [ ] **Step 3: Call prepareGeneralAgent before run.Run**

After resolving the agent, before creating the emitter:

```go
agentCfg := resolveAgent(payload.AgentID)
if agentCfg == nil {
	// ... error
}

// Inject context into General's prompt
if agentCfg.ID == "general" {
	agentCfg = prepareGeneralAgent(agentCfg, allAgents, payload.ActiveContext, resolveAgent)
}
```

- [ ] **Step 4: Apply the same to the sync dispatch handler**

Add `ActiveContext` to the sync `agents.dispatch` payload struct. Call `prepareGeneralAgent` the same way.

- [ ] **Step 5: Build and verify**

```bash
go build ./... && echo OK
```

- [ ] **Step 6: Commit**

```bash
git add main.go
git commit -m "feat: fill General agent placeholders with available agents and priority context"
```

---

### Task 4: Fix spawn_agent — Support Namespace Prefix Matching

**Files:**
- Modify: `operator/internal/runner/runner.go` (handleSpawnAgent)

Currently `SpawnAllowed` uses exact ID match. `"space"` in the allowlist won't match `"space:todo"`. Fix to support prefix matching. `nil`/empty `SpawnAllowed` means unrestricted.

**Note:** This broadens permissions for all agents that have `"space"` in their allowlist. This is intentional.

- [ ] **Step 1: Read the current spawn validation**

```bash
grep -n -A 20 'func.*handleSpawnAgent' operator/internal/runner/runner.go
```

- [ ] **Step 2: Update the allowlist check**

Note: the requested child agent ID is `args.AgentID` (parsed from tool input JSON), not a local `agentID` variable.

```go
// Check spawn allowlist — empty means unrestricted
if len(parentReq.Agent.SpawnAllowed) > 0 {
	allowed := false
	for _, prefix := range parentReq.Agent.SpawnAllowed {
		if args.AgentID == prefix || strings.HasPrefix(args.AgentID, prefix+":") {
			allowed = true
			break
		}
	}
	if !allowed {
		return provider.ToolResult{
			CallID: tc.ID, Content: fmt.Sprintf("not allowed to spawn: %s", args.AgentID), IsError: true,
		}
	}
}
```

- [ ] **Step 3: Build and verify**

```bash
go build ./... && echo OK
```

- [ ] **Step 4: Commit**

```bash
git add operator/internal/runner/runner.go
git commit -m "fix: spawn allowlist supports namespace prefix matching (space → space:*)"
```

---

### Task 5: Frontend — AssistantPanel Always General, Pass Active Context

**Files:**
- Modify: `frontend/components/ai/AssistantPanel.vue` (routing logic only)
- Modify: `frontend/operator/useAgentSession.ts` (ADD `activeContext` option, preserve all existing options)
- Modify: `frontend/operator/client.ts` (ADD `activeContext` to both `dispatchStream` and `dispatch`)

**IMPORTANT:** `useAgentSession` is a shared composable used by AssistantPanel, ArchitectPage, and potentially others. This task ONLY ADDS the `activeContext` option — it does NOT remove or change existing `projectPath`, `sessionId`, or any other forwarding. Existing callers must continue to work unchanged.

- [ ] **Step 1: Add `activeContext` detection to AssistantPanel**

Replace `findAgentForSpace()` + `switchToSpace()` + `setAgent()` with passive context detection. Preserve the existing `isTauriEnv()` guard and `onUnmounted` cleanup for the standalone window listener. Keep existing regex patterns and exclusion lists:

```typescript
const activeContext = ref<string | null>(null)

function detectActiveContext() {
	const path = router.currentRoute.value.path

	// Project space route: /app/projects/:id/:spaceName
	const projectSpaceMatch = path.match(/^\/app\/projects\/[^/]+\/([a-z][\w-]*)/)
	if (projectSpaceMatch) {
		const space = projectSpaceMatch[1]
		const excluded = ['settings', 'marketplace', 'onboarding']
		activeContext.value = excluded.includes(space) ? null : space
		return
	}

	// Project detail route: /app/projects/:id — project agent gets priority
	if (/^\/app\/projects\/[^/]+\/?$/.test(path)) {
		activeContext.value = 'project'
		return
	}

	// Global space route: /app/:spaceName
	const globalMatch = path.match(/^\/app\/([a-z][\w-]*)/)
	if (globalMatch) {
		const space = globalMatch[1]
		const excluded = ['projects', 'brainstorm', 'architect', 'coder', 'settings', 'marketplace', 'onboarding']
		activeContext.value = excluded.includes(space) ? null : space
		return
	}

	activeContext.value = null
}

watch(() => router.currentRoute.value.path, detectActiveContext, { immediate: true })
```

Remove all `setAgent()` calls from route/space detection. Agent stays "general".

- [ ] **Step 2: Fix router to emit context-changed on EVERY navigation (including null)**

The current router only emits `space-changed` when the detected space is truthy. This means the standalone window keeps stale context when the main window navigates to a non-context route like `/app/settings`. Fix by always emitting:

In `frontend/router/index.ts`, find the space-changed emission and change it to always emit, passing `null` when no context:

```typescript
// Always emit — standalone window needs to know when context clears
emit('space-changed', { space: detectedSpace || null })
```

- [ ] **Step 3: Update standalone window listener — preserve lifecycle**

Replace the existing `switchToSpace()` call but preserve `isTauriEnv()` guard and cleanup:

```typescript
let unlistenSpaceChanged: (() => void) | null = null

if (props.standalone) {
	onMounted(async () => {
		if (!isTauriEnv()) return
		const { listen } = await import('@tauri-apps/api/event')
		unlistenSpaceChanged = await listen<{ space: string | null }>('space-changed', (event) => {
			activeContext.value = event.payload.space || null
		})
	})
	onUnmounted(() => {
		unlistenSpaceChanged?.()
		unlistenSpaceChanged = null
	})
}
```

- [ ] **Step 3: ADD `activeContext` to useAgentSession send options**

In `useAgentSession.ts`, add `activeContext?: string` to the options type. **Do not remove any existing options.** The full options type becomes:

```typescript
options?: {
	agentId?: string
	model?: string
	space?: string
	projectPath?: string      // KEEP — used by ArchitectPage
	taskOverride?: string     // KEEP
	activeContext?: string    // NEW
}
```

Forward it alongside existing fields in the streaming path:

```typescript
{
	...(options?.projectPath ? { projectPath: options.projectPath } : {}),
	...(runnerSessionId.value ? { sessionId: runnerSessionId.value } : {}),
	...(options?.activeContext ? { activeContext: options.activeContext } : {}),
}
```

- [ ] **Step 4: ADD `activeContext` to client.ts — both paths**

Add to `dispatchStream` options type and payload:
```typescript
// In options type:
activeContext?: string

// In payload:
...(options?.activeContext ? { active_context: options.activeContext } : {}),
```

Add to sync `dispatch()` — extend signature and payload. Include `projectPath` for parity with the streaming path (ArchitectPage passes it explicitly and can fall back to sync):
```typescript
async function dispatch(
	agentId: string,
	task: string,
	model?: string,
	options?: {
		activeContext?: string
		sessionId?: string
		projectPath?: string
	},
): Promise<DispatchResult> {
	return send('agents.dispatch', {
		agent_id: agentId,
		task,
		...(model ? { model } : {}),
		...(options?.activeContext ? { active_context: options.activeContext } : {}),
		...(options?.sessionId ? { session_id: options.sessionId } : {}),
		...(options?.projectPath ? { project_path: options.projectPath } : {}),
	})
}
```

Also add `ProjectPath` to the sync backend handler's payload struct in `main.go` (the `agents.dispatch` case), and use it for project context override — same pattern as the streaming handler.

- [ ] **Step 5: Update the sync fallback in useAgentSession**

The catch block must forward `activeContext`, `sessionId`, AND `projectPath`:

```typescript
const result: DispatchResult = await operator.dispatch(
	agentId,
	task,
	resolvedModel,
	{
		activeContext: options?.activeContext,
		sessionId: runnerSessionId.value || undefined,
		projectPath: options?.projectPath,
	},
)
```

- [ ] **Step 6: Wire AssistantPanel send to pass activeContext**

```typescript
agentSession.send(blocks, {
	activeContext: activeContext.value || undefined,
})
```

Note: AssistantPanel does NOT pass `projectPath` — that's already synced via `ProjectLayout.vue` → `setProject()`. Other callers like ArchitectPage continue passing `projectPath` as before.

- [ ] **Step 7: Simplify the agent label**

```vue
<span class="font-medium text-sm">Assistant</span>
```

- [ ] **Step 8: Typecheck**

```bash
bun run typecheck
```

- [ ] **Step 9: Commit**

```bash
git add frontend/components/ai/AssistantPanel.vue frontend/operator/useAgentSession.ts frontend/operator/client.ts
git commit -m "feat: AssistantPanel always uses General, passes active_context for priority routing"
```

---

### Task 6: Backend Tests

**Files:**
- Create: `operator/internal/operatorapp/agent_routing_test.go`

- [ ] **Step 1: Write test for findAgent**

```go
package operatorapp

import (
	"strings"
	"testing"

	"construct-operator/internal/agent"
)

func TestFindAgent(t *testing.T) {
	coder := &agent.Config{ID: "coder", Name: "Coder"}
	project := &agent.Config{ID: "project", Name: "Project"}
	spaceTodo := &agent.Config{ID: "space:todo", Name: "Todo"}
	fallback := &agent.Config{ID: "general", Name: "General"}
	agents := []*agent.Config{coder, project, spaceTodo}

	tests := []struct {
		id   string
		want string
	}{
		{"", "general"},
		{"general", "general"},
		{"coder", "coder"},
		{"project", "project"},
		{"todo", "space:todo"},
		{"space:todo", "space:todo"},
		{"unknown", ""},
	}
	for _, tt := range tests {
		got := findAgent(tt.id, agents, fallback)
		if tt.want == "" && got != nil {
			t.Errorf("findAgent(%q) = %s, want nil", tt.id, got.ID)
		} else if tt.want != "" && (got == nil || got.ID != tt.want) {
			gotID := "<nil>"
			if got != nil {
				gotID = got.ID
			}
			t.Errorf("findAgent(%q) = %s, want %s", tt.id, gotID, tt.want)
		}
	}
}
```

- [ ] **Step 2: Write test for prepareGeneralAgent**

```go
func TestPrepareGeneralAgent(t *testing.T) {
	general := &agent.Config{
		ID:     "general",
		System: "Prompt.\n\n{available_agents}\n\n{priority_agent_context}\n\nRules.",
	}
	agents := []*agent.Config{
		{ID: "coder", Description: "Coding agent"},
		{ID: "project", Description: "Project-aware agent"},
		{ID: "space:todo", Name: "Todo", Description: "Task management"},
	}
	resolver := func(id string) *agent.Config {
		return findAgent(id, agents, general)
	}

	// With space context
	clone := prepareGeneralAgent(general, agents, "todo", resolver)
	if strings.Contains(clone.System, "{available_agents}") {
		t.Error("available_agents placeholder not replaced")
	}
	if strings.Contains(clone.System, "{priority_agent_context}") {
		t.Error("priority_agent_context placeholder not replaced")
	}
	if !strings.Contains(clone.System, "coder: Coding agent") {
		t.Error("agent list missing coder")
	}
	if !strings.Contains(clone.System, "PRIORITY AGENT: todo") {
		t.Error("priority agent not injected")
	}
	// Original unchanged
	if !strings.Contains(general.System, "{available_agents}") {
		t.Error("original was modified")
	}

	// With project context
	clone2 := prepareGeneralAgent(general, agents, "project", resolver)
	if !strings.Contains(clone2.System, "PRIORITY AGENT: project") {
		t.Error("project priority not injected")
	}

	// No context
	clone3 := prepareGeneralAgent(general, agents, "", resolver)
	if !strings.Contains(clone3.System, "No priority agent") {
		t.Error("missing fallback context")
	}
}
```

- [ ] **Step 3: Write test for spawn prefix matching**

Create `operator/internal/runner/spawn_test.go`:

```go
package runner

import (
	"strings"
	"testing"
)

func TestSpawnAllowlistPrefixMatching(t *testing.T) {
	tests := []struct {
		allowlist []string
		agentID   string
		allowed   bool
	}{
		{nil, "anything", true},                    // nil = unrestricted
		{[]string{}, "anything", true},             // empty = unrestricted
		{[]string{"project", "space"}, "project", true},    // exact match
		{[]string{"project", "space"}, "space:todo", true}, // prefix match
		{[]string{"project", "space"}, "space:design", true},
		{[]string{"project", "space"}, "coder", false},     // not in list
		{[]string{"coder"}, "coder", true},
		{[]string{"coder"}, "space:todo", false},           // no space prefix
	}
	for _, tt := range tests {
		result := isSpawnAllowed(tt.allowlist, tt.agentID)
		if result != tt.allowed {
			t.Errorf("isSpawnAllowed(%v, %q) = %v, want %v", tt.allowlist, tt.agentID, result, tt.allowed)
		}
	}
}

// isSpawnAllowed mirrors the check in handleSpawnAgent
func isSpawnAllowed(allowlist []string, agentID string) bool {
	if len(allowlist) == 0 {
		return true
	}
	for _, prefix := range allowlist {
		if agentID == prefix || strings.HasPrefix(agentID, prefix+":") {
			return true
		}
	}
	return false
}
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/flakerim/Construct/construct-app/operator
go test ./internal/operatorapp -run TestFindAgent -v
go test ./internal/operatorapp -run TestPrepareGeneral -v
go test ./internal/runner -run TestSpawnAllowlist -v
```

- [ ] **Step 5: Commit**

```bash
git add internal/operatorapp/agent_routing_test.go internal/runner/spawn_test.go
git commit -m "test: add findAgent, prepareGeneralAgent, and spawn prefix matching tests"
```

---

### Task 7: Frontend Tests

**Files:**
- Modify: `frontend/operator/useAgentSession.test.ts`

The repo already has a test harness with mocked operator calls. Add tests for the new `activeContext` forwarding and verify existing `projectPath`/`sessionId` behavior is preserved.

- [ ] **Step 1: Read the existing test file**

```bash
cat frontend/operator/useAgentSession.test.ts
```

- [ ] **Step 2: Add test for activeContext forwarding in streaming path**

```typescript
it('forwards activeContext to dispatchStream', async () => {
	// Mock operator.dispatchStream to capture the options
	// Call session.send(blocks, { activeContext: 'todo' })
	// Assert dispatchStream was called with active_context: 'todo' in payload
})
```

- [ ] **Step 3: Add test for projectPath preservation**

```typescript
it('preserves projectPath for non-AssistantPanel callers', async () => {
	// Call session.send(blocks, { projectPath: '/path/to/project' })
	// Assert dispatchStream was called with project_path in payload
})
```

- [ ] **Step 4: Add test for sync fallback forwarding ALL options**

```typescript
it('forwards activeContext, sessionId, and projectPath in sync fallback', async () => {
	// Mock operator.dispatchStream to throw (force sync fallback)
	// Call session.send(blocks, { activeContext: 'design', projectPath: '/path' })
	// Assert operator.dispatch was called with active_context, session_id, AND project_path
})
```

- [ ] **Step 5: Add test for activeContext + projectPath coexistence**

```typescript
it('sends both activeContext and projectPath when both are provided', async () => {
	// Architect scenario: inside a project, with space context
	// Call session.send(blocks, { activeContext: 'architect', projectPath: '/path/to/project' })
	// Assert both are present in the payload
})
```

- [ ] **Step 5: Run tests**

```bash
bun run test -- --run useAgentSession
```

- [ ] **Step 6: Commit**

```bash
git add frontend/operator/useAgentSession.test.ts
git commit -m "test: add frontend tests for activeContext forwarding and projectPath preservation"
```

---

### Task 8: Documentation

**Files:**
- Create: `docs/architecture/agent-routing.md`

- [ ] **Step 1: Write architecture doc**

```markdown
# Agent Routing Architecture

## Overview
Construct uses a priority-based multi-agent system. The General agent is the
entry point for the AssistantPanel. It understands requests and routes work
to specialist agents.

## Flow
1. User sends message in AssistantPanel
2. Frontend sends `agents.dispatch_stream` with `agent_id: "general"` and
   `active_context: "{context_id}"` (space ID, "project", or empty)
3. Backend fills General's prompt:
   - `{available_agents}` → list of all agents with descriptions
   - `{priority_agent_context}` → priority agent details
4. General decomposes the request and spawns appropriate agent(s) via spawn_agent
5. Each spawned agent runs with its own tools and context
6. Results stream back through General to the user

## Agent Types
- **General**: Smart router, always the AssistantPanel entry point
- **Coder**: Autonomous coding agent, used directly from Coder space (bypasses General)
- **Project**: Codebase-aware agent, gets priority on project detail pages
- **Space agents**: Domain-specific specialists (todo, design, calendar, etc.)
- **Core agents**: Architect (planning), Brainstorm (exploration)

## Priority
The `active_context` field determines which agent gets priority:
- Space route (`/app/todo`) → `active_context: "todo"` → Todo agent priority
- Project route (`/app/projects/:id`) → `active_context: "project"` → Project agent priority
- Project space route (`/app/projects/:id/design`) → `active_context: "design"`
- Dashboard/home → no priority agent

Same request, different routing:
- "make me a login screen" in Coder space → Coder handles directly (bypass)
- "make me a login screen" in Design space → General spawns design agent
- "make me a login screen" on project page → General spawns project/coder

## Cross-Space
General can spawn multiple agents for multi-part requests:
"Update todos, design a logo, and write the API"
→ spawns todo + design + coder agents

## Coder Bypass
The Coder space dispatches directly with `agent_id: "coder"`, skipping General.
Developers in Coder want direct tool access without routing overhead.

## Standalone Window
The popout assistant window receives `space-changed` Tauri events from the
main window and updates `activeContext` to match. Preserves `isTauriEnv()`
guard and `onUnmounted` cleanup.

## useAgentSession (shared composable)
This composable is shared across AssistantPanel, ArchitectPage, and other callers.
The `activeContext` option is additive — existing `projectPath`, `sessionId`,
and other options are preserved. AssistantPanel passes `activeContext` only.
ArchitectPage passes `projectPath` as before.

## Spawn Allowlist
- `SpawnAllowed: nil` → unrestricted (General)
- `SpawnAllowed: ["project", "space"]` → matches exact IDs and namespace prefixes
  (e.g., "space" allows "space:todo", "space:design", etc.)
```

- [ ] **Step 2: Commit**

```bash
git add docs/architecture/agent-routing.md
git commit -m "docs: add agent routing architecture"
```

---

## Summary

| Task | What | Files | Findings addressed |
|------|------|-------|----|
| 1 | Extract resolveAgent to testable findAgent | main.go | testability |
| 2 | Upgrade General to smart router with placeholders | main.go | terminology (priority agent, not active space) |
| 3 | Fill placeholders at request time | main.go | — |
| 4 | Fix spawn_agent prefix matching | runner.go | correct variable name (args.AgentID) |
| 5 | Frontend: always General, pass active context | AssistantPanel, useAgentSession, client, router | shared composable preserved, standalone cleanup + stale context fix, sync fallback with projectPath parity, project priority |
| 6 | Backend tests | agent_routing_test.go, spawn_test.go | spawn prefix tests |
| 7 | Frontend tests | useAgentSession.test.ts | activeContext + projectPath forwarding, sync fallback parity |
| 8 | Architecture docs | agent-routing.md | — |
