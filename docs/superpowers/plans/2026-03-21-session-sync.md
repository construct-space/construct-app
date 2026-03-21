# Session Persistence + Mobile Handoff

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist agent sessions locally, sync to cloud, and enable a mobile companion app to view and continue conversations started on desktop.

**Architecture:** Operator saves Turn[] as JSON files locally on every turn completion. Desktop pushes sessions to Construct API (best-effort background sync). Mobile pulls sessions and can continue them — new turns sync back to cloud, desktop picks up on next open. The Turn/Block JSON schema from `useAgentSession.ts` becomes the shared contract across all clients.

**Tech Stack:** Go (operator persistence), Laravel (sync API), Vue 3 (desktop), Flutter or React Native (mobile), shared JSON schema via `@construct-space/sdk/types`.

---

## What Exists Today

- Operator stores raw LLM session transcripts as JSONL in `~/Library/Application Support/Construct/sessions/`
- `useAgentSession.ts` manages `Turn[]` in memory (reactive Vue refs) — lost on page refresh
- Each `Turn` has: `id`, `request: RequestBlock[]`, `response: ResponseBlock[]`, `agentId`, `status`, `timestamp`
- Operator already emits `session_id` in `VibeSessionEvent` stream events
- No session resume, no session list, no sync

## Session JSON Contract

All clients (desktop, mobile, API) use this format:

```json
{
  "id": "session-abc",
  "agentId": "code-assistant",
  "projectId": "proj-123",
  "projectName": "construct",
  "turns": [
    {
      "id": "turn-1",
      "request": [{ "type": "text", "content": "What's in this project?" }],
      "response": [
        { "type": "text", "content": "Let me check the directory." },
        { "type": "tool", "tool": "bash", "title": "Running ls", "callId": "call-1", "state": "done", "input": "ls src/", "result": "components/ composables/ pages/" },
        { "type": "text", "content": "The project has a standard Vue 3 structure." }
      ],
      "agentId": "code-assistant",
      "status": "done",
      "timestamp": 1711000000,
      "turns": 3
    }
  ],
  "createdAt": "2026-03-21T10:00:00Z",
  "updatedAt": "2026-03-21T10:05:00Z",
  "metadata": {
    "turnCount": 1,
    "lastAgentId": "code-assistant",
    "platform": "desktop"
  }
}
```

---

## Phase 1: Local Session Persistence (Operator)

### What changes

| File | Change |
|------|--------|
| `construct-operator/internal/session/store.go` | New: session store — save/load/list Turn-based JSON |
| `construct-operator/internal/server/handlers.go` | Add: `sessions.save`, `sessions.load`, `sessions.list`, `sessions.delete` request handlers |
| `construct-operator/internal/stream/runner.go` | Modify: emit `session_id` on turn completion, call session store |

### Task 1: Session store in operator

**Files:**
- Create: `construct-operator/internal/session/store.go`

- [ ] **Step 1: Define session store**

```go
// Package session provides local JSON file persistence for agent sessions.
//
// Sessions are saved as {session_id}.json in the sessions directory.
// Each session contains the Turn-based block model matching the frontend schema.
package session

type BlockType string

const (
    BlockText   BlockType = "text"
    BlockTool   BlockType = "tool"
    BlockCode   BlockType = "code"
    BlockSVG    BlockType = "svg"
    BlockImage  BlockType = "image"
    BlockError  BlockType = "error"
    BlockFile   BlockType = "file"
    BlockStatus BlockType = "status"
)

type Block struct {
    Type     BlockType `json:"type"`
    Content  string    `json:"content,omitempty"`
    Tool     string    `json:"tool,omitempty"`
    Title    string    `json:"title,omitempty"`
    CallID   string    `json:"callId,omitempty"`
    Input    string    `json:"input,omitempty"`
    Result   string    `json:"result,omitempty"`
    State    string    `json:"state,omitempty"`
    Language string    `json:"language,omitempty"`
    Src      string    `json:"src,omitempty"`
    Alt      string    `json:"alt,omitempty"`
    Name     string    `json:"name,omitempty"`
    Path     string    `json:"path,omitempty"`
    Size     int64     `json:"size,omitempty"`
    Message  string    `json:"message,omitempty"`
}

type Turn struct {
    ID        string  `json:"id"`
    Request   []Block `json:"request"`
    Response  []Block `json:"response"`
    AgentID   string  `json:"agentId"`
    Status    string  `json:"status"`
    Timestamp int64   `json:"timestamp"`
    Turns     int     `json:"turns,omitempty"`
}

type Session struct {
    ID          string            `json:"id"`
    AgentID     string            `json:"agentId"`
    ProjectID   string            `json:"projectId,omitempty"`
    ProjectName string            `json:"projectName,omitempty"`
    Turns       []Turn            `json:"turns"`
    CreatedAt   string            `json:"createdAt"`
    UpdatedAt   string            `json:"updatedAt"`
    Metadata    map[string]any    `json:"metadata,omitempty"`
}

type SessionMeta struct {
    ID          string `json:"id"`
    AgentID     string `json:"agentId"`
    ProjectID   string `json:"projectId,omitempty"`
    ProjectName string `json:"projectName,omitempty"`
    TurnCount   int    `json:"turnCount"`
    CreatedAt   string `json:"createdAt"`
    UpdatedAt   string `json:"updatedAt"`
    Platform    string `json:"platform,omitempty"`
}
```

