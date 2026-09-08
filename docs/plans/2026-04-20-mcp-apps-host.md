# MCP Apps — Host Support in Construct

**Date:** 2026-04-20
**Status:** Proposal

## Idea

Support the **MCP Apps** extension (spec version 2026-01-26, official extension ID `io.modelcontextprotocol/apps`) as a host in Construct. When a tool on a connected MCP server declares a `ui://` resource via `_meta.ui.resourceUri`, Construct fetches the bundled HTML, renders it inside a sandboxed iframe inline in the chat, and proxies postMessage JSON-RPC between the iframe and the server (+ selected host capabilities).

This turns every MCP server that ships UI into a mini-app that appears in Construct's conversation, without the author writing Construct-specific code.

## Why it matters

- **Ecosystem leverage.** Claude, Claude Desktop, VS Code Copilot, Goose, Postman, MCPJam already support MCP Apps. A Construct user who connects, say, a customer-segmentation server gets the same rich dashboard those users get, for free.
- **Complements Spaces, not replaces.** Spaces are Construct-native (full SDK, filesystem, lifecycle, scope routing). MCP Apps are portable per-tool-call UIs from third-party servers. Different niches.
- **Cheap moat-building.** Being an early high-quality host is more work on the client side than the server side, but it's a one-time build that pays off for every future MCP App the user installs.
- **Aligns with our existing stack.** The operator already has a live MCP client (`internal/mcp/`). The frontend already sandboxes third-party content (widget host uses a closed-shadow-DOM pattern). We have the parts.

## Out of scope

- **Authoring MCP Apps from Construct.** Not in this plan — Construct Spaces are our authoring story. Supporting third-party MCP Apps as a host is the scope here.
- **Non-Claude LLM providers.** MCP Apps is transport-agnostic once we have the tool-result, so this lands for all providers simultaneously.
- **Tauri-side native rendering.** Everything runs inside the existing Vue webview. We do not open a separate native window per app.
- **`ui/sampling` (server-initiated LLM calls via the app).** Spec-optional, niche; defer.
- **Persistent app state outside the current conversation.** MCP Apps are scoped to the tool result that spawned them. If the server wants persistence, it persists. Host doesn't.

## Background — protocol shape

Two MCP primitives combine:

1. **Tool with UI meta.** A tool's definition includes `_meta.ui.resourceUri: "ui://…"`. The URI scheme `ui://` signals "this tool renders an app."
2. **UI resource.** A `resources/read` handler on the same server serves an HTML page at that URI. HTML is typically self-contained (Vite + `vite-plugin-singlefile`), but the server can set CSP in `_meta.ui.csp` to allow external origins.

Flow when the LLM calls the tool:

1. **Preload (optional).** Host reads the UI resource *before* the tool result arrives so the iframe is ready for streaming input.
2. **Fetch.** Host calls `resources/read` for the `ui://` URI, gets the HTML.
3. **Sandbox render.** Host renders the HTML in an iframe with `sandbox="allow-scripts"` (no `allow-same-origin`), sized inline in the chat where the tool result would go.
4. **Handshake.** The app uses `@modelcontextprotocol/ext-apps`'s `App` class (thin wrapper over postMessage) to send `ui/initialize` to the host. Host responds with capabilities.
5. **Push tool result.** Host posts the tool result to the app via `app.ontoolresult`.
6. **Bidirectional.** The app can call back via `app.callServerTool({ name, arguments })`, `app.sendOpenLink(url)`, `app.requestData(...)`, etc. Host proxies the tool call through the existing MCP client. Server can push fresh results to the app.
7. **Close.** When the chat message is removed or collapsed, the iframe is torn down.

Host-to-app messages (subset):

- `ui/initialize` → `{ capabilities: { tools: true, openLink: true, … } }`
- `ui/toolResult` → pushes `{ content, _meta }` of the spawning call
- `ui/serverToolResult` → response to the app's proxied `tools/call`
- `ui/error` → error pushback

App-to-host messages (subset):

- `ui/ready`
- `tools/call` (to be proxied to the server)
- `ui/openLink { url }`
- `ui/resize { height }`

(Exact names match the 2026-01-26 spec at `apps.extensions.modelcontextprotocol.io`. Use `@mcp-ui/client` or handwrite.)

## Architecture

### Operator (Go)

**`internal/mcp/client.go`** needs small but load-bearing changes:

