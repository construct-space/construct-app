# Construct Operator + Construct Integration Roadmap

## Status Snapshot (2026-03-15)

- The operator runtime is shipped: agent loop, streaming, auth flows, sessions, project context, spaces, hooks, skills, plugins, MCP startup, state persistence, and TCP transport.
- Construct integration is shipped: discovery, dispatch/chat, streaming, auth/token forwarding, persisted local state, MCP lifecycle, skills/hooks runtime controls, and bridge-backed `space.*` / `browser.*` tools when launched by Construct.
- The remaining roadmap items are optional transport activation beyond TCP and any future request families that are intentionally deferred today.

Current runtime docs:

- [`how-it-works.md`](./how-it-works.md)
- [`desktop-bridge.md`](./desktop-bridge.md)
- [`transport.md`](./transport.md)

---

## Track A — Operator Core

### Shipped

- [x] `agents.dispatch` / `agents.dispatch_stream`
- [x] `ai.chat` / `ai.chat_stream`
- [x] Anthropic, Anthropic OAuth, OpenAI-compatible streaming parsers
- [x] Anthropic auth flow endpoints
- [x] OpenAI token handoff endpoints used by Construct
- [x] Session persistence to disk with message history
- [x] Project context injection plus `agents.md` / `AGENTS.md` / `CLAUDE.md` loading
- [x] Progress events: `session.start`, `turn.start`, `turn.end`, `token.usage`
- [x] Backpressure-aware stream emitter with `DroppedCount()`
- [x] Space loading, hooks, skills, plugins, and sub-agent spawning
- [x] Persistent memory, retry helpers, and passing package test suite
- [x] TCP transport used by Construct today
- [x] Client-scoped project/mode/component/selection context
- [x] Construct-facing local state store under `CONSTRUCT_DATA_DIR/state`
- [x] MCP runtime client startup plus live MCP tool registration/unregistration
- [x] Reverse desktop bridge for `space.*` / `browser.*` tools

### Implemented But Not Wired Into The Shipped Runtime

- [ ] HTTP/SSE transport package
- [ ] WebSocket transport package
- [ ] Token auth middleware for non-local HTTP usage
- [ ] Structured JSON logging with rotation
- [ ] Provider routing, cost tracking, rate limiting, and health monitoring helpers

These pieces exist in the repo, but the running operator binary still boots only the TCP server and does not activate them yet.

---

## Track B — Construct Integration

### Already Wired

- [x] `system.ping` / `system.info`
- [x] `ai.providers` / `ai.models`
- [x] `agents.list`
- [x] `agents.dispatch` / `agents.dispatch_stream`
- [x] `ai.chat` / `ai.chat_stream`
- [x] `auth.anthropic.status` / `auth.anthropic.set_tokens` / `auth.anthropic.clear`
- [x] `auth.openai.status` / `auth.openai.set_tokens` / `auth.openai.clear`
- [x] `sessions.list` / `sessions.get`
- [x] `context.set_project` / `context.get` / `context.clear_project`
- [x] `context.set_mode` / `context.set_component` / `context.set_selection`
- [x] `storage.*`
- [x] `kv.*`
- [x] `settings.*`
- [x] `project_settings.*`
- [x] `pinned.*`
- [x] `designs.*`
- [x] `mcp.list` / `mcp.enable` / `mcp.disable` / `mcp.add` / `mcp.remove` / `mcp.test`
- [x] `skills.*`
- [x] `hooks.*`
- [x] `tool.*` / `tools.call`
- [x] bridge-backed `space.*`
- [x] bridge-backed `browser.*`

### Intentionally Deferred Request Families

- [ ] `ai.conversations.*`
- [ ] `auth.set_api_base`
- [ ] `auth.sync_token`
- [ ] `system.check_update`
- [ ] `system.apply_update`

---

## Track C — Activation Decisions

- [ ] Decide whether production stays TCP-only or should expose HTTP/SSE and WebSocket transports
- [ ] If enabled, wire auth middleware, logging, provider health, and routing telemetry into the running binary
- [ ] If not enabled soon, keep those items out of "complete" claims and treat them as a later phase

---

## Definition Of Aligned

- No Construct feature depends on a request type that only returns an empty success stub.
- No roadmap item is marked complete unless the running operator binary exposes it.
- Primary docs describe shipped behavior instead of historical implementation plans.

---

## Non-goals (for now)

- Multi-user / multi-tenant
- Cloud deployment
- UI inside operator
- Training / fine-tuning
