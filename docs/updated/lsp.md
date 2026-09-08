# LSP Integration — Claude Code vs Construct

  What Claude Code does:

  - Full LSP manager with language server lifecycle management
  - Diagnostics collection across all active servers
  - Go-to-definition, find-references, workspace symbols
  - Auto-detection of installed language servers
  - File sync: notifies LSP on file changes so diagnostics update
  - Background diagnostic polling
  - Multiple concurrent language servers per workspace

  How it is now:

  ┌────┬───────────────────────────────┬──────────────────────────────────────────────────┬──────────────────────────┐
  │  # │ What we built                 │ How it works                                     │ File                     │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  1 │ JSON-RPC 2.0 client           │ Full LSP protocol over stdio. Content-Length     │ lsp/client.go            │
  │    │                               │ framing, request/response with pending map,      │                          │
  │    │                               │ background read loop, 30s request timeout.        │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  2 │ LSP Manager                   │ Routes requests to correct server by file ext.   │ lsp/manager.go           │
  │    │                               │ Lazy connection: server spawned on first request  │                          │
  │    │                               │ for that file type. extMap routes .ts/.go/.py/.rs │                          │
  │    │                               │ to named servers.                                │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  3 │ 4 language servers            │ RegisterDefaults() probes PATH for:              │ lsp/manager.go           │
  │    │                               │ typescript-language-server (.ts/.tsx/.js/.jsx/    │                          │
  │    │                               │ .vue), gopls (.go), pylsp/pyright (.py),         │                          │
  │    │                               │ rust-analyzer (.rs). Only registers if found.    │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  4 │ Go-to-definition tool         │ lsp_definition: takes path + line + character    │ lsp/tools.go             │
  │    │                               │ (1-indexed from agent, converted to 0-indexed    │                          │
  │    │                               │ for LSP). Returns file:line:col locations.        │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  5 │ Find-references tool          │ lsp_references: returns all references to a      │ lsp/tools.go             │
  │    │                               │ symbol. Optional include_declaration param.       │                          │
  │    │                               │ Format: "N references:\n file:line:col" per ref. │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  6 │ Diagnostics tool              │ lsp_diagnostics: collects from all active        │ lsp/tools.go             │
  │    │                               │ servers. Optional path param syncs file before   │                          │
  │    │                               │ collecting. Shows count + error count + rendered │                          │
  │    │                               │ output (capped at 20 items).                     │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  7 │ File sync                     │ SyncDocument(): re-reads file from disk, sends   │ lsp/client.go            │
  │    │                               │ textDocument/didChange + didSave. Auto-opens     │                          │
  │    │                               │ files not yet tracked. Version counter.           │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  8 │ Diagnostic push handling      │ readLoop() processes textDocument/               │ lsp/client.go            │
  │    │                               │ publishDiagnostics notifications. Stores in      │                          │
  │    │                               │ per-URI map with RWMutex.                        │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  9 │ Clean shutdown                │ Shutdown(): sends shutdown + exit, closes stdin,  │ lsp/client.go            │
  │    │                               │ waits up to 3s for process exit, then SIGKILL.   │                          │
  │    │                               │ Manager.Shutdown() stops all servers.             │                          │
  └────┴───────────────────────────────┴──────────────────────────────────────────────────┴──────────────────────────┘

  The 3 gaps — Claude Code vs Construct:

  ┌─────┬──────────────────────┬────────┬──────────────────────────────────────────┬────────────────────────────┐
  │  #  │        Gap           │ Impact │            What they do                  │       What we do           │
  ├─────┼──────────────────────┼────────┼──────────────────────────────────────────┼────────────────────────────┤
  │  1  │ Workspace symbols    │ Medium │ workspace/symbol query for finding       │ Not implemented. Agent     │
  │     │                      │        │ classes/functions by name globally.      │ relies on grep for symbol  │
  │     │                      │        │                                          │ search.                    │
  ├─────┼──────────────────────┼────────┼──────────────────────────────────────────┼────────────────────────────┤
  │  2  │ Background polling   │ Medium │ Periodically polls diagnostics so the    │ Diagnostics collected on   │
  │     │                      │        │ agent proactively knows about errors.    │ demand when tool is called │
  │     │                      │        │                                          │ or file synced.            │
  ├─────┼──────────────────────┼────────┼──────────────────────────────────────────┼────────────────────────────┤
  │  3  │ Auto file sync on    │ Low    │ After write_file/edit_file, auto-sync    │ Manual: agent must call    │
  │     │ edit                 │        │ changed files to LSP for fresh diags.    │ lsp_diagnostics with path  │
  │     │                      │        │                                          │ param after editing.       │
  └─────┴──────────────────────┴────────┴──────────────────────────────────────────┴────────────────────────────┘

---

## Problem → Solution Log

### JSON-RPC 2.0 client — DONE
**Problem:** No code intelligence available to the agent. It relied entirely on grep and manual file reading to understand code structure.
**Solution:** Full LSP client over stdio: Content-Length framed JSON-RPC 2.0 protocol. Request/response with pending channel map (keyed by atomic int64 ID). Background goroutine reads responses and routes to pending channels. 30s timeout per request. 256KB read buffer.
**Files:** `lsp/client.go`

### Multi-server manager — DONE
**Problem:** Workspace might have TypeScript, Go, Python, and Rust files. Need to route each to the right LSP server.
**Solution:** `Manager` with extMap (file extension to server name) and lazy client creation. `RegisterDefaults()` probes PATH for 4 servers: typescript-language-server, gopls, pylsp/pyright, rust-analyzer. Only registers servers that are actually installed. `.vue` files route to TypeScript server.
**Files:** `lsp/manager.go`

### Agent-facing tools — DONE
**Problem:** Raw LSP protocol is too complex for the agent to use directly. Need simple tool interfaces.
**Solution:** 3 tools registered via `RegisterTools()`: `lsp_diagnostics` (workspace-wide errors/warnings), `lsp_definition` (go-to-definition by file:line:col), `lsp_references` (find all usages). All accept 1-indexed positions (natural for agents reading file content) and convert to 0-indexed internally. Results formatted as relative paths.
**Files:** `lsp/tools.go`

### Concurrency classification — DONE
**Problem:** LSP queries are read-only but might be classified as exclusive, slowing parallel execution.
**Solution:** All 3 LSP tools (lsp_diagnostics, lsp_definition, lsp_references) classified as `ConcurrencySafe` in `DefaultConcurrency` map. They can run in parallel with other safe tools during streaming execution.
**Files:** `tool/concurrency.go`
