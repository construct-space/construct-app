# Desktop Bridge

The desktop bridge is the reverse path from operator back into the running Construct app. It is local-only and only exists when Tauri launches operator with `CONSTRUCT_BRIDGE_TOKEN`.

## Topology

1. Construct starts an HTTP server in Tauri on `127.0.0.1:60101`.
2. Tauri generates a random bearer token at startup.
3. `start_context_service` spawns operator and passes that token as `CONSTRUCT_BRIDGE_TOKEN`.
4. Operator creates `internal/desktop.Client` and registers bridge-backed tools.
5. Those tools call back into Tauri over `POST /bridge`.

If operator is launched outside Construct, the token is missing and no bridge tools are registered.

## Wire Contract

Request:

```json
{
  "id": "bridge_1",
  "method": "space.snapshot",
  "params": {
    "space_id": "project"
  }
}
```

Response:

```json
{
  "id": "bridge_1",
  "result": {},
  "error": null
}
```

HTTP rules:

- endpoint: `POST /bridge`
- auth: `Authorization: Bearer <CONSTRUCT_BRIDGE_TOKEN>`
- body: JSON
- non-200 responses mean transport/auth failure
- bridge-level failures return `{ "error": { "code": "...", "message": "..." } }`

## Supported Methods

### Core

- `ping`

### Space Automation

- `space.snapshot`
- `space.list_actions`
- `space.run_action`

These are semantic actions exposed by the active space, not DOM automation.

The frontend side is built around `AutomationProvider`:

- `snapshot()`
- `listActions()`
- `runAction(actionId, payload)`

`space.list_actions` returns `space_id` plus the list of actions exposed by that provider.

### Browser Automation

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

These operate on Tauri-managed browser tabs. DOM automation is performed by injecting `automation.js` into the target webview. `browser.snapshot` returns a structured node list with generated `node_id` values. Click/type/key actions can target either a `node_id` from that snapshot or a CSS selector.

`browser.screenshot` is currently implemented on macOS through native window capture. Non-macOS platforms return a not-implemented error.

## Space Request Path

`space.*` calls follow this path:

1. Operator tool execution calls `desktop.Client.Call(...)`.
2. Tauri validates the bearer token and parses the bridge request.
3. Tauri emits `bridge:request` to the main webview.
4. The frontend `startBridgeListener()` receives the event.
5. `bridgeListener.ts` resolves the target space and calls the registered automation provider from `spaceContextBus.ts`.
6. The frontend replies with `bridge_respond`.
7. Tauri completes the HTTP response back to operator.

The listener only runs in the main window, so browser tabs and auxiliary windows do not compete for space callbacks.

## Browser Request Path

`browser.*` calls stay inside Tauri:

1. Operator calls the bridge.
2. Tauri routes the request into `browser_bridge.rs`.
3. Tab lifecycle actions use Tauri window APIs.
4. DOM actions inject or reuse the automation runtime in `automation.js`.
5. The automation runtime returns structured JSON back to Rust, then back to operator.

This gives agents a BrowserMCP-style tool surface without exposing the browser directly to the frontend transport.

## Space Resolution Rules

For `space.*` methods, the target space is resolved in this order:

1. explicit `space_id` in the request
2. current active space tracked by the Construct router
3. error if neither exists

That prevents operator from silently acting on the wrong space.

## Operational Constraints

- Bridge tools exist only in the Construct desktop runtime.
- `space.*` only works for spaces that call `registerAutomationProvider(...)`.
- `browser.*` only works for tabs created or tracked by the Tauri browser bridge.
- The bridge token is local-process authentication, not a general remote API.
