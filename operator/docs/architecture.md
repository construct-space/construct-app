# Construct Operator — Architecture

Construct Operator is the local execution service behind Construct. It owns the agent loop, tool registry, hook and skill runtime, MCP integration, session persistence, and the reverse desktop bridge used for `space.*` and `browser.*` tools.

The current runtime flow is documented in [how-it-works.md](./how-it-works.md). This file is the structural overview.

## Runtime Shape

```text
Construct / Tauri
    |
    v
TCP transport (127.0.0.1:60100)
    |
    v
Request router in cmd/operator/main.go
    |
    +--> direct RPC handlers
    |    system.* context.* sessions.* storage.* mcp.* skills.* hooks.* ...
    |
    +--> runner.Run()
          |
          +--> provider selection
          +--> prompt assembly
          +--> tool execution
          +--> hooks
          +--> session persistence
```

When Construct spawns operator with `CONSTRUCT_BRIDGE_TOKEN`, the tool registry also includes reverse-bridge `space.*` and `browser.*` tools. That callback path is documented in [desktop-bridge.md](./desktop-bridge.md).

## Package Map

```text
construct-operator/
|- cmd/
|  |- operator/main.go        # shipped server binary
|  `- tui/main.go             # interactive local client
|- internal/
|  |- agent/                  # agent config and run result types
|  |- appdir/                 # OS-native data directory
|  |- desktop/                # operator -> Tauri bridge client
|  |- hook/                   # hook registry, execution, safety hooks
|  |- mcp/                    # MCP client and config loading
|  |- memory/                 # persistent memory
|  |- plugin/                 # plugin loading and tool/hook registration
|  |- provider/               # provider abstraction and concrete backends
|  |- runner/                 # agent loop
|  |- session/                # persisted session store
|  |- skill/                  # skill registry and matching
|  |- space/                  # load agents/tools/hooks/skills/plugins from spaces
|  |- state/                  # Construct-facing local state store
|  |- stream/                 # stream emitter with backpressure tracking
|  |- tool/                   # tool registry, built-ins, bridge tools
|  `- transport/              # request/response transport layer
`- docs/
```

## Core Design Rules

1. Dependency injection: the runner is assembled from registries and stores instead of using hidden globals.
2. One tool registry: built-ins, space tools, plugin tools, MCP tools, and bridge tools all register into the same runtime surface.
3. Client-scoped UI context: project, mode, component, and selection are tracked per transport `client_id`.
4. Safety around every tool call: LLM-driven tool execution and direct `tool.*` / `tools.call` share the same hook path.
5. Local-first persistence: sessions, memory, and Construct state are file-backed under `CONSTRUCT_DATA_DIR`.

## Data Directory

`appdir.Init()` creates and exports `CONSTRUCT_DATA_DIR`.

Platform defaults:

- macOS: `~/Library/Application Support/Construct/`
- Windows: `%APPDATA%\\Construct\\`
- Linux: `$XDG_DATA_HOME/construct/`

Operator currently uses these subdirectories:

```text
Construct/
|- bin/
|- logs/
|- spaces/
|- skills/
|- memory/
|- sessions/
`- state/
```

`state/` is where Construct-facing desktop data lives: settings, storage, pinned items, designs, and persisted runtime state for skills, hooks, and MCP servers.