1. **Preserve tool list metadata.** Today we parse `tools/list` down to `name + inputSchema`. Extend the parsed tool def to carry `Meta` (the `_meta` block) and expose `UIResourceURI() string` when `_meta.ui.resourceUri` is present.
2. **Preserve tool result metadata.** Today `CallTool` returns `string` (joined text content). Add `CallToolRich(ctx, serverID, toolName, input) (*ToolResult, error)` returning:
   ```go
   type ToolResult struct {
       Content []ToolContent           // text, image, resource_link, resource
       IsError bool
       Meta    map[string]any          // _meta block (may include ui fields)
   }
   ```
   Keep the existing `CallTool` for callers that only want flattened text (agent tool path), route MCP Apps through `CallToolRich`.
3. **Read resource.** Add `ReadResource(ctx, serverID, uri) (*Resource, error)` that calls `resources/read` and returns the first content item (mimeType, text or blob).
4. **Proxy tool calls from the app.** Add a new operator route `mcp.app_tool_call` that takes `{ session_id, message_id, tool_call_id, server_id, tool, arguments }`, enforces that the tool belongs to the same server that spawned the app, calls `CallToolRich`, returns the result. Permission check goes through the existing harness permission machinery so users can "ask/deny" an app-initiated call.
5. **Capability gating.** Per-server settings for "allow UI rendering" (default on) + per-capability toggles (openLink default on, external-origin CSP default off). Stored in user MCP config.
6. **Session-scoped app registry.** Each rendered app has `(session_id, message_id, server_id, tool_call_id)`. Operator keeps a map so frontend can resolve proxy calls and the host can tear down apps on session-end.

**`internal/mcp/handler.go`** — extend the existing `mcp.tool_exec` handler path so that when the tool result has `_meta.ui.resourceUri`, the response to the frontend carries:

```
{ kind: "app", resource_uri, tool_result, server_id, tool_call_id, _meta }
```

instead of the flattened text content.

**No change to the agent loop or permission classifier.** The tool call still happens; only the rendered output differs.

### Frontend (Vue)

**New component tree under `frontend/components/mcp/`:**

- `MCPAppFrame.vue` — the iframe host. Props: `{ html, csp, permissions, serverId, toolCallId, initialResult }`. Uses `<iframe sandbox="allow-scripts" :srcdoc="html">`. Sets `Content-Security-Policy` via a `<meta http-equiv>` injected into the HTML at render time (or builds a data-URL with the CSP baked in). Attaches `message` listener, multiplexes to/from operator via `useAgentSession`.
- `MCPAppBridge.ts` — the postMessage bridge. Implements the host half of the 2026-01-26 protocol: handles `ui/ready`, translates app-originated `tools/call` into `operator.send('mcp.app_tool_call', ...)`, pushes `ui/toolResult` on receive, handles `ui/resize` by setting iframe height, handles `ui/openLink` via Tauri `opener`.
- `useMCPApp.ts` — composable. Preloads the resource, owns the bridge, cleans up on unmount.

**Wiring into chat stream:**

- `frontend/operator/useAgentSession.ts` — when a `tool_result` event arrives and its payload is `{ kind: "app", … }`, emit a typed variant. The chat view replaces the default `<ToolResultBlock>` with `<MCPAppFrame>` for that event.
- `frontend/components/session/ToolResultBlock.vue` — branch on event kind.

**Settings:**

- `frontend/pages/settings/MCPSettings.vue` (or the existing MCP section) — per-server "Render UI apps" toggle, per-capability toggles, "Allow external origins in CSP" toggle.

### Security model

Defense-in-depth. MCP Apps are third-party code running in our chat, so assume malicious.

