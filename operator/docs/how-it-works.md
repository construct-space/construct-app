# Construct Operator: How It Works

`cmd/operator/main.go` is the shipped runtime. Operator runs as a local sidecar process for Construct and owns the agent loop, tool execution, MCP integration, local persistence, and the reverse desktop bridge used for `space.*` and `browser.*` tools.

## Startup Sequence

1. `appdir.Init()` resolves `CONSTRUCT_DATA_DIR`, exports it to child processes, and creates `bin`, `logs`, `spaces`, `skills`, `memory`, `sessions`, and `state`.
2. Operator opens the persistent session store in `sessions/` and the Construct-facing local state store in `state/`.
3. If Tauri passed `CONSTRUCT_BRIDGE_TOKEN`, operator creates a reverse bridge client to `127.0.0.1:60101`. That is what enables `space.*` and `browser.*`.
4. Providers are registered from local token sources, environment variables, and saved provider-key settings.
5. The tool registry is assembled from:
   - built-in file/shell/project tools
   - bridge-backed `space.*` and `browser.*` tools
   - tools loaded from spaces
   - plugin tools
   - MCP-discovered tools
   - the built-in `spawn_agent` tool
6. Hooks, skills, plugins, and agents are loaded from all known space directories plus user config under `CONSTRUCT_DATA_DIR`.
7. Saved enable/disable state for hooks, skills, and MCP servers is restored from the state store.
8. MCP configs are loaded from spaces plus `CONSTRUCT_DATA_DIR/mcp.json`; enabled servers connect and register tools into the live registry.
9. A `runner.Runner` is created with providers, tools, hooks, skills, and the persistent session store.
10. The TCP server starts on `127.0.0.1:60100` and shuts down after 15 seconds with no connected clients.

## Request Flow

Operator currently ships one live transport: newline-delimited JSON over local TCP.

Construct/Tauri
-> `send_context_request` or `operator_stream`
-> `internal/transport.TCPServer`
-> request router in `cmd/operator/main.go`
-> either a direct handler or `runner.Run()`

Two paths matter:

- Sync requests go through `srv.OnRequest`.
- Streaming requests are any request type ending in `_stream` and go through `srv.OnStream`.

`agents.dispatch`, `agents.dispatch_stream`, `ai.chat`, and `ai.chat_stream` all end up building a `runner.RunRequest` and executing the agent loop.

## Agent Loop

The runner is in `internal/runner`.

For each run it:

1. Resolves the provider for the selected model.
2. Creates a persistent session record.
3. Builds the system prompt from:
   - the agent system prompt
   - project context
   - current client UI context
   - matching skills
   - project instruction files such as `agents.md`, `AGENTS.md`, and `CLAUDE.md`
4. Resolves the allowed tool set for the agent, then unions in any tools required by matched skills.
5. Calls the provider.
6. Executes any requested tools through the shared tool registry.
7. Runs pre-hooks and post-hooks around every tool execution.
8. Appends tool results back into the conversation and loops until `end_turn` or max turns.
9. Persists the final session transcript and usage.

Streaming runs emit `session.start`, `turn.start`, `token.usage`, `turn.end`, and final `done` events through `internal/stream`.

## Client-Scoped Context

Operator keeps request context per `client_id`, not globally.

Each connected Construct instance can set:

- active project via `context.set_project`
- mode via `context.set_mode`
- active component via `context.set_component`
- current selection via `context.set_selection`

That state is used in three places:

- `context.get`
- the `get_project_context` tool
- runner system-context injection before provider calls

If no project is set for a client, tools fall back to the operator startup directory.

## What Gets Loaded At Runtime

### Providers

The runtime can register:

- Anthropic OAuth from OpenCode tokens or env vars
- OpenAI Codex OAuth from local Codex token files
- OpenAI API key provider
- DeepSeek and xAI through saved settings or env vars
- any future providers added through the provider layer

### Spaces

Operator loads spaces from:

- `CONSTRUCT_DATA_DIR/spaces`
- any extra directories in `CONSTRUCT_SPACES_PATH`

Each space can contribute:

- an agent
- tools
- hooks
- skills
- plugins

There is only one hardcoded fallback agent: `general`.

### Hooks

Hooks are registered from:

- built-in safety hooks
- space hook definitions
- `CONSTRUCT_DATA_DIR/hooks.json`
- plugin hook registrations

They run for both LLM-driven tool calls and direct `tool.*` / `tools.call` requests.

### Skills

Skills are registered from:

- space skill files
- `CONSTRUCT_DATA_DIR/skills`
- built-in skills

Matching skills can change both the prompt and the tool set available to a run.

### MCP

Operator acts as an MCP client. At startup it:

- loads space-owned and user-owned MCP configs
- restores enabled state from the local state store
- connects enabled servers
- registers discovered MCP tools into the same tool registry used by the runner

At runtime, `mcp.enable`, `mcp.disable`, `mcp.add`, `mcp.remove`, and `mcp.test` mutate that live state.

## Local Persistence

Operator persists three main kinds of data under `CONSTRUCT_DATA_DIR`:

- `sessions/`: agent transcripts and run history
- `memory/`: longer-lived operator memory
- `state/`: Construct-facing local state

`state/` currently includes:

- `storage.json`
- `kv.json`
- `settings.json`
- `project-settings.json`
- `pinned.json`
- `designs.json`
- `skill-states.json`
- `hook-states.json`
- `mcp-states.json`

This is the desktop-local source of truth for Construct settings and saved UI data.

## Reverse Desktop Bridge

When Construct launches operator it also passes `CONSTRUCT_BRIDGE_TOKEN`. That turns on bridge-backed tools:

- `space.snapshot`
- `space.list_actions`
- `space.run_action`
- `browser.tabs`
- `browser.open`
- `browser.close`
- `browser.navigate`
- `browser.snapshot`
- `browser.click`
- `browser.type`
- `browser.press_key`
- `browser.wait_for`
- `browser.screenshot`

Without that token those tools are not registered. The full bridge contract and callback flow are documented in [desktop-bridge.md](./desktop-bridge.md).

## Current Transport Reality

`cmd/operator` only starts the TCP server today.

The repo also contains HTTP/SSE and WebSocket transport packages plus middleware/logging/routing helpers, but they are not activated by the shipped binary yet. Treat them as dormant implementation, not live runtime behavior.

## Related Docs

- Runtime overview: [architecture.md](./architecture.md)
- TCP protocol details: [transport.md](./transport.md)
- Hook behavior: [hooks.md](./hooks.md)
- Reverse bridge details: [desktop-bridge.md](./desktop-bridge.md)