- [ ] **Step 2: Implement Save/Load/List/Delete**

```go
type Store struct {
    dir string
}

func NewStore(dataDir string) *Store
func (s *Store) Save(session *Session) error        // writes {id}.json
func (s *Store) Load(id string) (*Session, error)   // reads {id}.json
func (s *Store) List() ([]SessionMeta, error)        // scans dir, returns metadata only
func (s *Store) Delete(id string) error              // removes {id}.json
func (s *Store) FindByAgent(agentID string, projectID string) (*Session, error)  // last session for agent+project
```

- [ ] **Step 3: Commit**

```bash
git add internal/session/
git commit -m "feat(session): add local JSON session store"
```

### Task 2: Session request handlers

**Files:**
- Modify: `construct-operator/internal/server/handlers.go`

- [ ] **Step 1: Add session handlers**

Register handlers for:
- `sessions.save` → accepts Session JSON, writes to store
- `sessions.load` → accepts `{id}`, returns Session JSON
- `sessions.list` → returns `SessionMeta[]` sorted by updatedAt desc
- `sessions.delete` → accepts `{id}`, removes file
- `sessions.resume` → accepts `{agentId, projectId}`, returns last session or null

- [ ] **Step 2: Commit**

```bash
git add internal/server/handlers.go
git commit -m "feat(session): add session CRUD request handlers"
```

### Task 3: Auto-save on turn completion

**Files:**
- Modify: `construct-operator/internal/stream/runner.go`

- [ ] **Step 1: After each turn completes, save session to store**

The runner already has access to the session state. After emitting `turn.end`, serialize the current Turn[] and call `store.Save()`. Generate a stable session_id from `{agentId}-{projectId}-{hash}` or use an existing one if resuming.

- [ ] **Step 2: Commit**

```bash
git add internal/stream/runner.go
git commit -m "feat(session): auto-save session on turn completion"
```

---

## Phase 2: Session Resume in useAgentSession

### What changes

| File | Change |
|------|--------|
| `construct/src/operator/useAgentSession.ts` | Add: `loadSession()`, `listSessions()`, `resumeSession()`, auto-save turns |
| `construct/src/operator/client.ts` | Add: `sessionSave()`, `sessionLoad()`, `sessionList()`, `sessionResume()` methods |
| `construct/src/components/ai/AssistantPanel.vue` | Add: session list dropdown in header, resume last session on mount |

### Task 4: Add session methods to operator client

**Files:**
- Modify: `construct/src/operator/client.ts`

- [ ] **Step 1: Add session API methods**

```ts
async function sessionSave(session: object): Promise<void> {
  await send('sessions.save', { session })
}

async function sessionLoad(id: string): Promise<object> {
  return send('sessions.load', { id })
}

async function sessionList(): Promise<object[]> {
  const result = await send<{ sessions: object[] }>('sessions.list')
  return result.sessions || []
}

async function sessionResume(agentId: string, projectId?: string): Promise<object | null> {
  return send('sessions.resume', { agent_id: agentId, project_id: projectId })
}
```

- [ ] **Step 2: Commit**

```bash
git add src/operator/client.ts
git commit -m "feat(session): add session API methods to operator client"
```

### Task 5: Session persistence in useAgentSession

**Files:**
- Modify: `construct/src/operator/useAgentSession.ts`

- [ ] **Step 1: Add session ID and auto-save**

```ts
const sessionId = ref<string | null>(null)

// Generate stable session ID
function getOrCreateSessionId(): string {
  if (!sessionId.value) {
    sessionId.value = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }
  return sessionId.value
}

// Save after each turn completes
async function saveToDisk() {
  if (!turns.value.length) return
  try {
    await operator.send('sessions.save', {
      session: {
        id: getOrCreateSessionId(),
        agentId: selectedAgent.value,
        projectId: operator.project.value?.name || '',
        turns: turns.value,
        createdAt: new Date(turns.value[0].timestamp).toISOString(),
        updatedAt: new Date().toISOString(),
      },
    })
  } catch { /* best-effort */ }
}
```

Call `saveToDisk()` in the `onDone` callback of `dispatchStream`.

- [ ] **Step 2: Add resume and list**

```ts
async function resumeLastSession(): Promise<boolean> {
  try {
    const session = await operator.send<Session | null>('sessions.resume', {
      agent_id: selectedAgent.value,
      project_id: operator.project.value?.name || '',
    })
    if (session?.turns?.length) {
      sessionId.value = session.id
      turns.value = session.turns
      return true
    }
  } catch { /* no session to resume */ }
  return false
}

async function listSessions(): Promise<SessionMeta[]> {
  try {
    const result = await operator.send<{ sessions: SessionMeta[] }>('sessions.list')
    return result.sessions || []
  } catch { return [] }
}

async function loadSession(id: string): Promise<boolean> {
  try {
    const session = await operator.send<Session>('sessions.load', { id })
    if (session?.turns) {
      sessionId.value = session.id
      selectedAgent.value = session.agentId
      turns.value = session.turns
      return true
    }
  } catch { /* failed */ }
  return false
}
```

