# Desktop Integration — Claude Code vs Construct

  What Claude Code does:

  - CLI-only: runs in the terminal
  - Bridge for remote sessions (web UI connecting to local CLI)
  - Custom terminal renderer: React-based Ink with Yoga flexbox, virtual scrolling, ANSI diff
  - CSI u input parsing for mouse support and text selection
  - No native desktop app, no code editor, no TTS

  How it is now:

  ┌────┬───────────────────────────────┬──────────────────────────────────────────────────┬──────────────────────────┐
  │  # │ What we built                 │ How it works                                     │ File                     │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  1 │ Tauri 2 native app            │ Rust-based Tauri 2 shell. Spawns Go operator as │ desktop/src/lib.rs       │
  │    │                               │ sidecar. IPC bridge between frontend (Vue 3)    │                          │
  │    │                               │ and operator (TCP on port 60100).               │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  2 │ Vue 3 frontend                │ Full SPA: components auto-imported, Pinia stores │ frontend/main.ts         │
  │    │                               │ composables with use- prefix, hash-based routing │ frontend/router/         │
  │    │                               │ with auth guards. Vite dev server on :60200.     │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  3 │ Monaco code editor            │ Built-in code editor space with file tree,       │ frontend/spaces/         │
  │    │                               │ Monaco editor, and integrated terminal.          │ code-editor/             │
  │    │                               │ Full syntax highlighting, intellisense.          │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  4 │ Space ecosystem               │ Plugin architecture: spaces are Vue 3 IIFE       │ frontend/spaces/         │
  │    │                               │ bundles that load into the host app. Each space  │ desktop/tauri.conf.json  │
  │    │                               │ gets its own manifest, pages, navigation, agent  │                          │
  │    │                               │ config. Marketplace distribution.                │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  5 │ TTS (text-to-speech)          │ Native text-to-speech for agent responses.       │ frontend/composables/    │
  │    │                               │ Configurable voice, rate, pitch.                 │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  6 │ Operator client               │ Stream-based communication: frontend subscribes  │ frontend/operator/       │
  │    │                               │ to operator events (text_delta, tool.call,       │                          │
  │    │                               │ tool.result, status, done). useAgentSession      │                          │
  │    │                               │ composable manages session lifecycle.             │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  7 │ Agent session UI              │ Chat interface with streaming rendering.          │ frontend/operator/       │
  │    │                               │ Markdown rendering. Tool call/result display.    │                          │
  │    │                               │ Session history. Multi-turn conversations.        │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  8 │ Native window management      │ Tauri window config: size, min-size, titlebar,   │ desktop/tauri.conf.json  │
  │    │                               │ decorations. Platform-specific (macOS/Win/       │                          │
  │    │                               │ Linux).                                          │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │  9 │ Bridge listener               │ Port 60101: accepts external connections for     │ desktop/src/lib.rs       │
  │    │                               │ operator control from CLI or other tools.         │                          │
  ├────┼───────────────────────────────┼──────────────────────────────────────────────────┼──────────────────────────┤
  │ 10 │ Data directory alignment      │ desktop/src/lib.rs and frontend/lib/appPaths.ts  │ desktop/src/lib.rs       │
  │    │                               │ must stay aligned for data dir paths. Sessions,  │ frontend/lib/appPaths.ts │
  │    │                               │ memory, projects all use consistent paths.        │                          │
  └────┴───────────────────────────────┴──────────────────────────────────────────────────┴──────────────────────────┘

  The 1 gap — Claude Code vs Construct (where they're ahead):

  ┌─────┬──────────────────────┬────────┬──────────────────────────────────────────┬────────────────────────────┐
  │  #  │        Gap           │ Impact │            What they do                  │       What we do           │
  ├─────┼──────────────────────┼────────┼──────────────────────────────────────────┼────────────────────────────┤
  │  1  │ Terminal renderer    │ Low    │ Custom React-based Ink renderer with     │ Vue 3 web renderer. No     │
  │     │                      │        │ Yoga flexbox, virtual scrolling, ANSI    │ terminal TUI. Different    │
  │     │                      │        │ diff. Optimized for terminal.            │ trade-off: full GUI.       │
  └─────┴──────────────────────┴────────┴──────────────────────────────────────────┴────────────────────────────┘

  What Construct has that Claude Code does not:

  ┌─────┬────────────────────────────┬───────────────────────────────────────────────────────┐
  │  #  │ Feature                    │ Description                                           │
  ├─────┼────────────────────────────┼───────────────────────────────────────────────────────┤
  │  1  │ Native desktop app         │ Tauri 2 + Vue 3. Not a CLI in a terminal.             │
  │  2  │ Built-in code editor       │ Monaco with file tree, syntax highlighting, terminal. │
  │  3  │ Space plugin ecosystem     │ IIFE bundles, marketplace, manifest-driven nav.        │
  │  4  │ TTS                        │ Text-to-speech for agent responses.                    │
  │  5  │ Multi-provider UI          │ Provider/model selection in the GUI.                   │
  │  6  │ Visual agent sessions      │ Chat UI with streaming, tool results, markdown.        │
  └─────┴────────────────────────────┴───────────────────────────────────────────────────────┘

---

## Problem → Solution Log

### Tauri 2 native shell — DONE
**Problem:** Claude Code is CLI-only. Users without terminal experience can't use it. No GUI for model selection, session management, or settings.
**Solution:** Tauri 2 desktop app wrapping a Vue 3 frontend. Rust handles native concerns: window management, operator sidecar lifecycle, IPC bridge. Go operator handles AI logic. Clean separation: desktop (native) / frontend (UI) / operator (AI).
**Files:** `desktop/src/lib.rs`, `desktop/tauri.conf.json`

### Monaco code editor space — DONE
**Problem:** Users switch between their code editor and the AI agent. Context switching wastes time.
**Solution:** Built-in code editor space with Monaco (VS Code's editor engine). File tree, syntax highlighting, multiple tabs. Integrated terminal. Agent can reference files the user is editing. Space architecture means it loads as a plugin.
**Files:** `frontend/spaces/code-editor/`

### Space plugin architecture — DONE
**Problem:** Hard-coded features limit extensibility. Users want custom tools, dashboards, and workflows.
**Solution:** Spaces are Vue 3 IIFE bundles with a manifest (identity, pages, navigation, agent config). They load into the host app at runtime. SDK provides composables for auth, storage, operator, toolbar. UI library provides 60+ components. Marketplace distribution. CLI for scaffold/build/dev/publish.
**Files:** `frontend/spaces/`, `desktop/tauri.conf.json`

### Stream-based operator communication — DONE
**Problem:** Traditional request-response doesn't work for AI agents that stream responses and execute tools mid-turn.
**Solution:** Event-based stream protocol: text_delta, tool.call, tool.result, status, done, task.spawned, task.progress, task.complete, permission.mode. `useAgentSession` composable manages subscription lifecycle. Frontend renders events in real-time.
**Files:** `frontend/operator/`
