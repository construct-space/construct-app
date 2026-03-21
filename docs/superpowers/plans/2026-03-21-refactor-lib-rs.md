# Refactor desktop/src/lib.rs

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan.

**Goal:** Split the 5000+ line `desktop/src/lib.rs` monolith into focused modules.

**Architecture:** Each concern becomes its own module file in `desktop/src/`. The main `lib.rs` becomes a thin orchestrator that registers Tauri commands and initializes state.

---

## Current State (~5000 lines in one file)

| Section | Lines | What |
|---------|-------|------|
| Config & data dir | 1-160 | `construct_data_dir()`, ports, bridge token |
| Bridge server | 160-460 | HTTP bridge for operator → frontend communication |
| Context/Operator | 460-900 | TCP connection to operator, spawn, dispatch, stream |
| LSP management | 500-760 | Language server start/stop/message routing |
| Shell commands | 800-1150 | `run_shell_command`, `spawn_shell_command`, process management |
| PTY management | 1150-1410 | Terminal PTY spawn/write/resize/kill |
| LSP install | 1410-1450 | `lsp_install_server` |
| Browser tabs | 1450-1850 | Browser webview create/navigate/close/bounds |
| OAuth | 1850-2100 | Anthropic OAuth PKCE flow |
| Construct DEV | ~2100-2300 | Spawn/navigate dev instance |
| App menu | ~2300-2500 | macOS menu bar construction |
| Operator spawn | ~2500-2700 | `resolve_operator_path`, `start_context_service` |
| Stream handling | ~2700-3000 | `operator_stream`, `operator_stop_stream` |
| Screenshot | ~3000-3200 | Screenshot capture for Construct DEV |
| Mouse/input | ~3200-3400 | Mouse move/click automation |
| App lifecycle | ~3400-5000 | `run()`, setup, shutdown, window state |

## Target Structure

```
desktop/src/
  lib.rs              ← thin: imports modules, registers commands, calls run()
  app.rs              ← app lifecycle: run(), setup, shutdown, window state, menu
  config.rs           ← data dir, ports, dev mode detection
  operator.rs         ← spawn operator, TCP connection, dispatch, stream
  bridge.rs           ← HTTP bridge server (operator → frontend)
  browser_bridge.rs   ← existing (browser DOM automation)
  browser.rs          ← browser tab management (create, navigate, close, bounds)
  lsp.rs              ← LSP server management (start, stop, message, install)
  pty.rs              ← PTY session management (spawn, write, resize, kill)
  shell.rs            ← shell command execution (run, spawn, kill, input)
  oauth.rs            ← Anthropic OAuth PKCE flow
  dev_instance.rs     ← Construct DEV spawn/navigate/screenshot
  automation.rs       ← mouse move/click, screenshot
```

## Approach

1. Extract each section into its own module file
2. Move state types (`ContextState`, `LspState`, `PtyState`, etc.) into their module
3. Keep `SharedXxxState = Arc<Mutex<XxxState>>` pattern
4. `lib.rs` just registers all commands and manages Tauri app builder
5. Each module exports its `#[tauri::command]` functions

## Priority

High — this blocks other desktop refactoring and makes the codebase intimidating for new contributors.