- [ ] **Step 3: Commit**

```bash
git add src/operator/useAgentSession.ts
git commit -m "feat(session): add session persistence, resume, and listing"
```

### Task 6: Session UI in AssistantPanel

**Files:**
- Modify: `construct/src/components/ai/AssistantPanel.vue`

- [ ] **Step 1: Auto-resume on mount + session list in header**

On mount, after connecting to operator, call `resumeLastSession()`. Add a small dropdown in the header showing recent sessions (from `listSessions()`), clickable to load.

- [ ] **Step 2: Commit**

```bash
git add src/components/ai/AssistantPanel.vue
git commit -m "feat(session): auto-resume and session list in AssistantPanel"
```

---

## Phase 3: Cloud Sync API

### What changes

| File | Change |
|------|--------|
| `construct-api/routes/api.php` | Add: `/api/sessions` routes |
| `construct-api/app/Http/Controllers/SessionController.php` | New: CRUD + sync endpoint |
| `construct-api/app/Models/AgentSession.php` | New: Eloquent model |
| `construct-api/database/migrations/xxx_create_agent_sessions.php` | New: migration |

### Task 7: Laravel API for session sync

- [ ] **Step 1: Create migration**

```php
Schema::create('agent_sessions', function (Blueprint $table) {
    $table->uuid('id')->primary();
    $table->foreignId('user_id')->constrained()->cascadeOnDelete();
    $table->string('agent_id');
    $table->string('project_id')->nullable();
    $table->string('project_name')->nullable();
    $table->json('turns');
    $table->json('metadata')->nullable();
    $table->string('platform')->default('desktop');
    $table->timestamps();

    $table->index(['user_id', 'agent_id', 'updated_at']);
});
```

- [ ] **Step 2: Create model, controller, routes**

Endpoints:
- `GET /api/sessions` — list user's sessions (paginated, newest first)
- `GET /api/sessions/{id}` — get full session
- `PUT /api/sessions/{id}` — upsert session (create or update)
- `DELETE /api/sessions/{id}` — delete session

- [ ] **Step 3: Commit**

### Task 8: Desktop sync push

**Files:**
- Modify: `construct/src/operator/useAgentSession.ts`

- [ ] **Step 1: After `saveToDisk()`, push to cloud**

```ts
async function syncToCloud() {
  if (!authStore.isAuthenticated) return
  try {
    await api.put(`/api/sessions/${getOrCreateSessionId()}`, {
      id: getOrCreateSessionId(),
      agentId: selectedAgent.value,
      projectId: operator.project.value?.name || '',
      turns: turns.value,
      platform: 'desktop',
    })
  } catch { /* best-effort, don't block */ }
}
```

Call `syncToCloud()` after `saveToDisk()`, debounced (e.g., 5 second delay after last turn).

- [ ] **Step 2: Commit**

---

## Phase 4: Mobile Companion App

### Architecture

```
Mobile App
  ├── Auth (OAuth via construct-accounts)
  ├── Session List (GET /api/sessions)
  ├── Session View (AgentView equivalent — renders Turn[])
  ├── Continue Session (POST new turn → PUT /api/sessions/{id})
  └── Push Notifications ("Agent finished on desktop")
```

### What to build

| Component | Description |
|-----------|-------------|
| Session list screen | Pull-to-refresh, shows recent sessions grouped by project |
| Session detail screen | Renders Turn[] with same block model — text, tool cards, images |
| Continue session | Text input at bottom, sends to cloud API, desktop picks up |
| Notifications | Firebase/APNs — triggered when desktop agent completes a task |

### Shared types

Export from `@construct-space/sdk/types`:
```ts
export type { Turn, RequestBlock, ResponseBlock, TextBlock, ToolBlock, ... }
export interface Session { id, agentId, projectId, turns: Turn[], ... }
export interface SessionMeta { id, agentId, turnCount, updatedAt, ... }
```

Mobile client (Flutter/RN) uses the same JSON schema — parse with codegen from the TypeScript types.

---

## Priority Order

| Phase | What | Unblocks |
|-------|------|----------|
| **1** | Session persistence in operator (save/load locally) | Everything |
| **2** | Session list + resume in useAgentSession | Better desktop UX |
| **3** | Sync API on Construct backend | Mobile |
| **4** | Mobile companion app | Full handoff |

## Dependencies

- Phase 1 requires changes to `construct-operator` (Go)
- Phase 2 requires Phase 1 + changes to `construct` (Vue)
- Phase 3 requires changes to `construct-api` (Laravel)
- Phase 4 requires Phase 3 + new mobile repo
- Session JSON schema is the shared contract — defined in Phase 1, used everywhere
