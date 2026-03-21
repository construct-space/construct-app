# Status Events

The operator emits human-readable `status` events during agent execution so frontends always know what's happening.

## Event Shape

```json
{
  "id": "r1",
  "type": "status",
  "data": {
    "state": "tool_running",
    "message": "Reading package.json",
    "tool": "read_file",
    "call_id": "call-1"
  }
}
```

## States

| State | When | Example message |
|-------|------|-----------------|
| `thinking` | Waiting for LLM response | "Thinking…" |
| `tool_running` | Tool execution started | "Reading package.json" |
| `tool_done` | Tool execution finished | "Writing index.ts" |
| `complete` | Agent run finished | "Done" |

## Data Fields

| Field | Type | Present in | Description |
|-------|------|------------|-------------|
| `state` | string | all | One of the states above |
| `message` | string | all | Human-readable description |
| `tool` | string | tool_running, tool_done | Tool name (e.g. `bash`, `read_file`) |
| `call_id` | string | tool_running, tool_done | Unique tool call ID |
| `turn` | number | thinking | Current turn number |
| `max_turns` | number | thinking | Maximum turns allowed |
| `is_error` | boolean | tool_done | Whether the tool errored |
| `turns` | number | complete | Total turns completed |
| `stop_reason` | string | complete | Why the agent stopped |

## Tool Titles

The operator generates descriptive titles from tool name + input:

| Tool | Title format |
|------|-------------|
| `bash` | "Running: npm install" |
| `read_file` | "Reading package.json" |
| `write_file` | "Writing index.ts" |
| `edit_file` | "Editing App.vue" |
| `list_dir` | "Listing src/components" |
| `glob` | "Searching files: **/*.ts" |
| `grep` | "Searching for: TODO" |
| `spawn_agent` | "Spawning architect agent" |
| (other) | "Running tool name" |

Titles are also added to `tool.call` and `tool.result` events in the `title` field.

## Lifecycle

During a typical agent run, events arrive in this order:

```
session.start     → { session_id, agent_id, model }
turn.start        → { turn: 0, max_turns: 25 }
status            → { state: "thinking", message: "Thinking…" }
text              → { text: "Let me..." }  (streaming tokens)
tool.call         → { tool: "bash", title: "Running: ls src/" }
status            → { state: "tool_running", message: "Running: ls src/" }
tool.result       → { tool: "bash", title: "Running: ls src/", is_error: false }
status            → { state: "tool_done", message: "Running: ls src/" }
turn.end          → { turn: 0, tool_calls: 1 }
turn.start        → { turn: 1, max_turns: 25 }
status            → { state: "thinking", message: "Thinking…" }
text              → { text: "Here's what..." }
status            → { state: "complete", message: "Done" }
done              → { content: "...", agent_id: "..." }
```

## Frontend: useStreamStatus

The `useStreamStatus` composable (`src/operator/useStreamStatus.ts`) provides a shared reactive interface for consuming status events. Any space can use it.

```typescript
import { useStreamStatus } from '@/operator'

const { status, statusMessage, isActive, toolHistory, handleChunk, handleDone, handleError, reset } = useStreamStatus()

// In your stream onChunk:
operator.dispatchStream(agentId, task, (chunk) => {
  handleChunk(chunk)   // updates status reactively
  // ...handle text, etc.
}, () => {
  handleDone()
})
```

### Reactive State

| Property | Type | Description |
|----------|------|-------------|
| `status` | `Ref<StatusInfo>` | Full status object |
| `statusMessage` | `ComputedRef<string>` | Human-readable one-liner |
| `isActive` | `ComputedRef<boolean>` | True when thinking or running tools |
| `toolHistory` | `Ref<ToolActivity[]>` | All tool calls in this session |

### StatusInfo

```typescript
interface StatusInfo {
  state: 'idle' | 'thinking' | 'tool_running' | 'tool_done' | 'complete' | 'error'
  message: string
  tool?: string
  callId?: string
  turn?: number
  maxTurns?: number
  isError?: boolean
}
```

### ToolActivity

```typescript
interface ToolActivity {
  tool: string
  title: string
  callId: string
  state: 'running' | 'done' | 'error'
  timestamp: number
}
```

## Already Wired

- **useAssistant** (chat panel) — exposes `status`, `statusMessage`, `isAgentActive`, `toolHistory`
- **useVibeEngine** / **useArchitectEngine** — can import `useStreamStatus()` and wire it the same way
