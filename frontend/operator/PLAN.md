# Construct <-> Operator Integration Plan

## Status Snapshot (2026-03-14)

- Frontend rewrite is complete: `useOperator` replaced the old brain/context-service path.
- Core operator integration is live for discovery, dispatch/chat, streaming, auth token forwarding, project context, and direct tool calls.
- Several Construct features still depend on request types that operator currently stubs or does not expose.

Shared backend + integration status lives in [`construct-operator/docs/roadmap.md`](../../../construct-operator/docs/roadmap.md).

Detailed Construct-facing implementation plan lives in [`construct/docs/plans/construct-integration-wiring-plan.md`](../../docs/plans/construct-integration-wiring-plan.md).

## Frontend Rewrite Status

### What was done

- **Phase 1-5**: Operator client, AssistantPanel, `useArchitect`, `useVibe` wired
- **Phase 6**: Deleted `useContextService`, migrated remaining consumers
- **Build chain**: brain -> operator in Tauri config, Rust bridge, and build scripts
- **Naming**: brain-era logs and identifiers renamed to operator

### Net impact

- Frontend now treats operator as the execution backend
- Frontend no longer owns prompt construction, tool loops, or provider calls
- One client surface (`useOperator`) replaced the previous split stack

## Already Wired

- Operator startup and health checks
- Provider and agent discovery
- `agents.dispatch` / `agents.dispatch_stream`
- `ai.chat` / `ai.chat_stream`
- Anthropic and OpenAI token forwarding into operator
- Project context sync
- Direct tool execution and `tools.call`

## Active Integration Work

### 1. Local data layer

- [x] Replace backend stubs for `storage.*`
- [x] Replace backend stubs for `kv.*`
- [x] Replace backend stubs for `settings.*`
- [x] Replace backend stubs for `project_settings.*`

### 2. Pinned items and designs

- [x] Make `pinned.*` return real data for `useContextDB` / `useStorage`
- [x] Make `designs.*` return real data for vibe and related flows

### 3. MCP settings page

- [x] Back `mcp.list` with richer runtime state
- [x] Implement `mcp.enable` / `mcp.disable`
- [x] Implement `mcp.add` / `mcp.remove`
- [x] Implement `mcp.test`

### 4. Context signals

- [x] Implement `context.set_mode`, `context.set_component`, and `context.set_selection` semantics in operator
- [x] Feed those signals into `context.get` and runner system context

### 5. Skills and hooks UI

- [x] Implement the `skills.*` API surface used by Construct
- [x] Implement the `hooks.*` API surface used by Construct
- [x] Persist enable/disable state for skills, hooks, and MCP lifecycle toggles

### 6. Operator-initiated runtime control

- [ ] Finish desktop/browser/runtime callbacks so operator can drive Construct when needed

## Guardrails

- Frontend does not rebuild system prompts or agent loops.
- Frontend should not treat empty-success stubs as completed features.
- Backend roadmap items are only considered done when reachable from the running operator binary.
