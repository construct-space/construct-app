# OpenCode Research: Architecture & Patterns for LLM-Agnostic Agent Backend

> **Repository:** [sst/opencode](https://github.com/sst/opencode) (122k+ stars, 815+ contributors)
> **Language:** TypeScript (monorepo, Bun runtime, Turbo build)
> **License:** MIT
> **Researched:** 2026-03-13

---

## 1. Architecture Overview

OpenCode is an open-source AI coding agent with a **client-server architecture** following a **hub-and-spoke model**.

### Core Design

```
┌─────────────────────────────────────────────────────────┐
│                      Clients (Spokes)                   │
│  ┌─────────┐  ┌─────────┐  ┌──────────┐  ┌──────────┐  │
│  │   TUI   │  │ Desktop │  │   Web    │  │  VS Code │  │
│  │(Solid.js│  │ (Tauri) │  │          │  │Extension │  │
│  │+opentui)│  │         │  │          │  │          │  │
│  └────┬────┘  └────┬────┘  └────┬─────┘  └────┬─────┘  │
│       │            │            │              │        │
│       └────────────┴─────┬──────┴──────────────┘        │
│                          │ HTTP/SSE                     │
│                   ┌──────┴──────┐                       │
│                   │ Server.App  │ (Hub)                  │
│                   │   (Hono)    │                        │
│                   └──────┬──────┘                        │
│         ┌────────────────┼────────────────┐             │
│   ┌─────┴─────┐  ┌──────┴──────┐  ┌──────┴──────┐      │
│   │  Session   │  │  Provider   │  │    Tool     │      │
│   │  Manager   │  │  Abstraction│  │   Registry  │      │
│   │            │  │   Layer     │  │             │      │
│   └─────┬─────┘  └──────┬──────┘  └──────┬──────┘      │
│         │               │                │              │
│   ┌─────┴─────┐  ┌──────┴──────┐  ┌──────┴──────┐      │
│   │  SQLite   │  │  AI SDK     │  │  MCP/LSP/   │      │
│   │(Drizzle)  │  │  (Vercel)   │  │  Plugins    │      │
│   └───────────┘  └─────────────┘  └─────────────┘      │
└─────────────────────────────────────────────────────────┘
```

### Key Architectural Decisions

- **Client-server split**: `opencode serve` runs an HTTP server (Hono); all clients (TUI, desktop, web) are thin consumers over HTTP + SSE
- **Provider-agnostic core**: The agent loop never touches provider-specific APIs directly; everything goes through the `Provider` abstraction built on Vercel's AI SDK
- **Event-driven streaming**: All real-time updates flow via Server-Sent Events (SSE), no polling
- **SQLite persistence**: All session/message/part state stored in `sessions.db` via Drizzle ORM
- **Monorepo with 20+ packages**: Core backend (`packages/opencode`), SDK, plugin system, desktop (Tauri), web (Astro), console, integrations

### Directory Structure (Key Paths)

```
packages/
├── opencode/              # Core CLI + server
│   └── src/
│       ├── api/           # Hono HTTP routes + SSE (server.ts)
│       ├── session/       # Session CRUD, prompt orchestration (prompt.ts)
│       ├── provider/      # Provider abstraction + transforms (provider.ts)
│       ├── tool/          # Tool registry, definitions, execution (tool.ts)
│       ├── config/        # 8-layer config system (config.ts)
│       └── auth/          # Auth management (auth.json)
├── sdk/js/                # @opencode-ai/sdk (generated client)
├── plugin/                # @opencode-ai/plugin (hook system)
├── app/                   # @opencode-ai/app (shared UI logic, Solid.js)
├── ui/                    # @opencode-ai/ui (component library)
├── desktop/               # @opencode-ai/desktop (Tauri native app)
├── web/                   # Documentation site (Astro)
└── function/              # Cloud functions (GitHub App)
```

---

## 2. Agent Loop Pattern

The agent loop is implemented in `SessionPrompt.loop()` (at `packages/opencode/src/session/prompt.ts`). It follows a **9-stage pipeline** with a recursive tool-call cycle.

### Complete Flow

```
User Input (API POST /v2/session/{id}/prompt)
  │
  ▼
SessionPrompt.prompt()
  ├── Generate message/part IDs (descending ULIDs)
  ├── Persist UserMessage to sessions.db
  ├── Publish MessageV2.Event.PartUpdated
  │
  ▼
SessionPrompt.loop()                    ◄── MAIN ORCHESTRATION
  │
  ├── 1. Busy State Check
  │      state().start(sessionID)       // prevents concurrent processing
  │
  ├── 2. Message Analysis
  │      Scan history for: last user msg, last assistant msg,
  │      pending tasks (compaction, subtasks)
  │
  ├── 3. Tool Resolution
  │      ToolRegistry.tools()           // built-in tools
  │      + MCP.tools()                  // MCP server tools
  │      + plugin tools                 // plugin-contributed tools
  │      → ProviderTransform.schema()   // adapt schemas per provider
  │      → PermissionNext.merge()       // filter by agent permissions
  │
  ├── 4. System Prompt Assembly
  │      Agent prompt + provider instructions + user overrides
  │      → plugin "chat.system.transform" hook
  │      → collapse to 2 parts for cache optimization
  │
  ├── 5. Message Transformation
  │      MessageV2.toModelMessage()     // internal → AI SDK format
  │      → ProviderTransform.message()  // provider-specific normalization
  │      → Apply cache control markers
  │
  ├── 6. LLM Streaming
  │      Provider.getLanguage(model)    // get LanguageModel instance
  │      → merge options (base → model → agent → variant)
  │      → plugin "chat.params" hook
  │      → extractReasoningMiddleware
  │      → streamText()                 // Vercel AI SDK call
  │
  ├── 7. Response Processing (SessionProcessor.process())
  │      Iterate stream chunks:
  │        text-delta      → append to TextPart
  │        reasoning-delta → append to ReasoningPart
  │        tool-call-delta → update ToolPart args
  │        tool-call       → execute tool (see below)
  │        step-finish     → record tokens/cost
  │        finish          → set finish reason
  │        error           → store error
  │
  ├── 8. Tool Execution (within stream processing)
  │      ToolPart state: pending → running → completed/error
  │      → tool.execute.before plugin hook
  │      → tool.execute(args, context)
  │      → tool.execute.after plugin hook
  │      → persist result to DB
  │      → publish SSE event
  │
  └── 9. Loop Decision
         finish === "tool-calls"  → CONTINUE (loop again)
         finish === "stop"        → STOP
         finish === "length"      → STOP (token limit)
         finish === "error"       → STOP
         context overflow         → COMPACT (summarize, then continue)
         finish === "unknown"     → CONTINUE (safety default)
```

### Key Loop Behaviors

- **Step limits**: `agent.steps` config enforces max iterations; `MAX_STEPS` injected into system prompt
- **Context compaction**: When `SessionCompaction.isOverflow()` returns true, conversation history is summarized before continuing (prevents context window exhaustion)
- **Abort propagation**: `AbortController` signal flows through all async ops; `cancel(sessionID)` terminates LLM streams and tool executions
- **Error retry**: `APICallError` triggers up to 3 retries with exponential backoff (`delay = 1000 * 2^attempt`)
- **Structured output**: For JSON schema output, injects a `StructuredOutput` tool with `toolChoice: "required"`, validates the model called it
- **Task queue**: Pending subtasks and compaction processed in LIFO order between loop iterations

### Agent Types (Two-Tier System)

**Primary Agents** (user-facing, Tab-key cycling):
| Agent | Purpose | Tool Access |
|-------|---------|-------------|
| **Build** | Default development agent | Full access to all tools |
| **Plan** | Read-only analysis/planning | File edits, patches, bash set to `ask` permission |

**Subagents** (invoked by primary agents or via `@mention`):
| Agent | Purpose | Access |
|-------|---------|--------|
| **General** | Multi-step research, parallel work | Full access |
| **Explore** | Fast codebase navigation | Read-only |

Agents are configurable via JSON (`opencode.json`) or Markdown files (`~/.config/opencode/agents/` or `.opencode/agents/`).

---

## 3. LLM Provider Abstraction (LLM-Agnostic Patterns)

This is the most architecturally valuable part for building an LLM-agnostic backend. OpenCode supports 75+ providers through a layered abstraction.

### Architecture Layers

```
┌─────────────────────────────────────────────┐
│            Agent Loop (SessionPrompt)        │
│  Calls: Provider.getModel(modelID)           │
│  Uses:  streamText(model, messages, tools)   │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────┴──────────────────────────┐
│         Provider Abstraction Layer           │
│                                              │
│  Provider.list()     → load from Config      │
│  Provider.getModel() → resolve LanguageModel │
│  Provider.defaultModel() → fallback chain:   │
│    1. Input param                            │
│    2. Agent config                           │
│    3. Priority array: [gemini-2.5-pro,       │
│       gpt-5, claude-sonnet-4]                │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────┴──────────────────────────┐
│       ProviderTransform Layer                │
│                                              │
│  .message()  → normalize message formats     │
│  .options()  → provider-specific params      │
│  .schema()   → adapt tool JSON schemas       │
│  .variants() → reasoning effort levels       │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────┴──────────────────────────┐
│          Vercel AI SDK                       │
│  @ai-sdk/anthropic, @ai-sdk/openai,         │
│  @ai-sdk/google, @ai-sdk/amazon-bedrock,    │
│  @ai-sdk/azure, etc.                        │
│                                              │
│  Unified interface: LanguageModel            │
│  Unified call:      streamText()             │
└─────────────────────────────────────────────┘
```

### Provider Transform Details

The `ProviderTransform` namespace handles the hard part: making all providers behave consistently.

**Message normalization** (per provider):
- **Anthropic**: Filter empty text/reasoning parts; normalize tool call IDs to `[a-zA-Z0-9_-]`
- **Mistral**: Normalize tool IDs to exactly 9 alphanumeric chars; insert synthetic assistant messages after tool results followed by user messages
- **Interleaved reasoning**: Extract reasoning parts to `providerOptions.openaiCompatible.reasoning_content`
- **Modality validation**: Check `model.capabilities.input.*` and replace unsupported content (images, audio, PDF) with error text

**Prompt caching** (automatic, per provider):
| Provider | Cache Object |
|----------|-------------|
| Anthropic/OpenRouter | `{anthropic: {cacheControl: {type: "ephemeral"}}}` |
| AWS Bedrock | `{bedrock: {cachePoint: {type: "ephemeral"}}}` |
| OpenAI-compatible | `{openaiCompatible: {cache_control: {type: "ephemeral"}}}` |

Applied to first 2 system messages + last 2 conversation messages.

**Provider-specific options**:
| Provider | Options |
|----------|---------|
| OpenRouter | `usage: {include: true}` |
| Gemini 3 | `reasoning: {effort: "high"}` |
| OpenAI | `promptCacheKey: sessionID` |
| Google | `thinkingConfig: {includeThoughts}` |
| GPT-5 | `reasoningEffort`, `textVerbosity`, `store` |

**Temperature defaults** (per model family):
- Qwen: `0.55`
- Gemini: `1.0`, `top_p: 0.95`, `top_k: 64`
- Minimax: `1.0`, `top_p: 0.95`, `top_k: 20-40`
- Claude: Anthropic defaults (undefined)

**Reasoning effort variants** (normalized across providers):
| Level | OpenAI | Anthropic | Google | Bedrock |
|-------|--------|-----------|--------|---------|
| low | `reasoning: "low"` | N/A | `thinkingLevel: "low"` | `maxReasoningEffort: "low"` |
| high | `reasoning: "high"` | `budgetTokens: 16000` | `thinkingLevel: "high"` | `maxReasoningEffort: "high"` |
| max | `reasoning: "xhigh"` | `budgetTokens: 31999` | `thinkingBudget: 24576` | N/A |

**Schema transformations**:
- Remove `$schema`, `definitions`, `$defs` from tool parameter schemas
- Anthropic-specific: recursively remove `required` from nested objects (Anthropic rejects these)

### Authentication

- API keys stored in `~/.local/share/opencode/auth.json`
- Plugin `auth.loader` hook for custom auth (enterprise SSO, vaults)
- OAuth discovery via `.well-known/<provider>` endpoints
- Lazy-loads provider SDKs on first use, caches instances by `package + options` hash

### Key Pattern: Provider SDK Lazy Loading

Provider SDK packages (`@ai-sdk/anthropic`, `@ai-sdk/openai`, etc.) are loaded dynamically at first use and cached by a hash of `package name + options`. This avoids importing all provider SDKs at startup.

---

## 4. Tool System Design

### Tool Definition Pattern

Tools are registered via `Tool.define()` with Zod schemas for type-safe parameter validation:

```typescript
// Conceptual pattern (reconstructed from architecture docs)
Tool.define("read", (initCtx: InitContext) => ({
  id: "read",
  description: "Read file contents with line numbers",
  parameters: z.object({
    filePath: z.string().describe("Absolute path to the file"),
    offset: z.number().optional(),
    limit: z.number().optional(),
  }),
  execute: async (args, ctx: Tool.Context) => {
    // ctx provides: sessionID, messageID, agent, abort, ask(), metadata()
    const content = await readFile(args.filePath);
    return {
      title: `Read ${args.filePath}`,
      output: content,           // text sent to the LLM
      metadata: { lines: 100 }, // structured data for UI
      attachments: [],          // optional file attachments
    };
  },
}));
```

### Tool Execution Pipeline

```
LLM emits tool_call
  │
  ▼
1. Zod Schema Validation (formatValidationError for custom errors)
  │
  ▼
2. Permission Check
   ctx.ask(permissionType, patterns)
   Config: config.tool.{name}.allow/deny (glob patterns)
   Three levels: "allow" | "ask" | "deny"
  │
  ▼
3. Plugin Hook: tool.execute.before
  │
  ▼
4. Implementation Execution
   Receives Tool.Context: { sessionID, messageID, callID, abort, agent, ask(), metadata() }
  │
  ▼
5. Plugin Hook: tool.execute.after
  │
  ▼
6. Output Truncation (>2000 lines or >50KB → truncate, save full to disk)
  │
  ▼
7. Persist result to sessions.db
  │
  ▼
8. Publish SSE event (MessageV2.Event.PartUpdated)
  │
  ▼
Result fed back to LLM in next loop iteration
```

### Built-in Tools (20+)

| Category | Tools | Notes |
|----------|-------|-------|
| File System | `read`, `write`, `edit`, `glob`, `grep`, `list` | `edit` uses 9 different matching strategies for robustness |
| Shell | `bash` | 2min timeout, tree-sitter parsing for command analysis, external dir detection |
| Web | `webfetch` | Markdown conversion via Turndown, 5MB limit, Cloudflare retry |
| Code Intelligence | `lsp` | goToDefinition, findReferences, hover, documentSymbol, etc. (20+ languages) |
| Parallel | `batch` | Up to 25 concurrent tool calls via Promise.all, partial failure tolerance |
| Meta | `task` (subtask), `skill` (reusable prompts) | `task` spawns child sessions |

### Tool Result Structure

```typescript
interface ToolResult<M = unknown> {
  title: string;        // UI display
  output: string;       // text fed back to LLM
  metadata: M;          // structured data for UI/logging
  attachments?: Array<FilePart>;  // optional (session-agnostic, IDs added later)
}
```

### Permission System

Three-tier model with glob pattern matching:

| Permission Type | Used By | Pattern Example |
|-----------------|---------|-----------------|
| `read` | read | file paths |
| `edit` | write, edit | file paths |
| `bash` | bash | `"git *": "ask"`, `"rm -rf *": "deny"` |
| `grep` | grep | regex patterns |
| `webfetch` | webfetch | URL patterns |
| `external_directory` | multiple | directory globs |

The bash tool uses **tree-sitter parsing** to detect external paths in command arguments (cd, rm, cp, mv, cat), resolves with `realpath`, and requests permission for all external directories.

### Extension: MCP and Plugins

- **MCP servers**: Supported via stdio and HTTP transport; tools from MCP servers are normalized into the same `Tool.define()` interface and registered in `ToolRegistry`
- **Plugins**: `@opencode-ai/plugin` package provides typed hooks:
  - `auth.loader` — custom auth providers
  - `chat.params` — modify LLM call parameters
  - `tool.execute.before` / `tool.execute.after` — intercept tool execution
  - `chat.system.transform` — modify system prompts

---

## 5. Session/Conversation Management

### Data Model

Sessions use **descending ULIDs** for natural reverse-chronological ordering.

```
Session
  ├── id: string (descending ULID)
  ├── projectID: string
  ├── workspaceID?: string
  ├── directory: string
  ├── parentID?: string         ← tree structure for subtasks
  ├── title: string
  ├── share?: string            ← public share URL
  ├── revert?: string           ← snapshot reference for undo
  ├── permission: RuleSet       ← per-session permission overrides
  ├── summary: FileDiffStats
  ├── time: { created, updated, archived }
  │
  └── Messages[]
       ├── id: string (ascending ULID within session)
       ├── role: "user" | "assistant"
       ├── finish?: "stop" | "tool-calls" | "length" | "error" | "unknown"
       ├── tokens: { input, output, cache_read, cache_write }
       ├── cost: number
       │
       └── Parts[]
            ├── TextPart       ← text content
            ├── FilePart       ← file attachments (images, documents)
            ├── ToolPart       ← tool call + result (state: pending/running/completed/error)
            ├── ReasoningPart  ← model reasoning/thinking
            ├── SnapshotPart   ← file system snapshot for revert
            ├── CompactionPart ← conversation summarization
            ├── SubtaskPart    ← child session delegation
            └── RetryPart      ← retry attempt metadata
```

### Storage Architecture

- **Database**: SQLite via Drizzle ORM (`sessions.db`)
- **Per-project storage**: `./<project-slug>/storage/`
- **Global storage**: `~/.local/share/opencode/global/storage/`
- **Logs**: `~/.local/share/opencode/log/` (latest 10 retained)
- **Blob storage**: Diffs stored separately via `Storage.write(["session_diff", sessionID], diffs)`

### Session Operations

| Operation | Details |
|-----------|---------|
| **Create** | `Session.createNext()` — generates IDs, inserts to DB, publishes `Event.Created` |
| **List** | Generator-based with filtering by directory, workspace, search term (default limit: 100) |
| **Fork** | `Session.fork()` — copies session up to a message cutoff, renames with "(fork #N)" |
| **Revert** | `Session.setRevert()` marks revert points; `SessionRevert.execute()` restores file snapshots and removes messages |
| **Share** | `Session.share()` creates public URLs; configurable as "auto", "disabled", or "manual" |
| **Compaction** | `SessionCompaction.process()` summarizes history when context overflows |
| **Delete** | Recursive: children first, then unshare, then cascade to messages/parts |

### Transaction Pattern

All DB operations follow:
1. `Database.use()` opens transaction
2. Execute Drizzle queries
3. Throw `NotFoundError` if rows missing
4. Convert to typed objects via `fromRow()`/`toRow()`
5. `Database.effect()` defers events until after commit (prevents race conditions)

### Concurrency Control

- `SessionPrompt` maintains a `state()` map to prevent concurrent processing of the same session
- `start(sessionID)` acquires, `cancel(sessionID)` releases
- `defer()` ensures cleanup: `using _ = defer(() => cancel(sessionID))`

---

## 6. How OpenCode Differs from Claude Code

| Aspect | OpenCode | Claude Code |
|--------|----------|-------------|
| **Provider lock-in** | 75+ providers, bring-your-own-model | Anthropic only (Claude models) |
| **Architecture** | Client-server (hub-and-spoke) | Monolithic CLI |
| **Model switching** | Switch models mid-session | Single provider per session |
| **Clients** | TUI + Desktop (Tauri) + Web + VS Code | CLI only |
| **Open source** | MIT license, full source | Closed source |
| **Local models** | Ollama, LM Studio support | No local model support |
| **Auth model** | API keys (universal) | Anthropic OAuth (increasingly locked down) |
| **Persistence** | SQLite (sessions.db) + Drizzle ORM | Proprietary session format |
| **Remote sessions** | Docker containers, persistent workspaces | Local only |
| **Cost** | Pay per API usage to any provider; local = free | $20+/month subscription or API billing |
| **Plugin system** | Typed hook-based plugins (`@opencode-ai/plugin`) | Hooks (pre/post scripts), CLAUDE.md |
| **MCP** | Full MCP support (stdio + HTTP) | Full MCP support |
| **LSP integration** | Built-in, 20+ languages | Not documented |
| **Maturity** | Fast-shipping, newer | Battle-tested, polished |
| **Data privacy** | No data stored; local models possible | Data sent to Anthropic APIs |

### Key Architectural Differences

1. **Decoupled UI from AI**: OpenCode's client-server split means any client can connect. Claude Code is a single binary.

2. **Provider abstraction layer**: OpenCode's `ProviderTransform` is a full normalization engine handling message formats, caching strategies, schema quirks, and temperature defaults across all providers. Claude Code doesn't need this (single provider).

3. **Session persistence**: OpenCode uses a proper relational model (SQLite + Drizzle) with forking, reverting, sharing, and compaction. Claude Code uses simpler local persistence.

4. **Concurrent sessions**: OpenCode supports multiple parallel agent sessions on the same project. Claude Code is single-session.

5. **Desktop app**: OpenCode ships a Tauri-based native desktop app spawning the server as a sidecar process on a random port.

---

## 7. Patterns Useful for LLM-Agnostic Agent Backend

### Pattern 1: Provider Transform Layer

The most valuable pattern. Instead of just abstracting the API call, OpenCode normalizes at three levels:
- **Messages**: Provider-specific quirks in message format, tool call IDs, empty part handling
- **Options**: Provider-specific sampling parameters, reasoning configs, caching
- **Schemas**: Tool parameter JSON schema adaptations per provider

This means the agent loop code never thinks about providers.

### Pattern 2: Lazy Provider SDK Loading

Provider SDKs are loaded dynamically and cached by `package + options hash`. This avoids importing all 75+ provider packages at startup and allows adding providers without modifying core code.

### Pattern 3: Unified Tool Interface with Zod Schemas

Tools return a consistent `{ title, output, metadata, attachments }` shape. The `output` field is what the LLM sees; `metadata` is for the UI. Attachments are session-agnostic (IDs injected later). This clean separation means tools don't know about sessions, providers, or UI.

### Pattern 4: Event-Driven Architecture (SSE)

Every state change publishes a typed event (`Session.Event.Created`, `MessageV2.Event.PartUpdated`, etc.). Clients subscribe via SSE. This decouples the agent loop from all presentation concerns.

### Pattern 5: Permission-Gated Tool Execution

Three-tier permissions (`allow`/`ask`/`deny`) with glob pattern matching. Tools call `ctx.ask()` and the system handles the rest (blocking for user approval or auto-allowing). This is agent-configurable: the Plan agent runs the same tools as Build but with `ask` permissions on destructive operations.

### Pattern 6: Context Compaction

Automatic context window management via `SessionCompaction`. When overflow is detected, the system summarizes conversation history and continues. This allows infinite-length sessions without manual management.

### Pattern 7: Two-Tier Agent System

Primary agents (user-facing) and subagents (delegated tasks). Subagents inherit the invoking agent's model by default. The `task` tool spawns child sessions. This enables complex multi-step workflows without a complicated orchestration layer.

### Pattern 8: 8-Layer Configuration Merge

Configuration merges from 8 sources with clear precedence (environment -> CLI -> project -> global -> managed). This supports everything from local dev to enterprise managed deployments without code changes.

### Pattern 9: Sidecar Process Model

The desktop app spawns `opencode serve` on a random port. This decouples native UI evolution from backend evolution while maintaining local-first architecture. The SDK (`@opencode-ai/sdk`) provides type-safe client bindings.

### Pattern 10: Session Tree Structure

Sessions form trees via `parentID`. The `task` tool creates child sessions for subtask delegation. Results propagate back to parent sessions. This enables recursive problem decomposition.

---

## Sources

- [sst/opencode GitHub Repository](https://github.com/sst/opencode)
- [OpenCode Official Site](https://opencode.ai/)
- [OpenCode Agents Documentation](https://opencode.ai/docs/agents/)
- [OpenCode SDK Documentation](https://opencode.ai/docs/sdk/)
- [DeepWiki: sst/opencode Overview](https://deepwiki.com/sst/opencode/1-overview)
- [DeepWiki: Session Management](https://deepwiki.com/sst/opencode/2.1-session-management)
- [DeepWiki: Prompt Orchestration](https://deepwiki.com/sst/opencode/2.3-prompt-orchestration)
- [DeepWiki: Provider Transformations](https://deepwiki.com/sst/opencode/4.3-opencode-zen)
- [DeepWiki: Tool System](https://deepwiki.com/sst/opencode/5-tool-system)
- [DeepWiki: Plugin System](https://deepwiki.com/sst/opencode/7.2-plugin-system)
- [Builder.io: OpenCode vs Claude Code](https://www.builder.io/blog/opencode-vs-claude-code)
- [Infralovers: Claude Code vs OpenCode](https://www.infralovers.com/blog/2026-01-29-claude-code-vs-opencode/)
- [TensorLake: OpenCode as Claude Code Alternative](https://www.tensorlake.ai/blog-posts/opencode-the-best-claude-code-alternative)
