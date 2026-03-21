# AG-UI Protocol Research

> Research date: 2026-03-13
> Source: https://github.com/ag-ui-protocol/ag-ui
> Relevance: Operator (backend) <-> Construct (Tauri desktop app) communication protocol

## 1. What AG-UI Is

AG-UI (Agent-User Interaction Protocol) is an open, lightweight, event-based protocol that standardizes how AI agents connect to user-facing applications. It sits alongside two other protocols in the "agentic stack":

- **MCP** - provides tools to agents (tool discovery and execution)
- **A2A** - enables agent-to-agent communication
- **AG-UI** - brings agents into user-facing applications (agent-to-UI)

The protocol is transport-agnostic and framework-agnostic. It defines a set of typed events that flow from agent backends to frontends, with support for bidirectional state synchronization. First-party SDKs exist for TypeScript and Python, with community SDKs for Rust, Go, Kotlin, Java, Dart, and Ruby.

### Key Design Principles

- Event-driven streaming architecture (not request/response)
- Start-Content-End pattern for streaming text and tool calls
- Snapshot-Delta pattern for state synchronization (RFC 6902 JSON Patch)
- Transport agnostic: HTTP SSE, binary protocol, WebSockets, webhooks
- Framework agnostic: integrations for LangGraph, CrewAI, Pydantic AI, Mastra, and many more

## 2. Core Event Types (33 Types)

All events share a `BaseEvent` structure:

```
BaseEvent {
  type: EventType       // discriminator
  timestamp?: number    // optional creation time
  rawEvent?: any        // optional original event if transformed
}
```

### Lifecycle Events (5)

| Event | Key Fields | Purpose |
|-------|-----------|---------|
| `RUN_STARTED` | threadId, runId, parentRunId?, input? | Marks beginning of agent execution |
| `RUN_FINISHED` | threadId, runId, result? | Marks successful completion |
| `RUN_ERROR` | message, code? | Marks failure |
| `STEP_STARTED` | stepName | Granular progress within a run |
| `STEP_FINISHED` | stepName | Step completion |

`RUN_STARTED` and either `RUN_FINISHED` or `RUN_ERROR` are **mandatory** -- they form the boundaries of every agent run.

### Text Message Events (4)

Follow the **Start-Content-End** streaming pattern:

| Event | Key Fields | Purpose |
|-------|-----------|---------|
| `TEXT_MESSAGE_START` | messageId, role | Opens a new message stream |
| `TEXT_MESSAGE_CONTENT` | messageId, delta | Delivers a text chunk |
| `TEXT_MESSAGE_END` | messageId | Closes the message stream |
| `TEXT_MESSAGE_CHUNK` | messageId?, role?, delta?, name? | Convenience: auto-expands to Start/Content/End |

Roles: `assistant`, `user`, `system`, `developer`, `tool`

### Tool Call Events (5)

Also follow **Start-Content-End**:

| Event | Key Fields | Purpose |
|-------|-----------|---------|
| `TOOL_CALL_START` | toolCallId, toolCallName, parentMessageId? | Begins a tool invocation |
| `TOOL_CALL_ARGS` | toolCallId, delta | Streams argument fragments (JSON chunks) |
| `TOOL_CALL_END` | toolCallId | Arguments complete |
| `TOOL_CALL_RESULT` | messageId, toolCallId, content, role? | Tool execution output |
| `TOOL_CALL_CHUNK` | (convenience) | Auto-manages tool call lifecycle |

### State Management Events (3)

Follow the **Snapshot-Delta** pattern:

| Event | Key Fields | Purpose |
|-------|-----------|---------|
| `STATE_SNAPSHOT` | snapshot | Complete state replacement |
| `STATE_DELTA` | delta (JSON Patch ops) | Incremental state update (RFC 6902) |
| `MESSAGES_SNAPSHOT` | messages[] | Complete conversation history |

### Activity Events (2)

| Event | Key Fields | Purpose |
|-------|-----------|---------|
| `ACTIVITY_SNAPSHOT` | messageId, activityType, content, replace? | Full activity state |
| `ACTIVITY_DELTA` | messageId, activityType, patch | Incremental activity update |

### Reasoning Events (6)

For LLM chain-of-thought visibility:

| Event | Key Fields | Purpose |
|-------|-----------|---------|
| `REASONING_START` | messageId | Begin reasoning block |
| `REASONING_END` | messageId | End reasoning block |
| `REASONING_MESSAGE_START` | messageId, role | Begin reasoning message |
| `REASONING_MESSAGE_CONTENT` | messageId, delta | Reasoning text chunk |
| `REASONING_MESSAGE_END` | messageId | End reasoning message |
| `REASONING_MESSAGE_CHUNK` | (convenience) | Auto-expands |
| `REASONING_ENCRYPTED_VALUE` | subtype, entityId, encryptedValue | Encrypted CoT |

### Special Events (2)

| Event | Key Fields | Purpose |
|-------|-----------|---------|
| `RAW` | event, source? | Wraps external system events |
| `CUSTOM` | name, value | Application-specific extensions |

## 3. Streaming Architecture

### Wire Format

The default transport is **HTTP POST with Server-Sent Events (SSE) response**:

1. Client sends `POST` to agent URL with `RunAgentInput` as JSON body
2. Request headers include `Accept: text/event-stream` (or protobuf media type)
3. Server responds with `Content-Type: text/event-stream`
4. Each event is sent as: `data: {JSON}\n\n`

SSE encoding (from the Python SDK):
```python
f"data: {event.model_dump_json(by_alias=True, exclude_none=True)}\n\n"
```

SSE encoding (from the TypeScript SDK):
```typescript
`data: ${JSON.stringify(event)}\n\n`
```

### Binary Protocol

An alternative binary transport uses Protocol Buffers with length-prefixed framing:
- Media type: `application/vnd.ag-ui.event+proto`
- Each message is prefixed with a 4-byte big-endian length header
- Content negotiation via `Accept` header

### Content Negotiation

The `EventEncoder` class checks the client's `Accept` header:
- If it includes the protobuf media type -> binary encoding
- Otherwise -> SSE text encoding (`text/event-stream`)

### Client-Side Processing (TypeScript)

The client uses RxJS Observables for reactive event consumption:

```
HttpAgent.run(input)
  -> runHttpRequest(url, requestInit)     // fetch() with streaming
  -> transformHttpEventStream()           // parse SSE to BaseEvent
  -> middleware pipeline                  // transform/filter events
  -> subscriber callbacks                 // apply to UI state
```

The `runHttpRequest` function:
1. Calls `fetch()` with the POST request
2. Gets a `ReadableStream` reader from the response body
3. Loops calling `reader.read()` to get chunks
4. Emits each chunk as an `HttpDataEvent` via RxJS Observable
5. Cleanup cancels the reader on unsubscribe

### Client-Side Processing (Rust)

The Rust client follows the same pattern:
1. `HttpAgent` sends POST via `reqwest`
2. Response is converted to an SSE stream via `SseResponseExt` trait
3. SSE parser buffers bytes, splits on `\n\n`, extracts `data:` lines
4. Each event is deserialized from JSON into typed `Event<StateT>` enum
5. Returns a boxed async `Stream` of events

### Abort/Cancel

The TypeScript client uses `AbortController` to cancel in-flight requests. The `abortRun()` method on `HttpAgent` triggers the abort signal, which cancels the fetch and closes the stream.

## 4. Transport Layer Details

AG-UI is explicitly **transport-agnostic**. The protocol defines the event schema; the transport is pluggable.

### Supported Transports

| Transport | Status | Notes |
|-----------|--------|-------|
| HTTP SSE | Reference implementation | POST request, SSE response stream |
| HTTP Binary (Protobuf) | Supported | Length-prefixed protobuf frames |
| WebSockets | Declared supported | Not in reference impl yet |
| Webhooks | Declared supported | For async/batch scenarios |

### The Core Abstraction

```typescript
run(input: RunAgentInput): Observable<BaseEvent>
```

Any transport that can return a stream of `BaseEvent` objects satisfies the protocol. The `AbstractAgent` class in the TypeScript SDK defines this as an abstract method -- `HttpAgent` implements it via HTTP/SSE, but you could implement `WebSocketAgent`, `IPCAgent`, etc.

### RunAgentInput (Request Payload)

```typescript
RunAgentInput {
  threadId: string          // conversation thread ID
  runId: string             // unique execution ID
  state?: State             // current application state
  messages?: Message[]      // conversation history
  tools?: Tool[]            // available tools (JSON Schema params)
  context?: Context[]       // description-value pairs
  forwardedProps?: any      // passthrough properties
}
```

## 5. State Synchronization

### The Model

AG-UI uses a **shared state object** that persists across interactions. Both agent and frontend can read and write to it. The state type is unconstrained (`State = any`).

### Two Mechanisms

**Snapshots** (`STATE_SNAPSHOT`):
- Deliver the complete state
- Frontend replaces its entire local state
- Used at initialization, after reconnection, or after major changes
- Recommended to use sparingly (bandwidth cost)

