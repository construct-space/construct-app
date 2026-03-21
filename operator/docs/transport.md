# Transport Protocol

The shipped operator binary currently exposes one live transport: local TCP on `127.0.0.1:60100`.

The repo contains HTTP/SSE and WebSocket packages, but `cmd/operator` does not start them yet. Treat TCP as the only supported runtime transport today.

## Connection

- default address: `127.0.0.1:60100`
- override: `--port <n>`
- startup signal for parent processes: `OPERATOR_ADDR=127.0.0.1:<port>` on stdout

Construct connects through Tauri:

- sync RPC: `send_context_request`
- streaming RPC: `operator_stream`

## Framing

Each message is one JSON object plus `\n`.

Example:

```text
{"id":"r1","type":"system.ping","client_id":"construct-main"}
{"id":"r1","success":true,"data":{"status":"ok","version":"1.0.0"}}
```

## Request Shape

```json
{
  "id": "r1",
  "type": "context.get",
  "client_id": "construct-main",
  "payload": {}
}
```

Fields:

- `id`: correlates request and response
- `type`: RPC method name
- `client_id`: logical Construct client instance; used for per-client context
- `payload`: optional JSON payload

## Response Shape

```json
{
  "id": "r1",
  "success": true,
  "data": {},
  "error": ""
}
```

## Streaming Shape

Request types ending in `_stream` are handled by the stream path. Chunks are newline-delimited JSON too:

```json
{ "id": "r1", "type": "session.start", "data": { "session_id": "..." } }
{ "id": "r1", "type": "status", "data": { "state": "thinking", "message": "Thinking…" } }
{ "id": "r1", "type": "text", "data": { "text": "partial output" } }
{ "id": "r1", "type": "status", "data": { "state": "tool_running", "message": "Reading package.json", "tool": "read_file" } }
{ "id": "r1", "type": "tool.result", "data": { "tool": "read_file", "title": "Reading package.json" } }
{ "id": "r1", "type": "status", "data": { "state": "complete", "message": "Done" } }
{ "id": "r1", "type": "done", "data": { "content": "final output" }, "done": true }
```

See [status-events.md](./status-events.md) for the full status event protocol.

If a `_stream` request falls through to the normal request handler, the transport wraps the final response as a terminal `done` chunk so Tauri can stop reading cleanly.

## Active Request Families

The live request surface in `cmd/operator` includes:

- `system.*`
- `ai.*`
- `agents.*`
- `sessions.*`
- `context.*`
- `storage.*`
- `kv.*`
- `settings.*`
- `project_settings.*`
- `pinned.*`
- `designs.*`
- `tool.*` and `tools.call`
- `mcp.*`
- `skills.*`
- `hooks.*`

Bridge-backed `space.*` and `browser.*` are not transport request types. They are tools inside the runtime and are documented in [desktop-bridge.md](./desktop-bridge.md).

## Connection Lifecycle

- the server tracks connected clients
- when the last client disconnects, a 15-second idle timer starts
- if no client reconnects before that timer fires, operator shuts itself down

That lets Construct treat operator as an on-demand local sidecar instead of a permanently running daemon.