1. **iframe sandbox.** `sandbox="allow-scripts"` only. No `allow-same-origin` → the iframe is origin-null, cannot reach Construct DOM, cookies, localStorage, or Tauri APIs.
2. **CSP injection.** Before rendering the HTML, inject a `<meta http-equiv="Content-Security-Policy">` with a default deny-all + only the origins in `_meta.ui.csp`. Default: `default-src 'none'; script-src 'unsafe-inline' 'self'; style-src 'unsafe-inline' 'self'; img-src data: 'self'; connect-src 'none'` — no outbound network unless the server whitelists it. Same for `frame-src`, `child-src`.
3. **postMessage origin check.** Iframe is origin-null after sandboxing, so we match on the iframe `contentWindow` reference, not on `event.origin`. Drop messages that don't match the registered window.
4. **Capability allowlist per app.** Host refuses messages whose method isn't in the app's granted capability list. Default grants: `tools/call` (restricted to the spawning server), `ui/resize`, `ui/ready`. Opt-in: `ui/openLink`, `ui/copyText`, etc.
5. **Tool-call scoping.** When an app calls `tools/call`, the host restricts the target `serverID` to the server that spawned the app. Cross-server is denied unless the user has explicitly granted it.
6. **Permissions flow.** Any app-initiated `tools/call` runs through the harness permission checker exactly like an agent-initiated one. In `ModePlan` or `ModeDontAsk` those calls are denied/prompted accordingly.
7. **Size + rate limits.** Cap iframe height (e.g. 80vh), cap postMessage rate (e.g. 60/s), cap in-flight app→server tool calls per app (e.g. 4 concurrent) to stop a runaway app from DoSing the server.
8. **No persistent state inside the iframe.** Every tool-call spawn re-renders; the iframe is ephemeral to that chat message. (If an app wants per-user state, it's the server's job.)
9. **Tauri hardening.** The Construct app already uses a Tauri webview. Verify CSP on the Tauri window itself disallows loading attacker-controlled URLs into a top-level frame. The iframe sandbox handles the inner layer.

### Data model

- No schema changes to session state — rendered apps are purely a rendering concern for tool-result events.
- MCP config file gains an `apps: { enabled: bool, capabilities: {...}, allowExternalOrigins: bool }` block per server. Backward-compatible.

### Dependencies

- **Use `@mcp-ui/client`?** Quick win (React components for the host iframe + bridge). Problem: it's React and we're Vue. Two options:
  - **A. Hand-roll** the bridge in Vue using the spec. ~400–600 lines. We already have the pattern from widget host work.
  - **B. Use `@modelcontextprotocol/ext-apps`'s AppBridge module** (framework-agnostic, lower-level than `@mcp-ui/client`). Bring it in, write a thin Vue wrapper around it. Preferred — spec-accurate, less code we own, Anthropic updates it.
- Add to `frontend/package.json`: `@modelcontextprotocol/ext-apps` (pin a known-good version; treat like any other MCP SDK).

### Telemetry

Minimal. Log per-render: `{ server_id, tool, resource_size_bytes, render_ms, first_interaction_ms, tool_calls_from_app }`. Surface in a debug panel. No external reporting.

## Milestones

Each milestone is independently shippable + reviewable.

### M1 — Operator: preserve MCP metadata

- Extend parsed tool def with `Meta`; wire through `tools/list` parsing.
- Add `CallToolRich` returning full ToolResult with `Meta`.
- Add `ReadResource(serverID, uri)`.
- Unit tests: a fake MCP server with `_meta.ui.resourceUri`; assert `CallToolRich` preserves it and `ReadResource` returns HTML.

Blast radius: pure additive. Existing `CallTool` unchanged.

### M2 — Operator: app tool-call proxy route

- `mcp.app_tool_call` IPC route — validates the calling session, scopes server, runs permission check, calls `CallToolRich`, returns.
- Session-scoped app registry (map keyed by `(session_id, message_id, tool_call_id)`).
- Tests: route accepts a valid app call, denies cross-server, denies unknown tool_call_id.

### M3 — Frontend: iframe host + bridge (non-interactive first)

- `MCPAppFrame.vue` rendering `srcdoc` with CSP meta injected, sandbox="allow-scripts".
- `MCPAppBridge.ts` handling `ui/ready`, `ui/resize`, pushing `ui/toolResult` once.
- Ship with **no tool-call proxying** — read-only apps work (dashboards, visualizations). Matches the majority of today's MCP App examples.
- Render a known-good example (three.js-server or qr-code-server) end-to-end.
- Keyboard escape closes the iframe; focus trap stays inside when interacting.

### M4 — Frontend: app → server tool calls

- Bridge handles `tools/call` from the app, calls `operator.send('mcp.app_tool_call', …)`, routes the result back with `ui/serverToolResult`.
- Capability allowlist UI in settings (default list + per-server overrides).
- Tests: Vitest with a mock bridge that verifies message shapes.

### M5 — Capabilities (openLink, copy, resize, etc.)

- Implement remaining host capabilities behind per-server/per-capability toggles.
- `ui/openLink` uses Tauri `opener` (external browser) + a user confirm on first use per server.