**Deltas** (`STATE_DELTA`):
- Deliver incremental updates as RFC 6902 JSON Patch operations
- Six operations: `add`, `replace`, `remove`, `move`, `copy`, `test`
- Uses JSON Pointers (RFC 6901) for targeting: `/ingredients/0/amount`
- Applied atomically (all-or-none) via `fast-json-patch` library
- Preferred for frequent, small updates

### Bidirectional Flow

```
Frontend State  -->  RunAgentInput.state  -->  Agent reads state
Agent processes -->  STATE_DELTA events   -->  Frontend applies patches
User edits UI   -->  Next RunAgentInput   -->  Agent sees changes
```

This enables human-in-the-loop patterns where users can modify state (e.g., editing a document while the agent streams changes) and the agent sees those modifications on the next run.

### Message Synchronization

`MESSAGES_SNAPSHOT` provides the complete conversation history. The subscriber system on the client side tracks message additions and can notify UI components of new messages, tool calls, and state changes.

## 6. Integration Patterns

### Server Side (Python/FastAPI)

The standard pattern for building an AG-UI server:

```python
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from ag_ui.core import RunAgentInput, EventType, ...
from ag_ui.encoder import EventEncoder

app = FastAPI()

@app.post("/agent")
async def agent_endpoint(input: RunAgentInput, request: Request):
    encoder = EventEncoder(accept=request.headers.get("accept"))

    async def event_stream():
        # 1. Emit RUN_STARTED (mandatory)
        yield encoder.encode(RunStartedEvent(
            type=EventType.RUN_STARTED,
            thread_id=input.thread_id,
            run_id=input.run_id
        ))

        # 2. Stream text, tool calls, state updates...
        yield encoder.encode(TextMessageStartEvent(...))
        yield encoder.encode(TextMessageContentEvent(delta="Hello"))
        yield encoder.encode(TextMessageEndEvent(...))

        # 3. Emit RUN_FINISHED (mandatory)
        yield encoder.encode(RunFinishedEvent(
            type=EventType.RUN_FINISHED,
            thread_id=input.thread_id,
            run_id=input.run_id
        ))

    return StreamingResponse(
        event_stream(),
        media_type=encoder.get_content_type()
    )
```

### Client Side (TypeScript)

```typescript
import { HttpAgent } from "@ag-ui/client";

const agent = new HttpAgent({
  url: "http://localhost:8000/agent",
  agentId: "my-agent",
  threadId: "thread-1",
});

// Add middleware
agent.use(new FilterToolCallsMiddleware({ allow: ["search", "calculate"] }));

// Subscribe to events
agent.subscribe({
  onTextMessageContent: (event, params) => {
    // Update UI with streaming text
  },
  onToolCallStart: (event, params) => {
    // Show tool execution in UI
  },
  onStateChanged: (messages, state) => {
    // React to state changes
  },
});

// Run the agent
const result = await agent.runAgent({
  runId: "run-1",
  tools: [...],
  context: [...],
});
```

### Middleware Pattern

Middleware intercepts and transforms the event stream without modifying agent logic:

```
agent.use(loggingMiddleware)      // logs all events
agent.use(filterMiddleware)       // filters tool calls
agent.use(authMiddleware)         // adds auth headers

// Execution: logging -> filter -> auth -> agent.run() -> events flow back
```

Middleware is composed via `reduceRight()` forming a chain. Each middleware can transform input, transform output events, or both.

### Agent Capabilities Declaration

Agents can declare their capabilities via `AgentCapabilities`:

```typescript
AgentCapabilities {
  identity?: { name, description }
  transport?: { streaming, websocket, binary, webhooks, resumable }
  tools?: { functionCalling, agentProvidedTools, parallel, clientProvided }
  output?: { structuredJson, mimeTypes }
  state?: { snapshots, deltas, persistence, longTermMemory }
  multiAgent?: { delegation, handoffs, subAgents[] }
  reasoning?: { thinking, streaming, encrypted }
  multimodalInput?: { image, audio, video, pdf, file }
  multimodalOutput?: { image, audio }
  execution?: { codeExecution, sandboxed, iterations, timeout }
  humanInTheLoop?: { approvalGates, interventions, feedback }
  custom?: Record<string, any>
}
```

## 7. Relevance to Construct/Operator Architecture

### What AG-UI Solves Over Raw TCP/JSON

