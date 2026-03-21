# Agent Loop

The runner is the core of Operator. It implements the agentic loop pattern.

## Flow

```
Task received
    │
    ▼
Resolve provider for model
    │
    ▼
Create session (UUID)
    │
    ▼
Build messages: [user: task]
    │
    ▼
┌──────────────────────────┐
│ Call LLM with:           │
│  - system prompt         │
│  - messages              │
│  - available tools       │◄────────────────┐
└──────────┬───────────────┘                 │
           │                                  │
     ┌─────▼─────┐                           │
     │ tool_calls │── No ──► Return content   │
     │ in resp?   │                           │
     └─────┬─────┘                           │
           │ Yes                              │
           ▼                                  │
  ┌────────────────┐                         │
  │ For each call: │                         │
  │  1. Pre-hook   │                         │
  │  2. Execute    │                         │
  │  3. Post-hook  │                         │
  │  4. Append     │                         │
  └────────┬───────┘                         │
           │                                  │
     ┌─────▼──────┐                          │
     │ max turns? │── No ────────────────────┘
     └─────┬──────┘
           │ Yes
           ▼
    Return partial result
    (stop_reason: "max_turns")
```

## Stop Reasons

| Reason | Meaning |
|--------|---------|
| `end_turn` | LLM finished naturally |
| `tool_use` | LLM wants to use tools (loop continues) |
| `max_turns` | Hit iteration limit (default 25) |
| `max_tokens` | LLM ran out of output tokens |

## Agent Config

```go
type Config struct {
    ID          string    // "general", "architect", "space:design"
    Name        string    // Display name
    Description string    // What it does
    Category    string    // primary, specialist, space
    System      string    // System prompt
    Model       string    // Preferred model (e.g. "claude-sonnet-4-6")
    Tools       []string  // Allowed tools (empty = all)
    BlockTools  []string  // Denied tools
    MaxTurns    int       // Max iterations (0 = 25)
    CanSpawn    bool      // Can create sub-agents
    Temperature *float64  // Override temperature
}
```

## Built-in Agents

| ID | Name | Category | Model | MaxTurns |
|----|------|----------|-------|----------|
| `general` | General | primary | claude-sonnet-4-6 | 25 |
| `architect` | Architect | specialist | claude-sonnet-4-6 | 10 |

Space agents are loaded dynamically from `~/Library/Application Support/Construct/spaces/`.

## Session Tracking

Every `Run()` call creates a session with:
- UUID identifier
- Agent ID
- State: running -> completed/failed
- Turn counter
- Timestamps
- Error (if failed)

## Streaming

Pass a `stream.Emitter` in `RunRequest` to get real-time events:

| Event | When |
|-------|------|
| `session.start` | Loop begins |
| `turn.start` | Before each LLM call |
| `status` | Human-readable progress (thinking, tool running/done, complete) |
| `text` | LLM generates text (streaming tokens) |
| `tool.call` | Tool execution starting (includes `title`) |
| `tool.result` | Tool execution complete (includes `title`) |
| `token.usage` | Token counts after LLM response |
| `turn.end` | After turn completes |

See [status-events.md](./status-events.md) for the full status event protocol.

## Model Resolution

1. Use `RunRequest.Model` if provided
2. Fall back to `Agent.Model`
3. Fall back to `Runner.defaultModel` ("claude-sonnet-4-6")
4. Search all providers for one that supports the model
5. Error if no provider found (no cross-family fallback — claude models never route to OpenAI)