### M6 — Polish + docs

- Settings UX: per-server matrix of allowed capabilities, "allow UI rendering" master toggle.
- Error states: fetch-resource failed, HTML parse failed, CSP violation, app crashed — all show a fallback rendering of the raw text content.
- Changelog entry, user-facing docs page.
- Run through the 6–8 published example servers from `modelcontextprotocol/ext-apps/examples/` (qr-code, map, threejs, shadertoy, cohort-heatmap, customer-segmentation, budget-allocator, pdf). Verify each renders + interacts correctly.

### M7 — Stretch

- **Preload optimization.** Fetch the UI resource when `tools/list` is read (not when the tool is called). Speeds up first render.
- **Streaming tool input into the app.** Spec supports it; useful for long-running tool calls.
- **App picker in the chat.** Let the user manually invoke a UI-capable tool from a picker, not just via the LLM. Same UX as a direct tool call.
- **Per-app CSP nonce management** if any server ships external-origin CSPs. We'll probably want to block-by-default and have users opt-in in settings.

## Tradeoffs and risks

- **iframe + sandbox means limited UX integration.** The app can't inherit Construct's theme tokens or keyboard shortcuts. Trade-off for isolation. We can mitigate by exposing a subset of theme tokens through the initialize capability (`{ theme: { bg, fg, accent, … } }`) so well-behaved apps can match the shell.
- **`srcdoc` + CSP injection is fiddly.** Some bundled apps set their own `<meta http-equiv="Content-Security-Policy">` and conflict with ours. Strategy: our CSP comes first and takes precedence; document this clearly; offer a "trust this server" escape hatch in settings that uses server-declared CSP instead.
- **Spec is young (2026-01-26).** Field names and capabilities may churn. Mitigation: thin adapter layer around the SDK so wire-format changes land in one file.
- **Claude Desktop reference implementation.** Where Construct's behavior diverges from Claude's, app authors will file bugs against us. Test against Claude Desktop for ≥3 of our canonical examples before shipping M6.
- **Attack surface.** An MCP App is third-party HTML/JS running in our UI. Bugs in sandbox escape or CSP injection are security incidents. Budget for a focused security review before M6.
- **Discovery.** MCP Apps don't self-announce — a user has to install an MCP server that happens to ship apps. We can surface "this server supports UI" badges in the MCP settings list after we parse `tools/list`, so users know what they're getting.
- **Overlap with Spaces.** Users may ask "why not just build a Space?" — because Spaces are native Construct, richer, but Construct-specific. MCP Apps are portable but sandboxed. Document the line: build a Space for deep integrations; ship an MCP App for cross-host UI.

## Open questions

- **App persistence across reloads.** If the user reloads the chat (or resumes a session), do we re-render the apps, and if so do we replay the stored tool result or re-invoke the tool? Leaning replay from stored state — matches the "tool result is part of session history" mental model.
- **Multi-app per message.** Can a single tool call surface multiple UI resources? Spec says no (one `_meta.ui.resourceUri` per tool def). Good.
- **Who owns the HTTP fetch for `ui://` resources served over HTTP instead of resolved via MCP?** MCP's `resources/read` is the canonical path; outside that is out of spec. Only support `resources/read`.
- **Memory budget.** How many simultaneous apps in a long session? Cap at, say, 10 live iframes; older ones collapse to text and unmount.
- **Print-mode / export.** When exporting a chat, do we inline app output? Probably snapshot the last-known tool result as plain content, not the iframe.

## Open file pointers

- `operator/internal/mcp/client.go:227` — `CallTool` (the existing flattener to extend / branch from)
- `operator/internal/mcp/handler.go` — MCP IPC routes
- `operator/internal/mcp/jsonrpc.go` — JSON-RPC helpers
- `operator/internal/mcp/bootstrap.go` — startup + config load
- `operator/internal/harness/permission.go` — permission enforcement the app proxy must go through
- `frontend/operator/useAgentSession.ts` — tool-result stream events
- `frontend/pages/settings/` — for the MCP settings UI additions
- Canonical examples: https://github.com/modelcontextprotocol/ext-apps/tree/main/examples
- Host AppBridge SDK: https://apps.extensions.modelcontextprotocol.io/api/modules/app-bridge.html
- React host lib (reference only): https://mcpui.dev / https://github.com/MCP-UI-Org/mcp-ui