| Problem with Raw TCP | AG-UI Solution |
|----------------------|----------------|
| Custom TCP framing, fragile parsing | Standard SSE or Protobuf over HTTP |
| No streaming pattern, full messages only | Start-Content-End pattern for incremental delivery |
| Manual state sync, race conditions | Snapshot-Delta with JSON Patch (RFC 6902) |
| No standard event types | 33 typed events covering all agent interactions |
| No middleware/interceptor layer | Composable middleware pipeline |
| No abort/cancel mechanism | AbortController / signal-based cancellation |
| Tight coupling to specific agent impl | Framework-agnostic, any backend works |
| No capability negotiation | AgentCapabilities declaration |

### Recommended Adoption Path for Operator

**Option A: Full AG-UI adoption**
- Operator becomes an AG-UI server (FastAPI + EventEncoder)
- Construct (Tauri) uses the Rust `ag-ui-client` crate to consume SSE events
- State sync via JSON Patch replaces custom state messages
- Middleware handles auth, logging, rate limiting

**Option B: AG-UI-inspired custom protocol**
- Adopt the event type taxonomy (33 event types)
- Adopt Start-Content-End and Snapshot-Delta patterns
- Use SSE over HTTP as transport (simpler than raw TCP)
- Skip the full SDK dependency, implement the patterns directly

**Option C: Hybrid with Tauri IPC**
- Operator exposes AG-UI HTTP/SSE endpoints
- Tauri backend (Rust) consumes SSE and translates to Tauri IPC events
- Frontend (Nuxt) receives events via Tauri's `listen()` / `emit()` bridge
- This keeps the Tauri security model while getting AG-UI's event taxonomy

### Key Observations for Our Use Case

1. **Rust SDK exists** (community, at `sdks/community/rust/`) -- uses `reqwest` + async streams, good fit for Tauri's Rust backend.

2. **The core abstraction is simple**: `run(input) -> Stream<Event>`. This maps cleanly to a Tauri command that returns a stream of events.

3. **State sync via JSON Patch** is much more robust than raw TCP. RFC 6902 is a well-tested standard with libraries in every language.

4. **SSE over HTTP** is a much better transport than raw TCP for our case -- built-in framing, reconnection semantics, works through proxies, and the browser/Tauri WebView can consume it natively.

5. **The `CUSTOM` event type** gives us an escape hatch for Construct-specific events without breaking protocol compatibility.

6. **Tool calls are first-class** -- the Start/Args/End pattern for tool invocations maps directly to how we'd want to show AI tool usage in the Construct UI.

7. **Human-in-the-loop** is built into the protocol with approval gates and intervention points -- critical for our use case where users need to approve certain agent actions.

### Protocol Wire Example

A complete agent interaction on the wire looks like:

```
POST /agent HTTP/1.1
Content-Type: application/json
Accept: text/event-stream

{"threadId":"t1","runId":"r1","messages":[{"role":"user","content":"Hello"}],"state":{},"tools":[]}

---

HTTP/1.1 200 OK
Content-Type: text/event-stream

data: {"type":"RUN_STARTED","threadId":"t1","runId":"r1"}

data: {"type":"TEXT_MESSAGE_START","messageId":"m1","role":"assistant"}

data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"m1","delta":"Hello! "}

data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"m1","delta":"How can I help?"}

data: {"type":"TEXT_MESSAGE_END","messageId":"m1"}

data: {"type":"RUN_FINISHED","threadId":"t1","runId":"r1"}
```

## 8. Source Code References

| Component | Path in Repo |
|-----------|-------------|
| TypeScript events/types | `sdks/typescript/packages/core/src/events.ts`, `types.ts` |
| TypeScript HTTP client | `sdks/typescript/packages/client/src/agent/http.ts` |
| TypeScript subscriber | `sdks/typescript/packages/client/src/agent/subscriber.ts` |
| TypeScript encoder | `sdks/typescript/packages/encoder/src/encoder.ts` |
| TypeScript protobuf | `sdks/typescript/packages/proto/src/proto.ts` |
| Python events/types | `sdks/python/ag_ui/core/events.py`, `types.py` |
| Python encoder | `sdks/python/ag_ui/encoder/encoder.py` |
| Rust events | `sdks/community/rust/crates/ag-ui-core/src/event.rs` |
| Rust HTTP client | `sdks/community/rust/crates/ag-ui-client/src/http.rs` |
| Rust SSE parser | `sdks/community/rust/crates/ag-ui-client/src/sse.rs` |
| Python server example | `integrations/server-starter-all-features/python/examples/` |
| Capabilities schema | `sdks/typescript/packages/core/src/capabilities.ts` |
