# Construct Browser MCP Research

> Reference project: [BrowserMCP/mcp](https://github.com/BrowserMCP/mcp)
> Researched: 2026-03-14

## Conclusion

Construct should not integrate BrowserMCP as an external Node MCP package plus browser extension.

Construct should copy the architecture idea instead:

- Browser automation tools live in the Go operator
- Browser tab/window lifecycle lives in Tauri Rust
- Page interaction and DOM inspection happen through a JS bridge injected into Construct-owned Tauri webviews
- Vue renders the browser UI, but it is not the automation transport

In other words: replace BrowserMCP's `Node server + Chrome extension` split with `Go operator + Tauri browser bridge`.

## What To Reuse From BrowserMCP

BrowserMCP is still a useful reference because it separates:

1. MCP/tool server logic
2. browser bridge logic
3. tool definitions and synchronization

From upstream source:

- the server starts from a central tool-registration layer
- browser communication is delegated to a bridge object
- tool synchronization is treated as its own concern

That decomposition is the part worth copying.

What should *not* be copied directly:

- the Node runtime
- the npm launch model
- the Chrome extension dependency
- the "external MCP server added by config" product shape

BrowserMCP needs an extension because it does not own the browser surface. Construct already owns the browser surface via Tauri, so that layer should be built in.

## Why Construct Can Replace the Extension

Construct already has a first-party browser container in Tauri:

- [lib.rs](/Users/flakerim/Construct/construct/src-tauri/src/lib.rs#L1021) creates browser tabs as external `WebviewWindow`s
- [lib.rs](/Users/flakerim/Construct/construct/src-tauri/src/lib.rs#L1107) navigates tabs
- [lib.rs](/Users/flakerim/Construct/construct/src-tauri/src/lib.rs#L1174) reloads tabs
- [lib.rs](/Users/flakerim/Construct/construct/src-tauri/src/lib.rs#L1200) reads current URL
- [lib.rs](/Users/flakerim/Construct/construct/src-tauri/src/lib.rs#L1314) and [lib.rs](/Users/flakerim/Construct/construct/src-tauri/src/lib.rs#L1340) already drive history with injected JS

Construct also already injects JavaScript into external sites in production code:

- [lib.rs](/Users/flakerim/Construct/construct/src-tauri/src/lib.rs#L1698) creates an off-screen webview for OAuth fallback
- [lib.rs](/Users/flakerim/Construct/construct/src-tauri/src/lib.rs#L1757) executes JS inside that external page with `eval(...)`

That is the key precedent. Construct does not need a Chrome extension to reach page DOMs inside Construct-managed browser tabs. It needs a structured automation bridge on top of the existing Tauri webviews.

## Recommended Architecture

```text
LLM / Agent
  -> Go operator tool call
  -> internal browser executor
  -> Tauri command
  -> target browser tab webview
  -> injected JS bridge
  -> structured result
  -> Go operator tool result
```

### Layer 1: Go operator owns the tool contract

Implement a native browser tool family in Go, not as external MCP config:

- `browser.tabs`
- `browser.open`
- `browser.close`
- `browser.navigate`
- `browser.snapshot`
- `browser.click`
- `browser.type`
- `browser.press_key`
- `browser.evaluate`
- `browser.wait_for`
- `browser.screenshot`

These should register like any other operator tools and participate in hooks, agent tool filtering, and sessions normally.

This keeps browser automation first-party instead of pretending Construct must call out to a second server for something it already owns.

### Layer 2: Rust Tauri owns browser process/window state

Rust should manage:

- tab registry
- window labels
- navigation
- focus / visibility
- resize / bounds
- page-ready lifecycle
- JS bridge injection
- result/event plumbing back to operator

The existing browser commands are a good base, but today they only cover tab lifecycle and basic navigation.

### Layer 3: Injected JS bridge replaces the browser extension

Instead of BrowserMCP's extension bridge, Construct should inject a small automation runtime into each managed browser tab after load.

That runtime should expose structured operations such as:

- snapshot DOM into a stable tree
- query element by selector or synthetic node id
- click / focus / type / scroll
- read text / attributes / bounding boxes
- wait for selector / text / URL changes
- emit console messages and navigation events

The bridge should return structured JSON, not stringified console scraping.

### Layer 4: Vue stays as UI, not transport

Vue already has browser UI and MCP settings surfaces:

- [MCPSettings.vue](/Users/flakerim/Construct/construct/src/pages/settings/MCPSettings.vue#L57) assumes MCP servers are external entries

For first-party browser automation, the better UX is:

- a built-in browser capability toggle or settings page
- visible browser tabs controlled by Construct
- no "install extension" step
- no npm package naming in the UI

## Current Findings

### [P1] External MCP is the wrong first implementation path for Construct-owned browser automation

Construct already owns the browser container in Tauri. Routing first-party browser automation through an external MCP package would add:

- another runtime
- another process boundary
- another install surface
- another failure mode

without solving a problem Construct actually has.

For BrowserMCP itself that architecture is necessary. For Construct it is unnecessary indirection.

### [P1] The current Tauri browser layer does not yet expose BrowserMCP-class automation primitives

Current Tauri browser support covers:

- create tab
- close tab
- navigate
- reload
- URL readback
- history back/forward
- bounds/visibility

It does **not** yet expose:

- DOM snapshotting
- selector-based element actions
- text extraction
- structured waiting primitives
- console/network capture
- screenshots

So Construct has the container, but not the automation bridge.

### [P1] Operator has no native browser tool family yet

The operator currently has no built-in browser automation tools registered through the main tool registry. That means even though Tauri can host browser tabs, agents cannot use them as first-class tools.

### [P2] BrowserMCP should be used as a design reference, not a source dependency

The upstream README says the BrowserMCP repo cannot yet be built standalone. That is another reason not to vendor it.

The right approach is:

- study the upstream tool/bridge split
- reimplement the needed behavior in Go/Rust/JS
- keep Construct's product shape native

## Proposed Implementation Plan

### Phase 1: Native browser executor in operator

Add a browser subsystem in `construct-operator`:

- tab-aware tool definitions
- session-safe tab ids
- structured request/response types
- direct wiring into the standard tool registry

This should be a normal built-in tool family, not an MCP server config.

### Phase 2: Tauri browser automation bridge

Extend the Rust browser commands with:

- `browser_eval(tab_id, script)`
- `browser_snapshot(tab_id)`
- `browser_click(tab_id, target)`
- `browser_type(tab_id, target, text)`
- `browser_wait_for(tab_id, condition)`
- `browser_screenshot(tab_id)`

Do not let arbitrary LLM text become raw JS. The Rust layer should accept structured commands and use a known injected runtime.

### Phase 3: Inject stable page runtime

On page load, inject a small JS runtime that:

- assigns stable node ids
- serializes DOM state
- performs actions by node id or selector
- reports navigation/console events back through Tauri

This is the Construct replacement for BrowserMCP's extension bridge.

### Phase 4: Optional MCP adapter later

If Construct later wants to expose its built-in browser tools to external MCP clients, add a thin adapter after the native implementation exists.

The order should be:

1. native browser tools
2. internal agent usage
3. optional MCP exposure

not the reverse.

## Design Rules

- Keep operator orchestration in Go.
- Keep browser ownership in Tauri Rust.
- Keep page inspection/action logic in a small injected JS runtime.
- Keep Vue for product UI, not low-level automation.
- Avoid an extension requirement entirely.
- Avoid a Node runtime requirement for core browser automation.
- Treat BrowserMCP as a model for tool/bridge separation, not as a package to embed.

## Sources

- [BrowserMCP repo](https://github.com/BrowserMCP/mcp)
- [BrowserMCP README](https://raw.githubusercontent.com/BrowserMCP/mcp/main/README.md)
- [BrowserMCP package metadata](https://raw.githubusercontent.com/BrowserMCP/mcp/main/package.json)
- [BrowserMCP automation docs](https://docs.browsermcp.io/start-automating)
- [BrowserMCP MCP setup docs](https://docs.browsermcp.io/setup-mcp-server)
- [BrowserMCP extension setup docs](https://docs.browsermcp.io/setup-extension)
