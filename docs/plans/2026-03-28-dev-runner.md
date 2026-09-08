# Dev Runner Component

> **Status (2026-04-20):** Partial. Bash-output detection of dev servers exists,
> but no dedicated `DevRunner.vue` / `useDevRunner.ts` / `runner.*` IPC route.
> The preview-in-Construct-webview part and toolbar teleport are unbuilt.
> Voice concerns that leaked into this doc have moved to
> `archive/VOICE_PIPELINE_PLAN.md`. Re-scope before picking up.

## Idea

A runner panel for the coder space that manages dev servers and previews.

## Requirements

- **Start/Stop** — button to start the dev server (`bun run dev`, `python3 -m http.server`, etc.)
- **Status** — show running/stopped, port, URL
- **Open in Browser** — opens the dev URL in system browser
- **Open in Construct** — opens in a Construct webview window (like the assistant standalone window)
- **Toolbar teleport** — when a dev server is running, a compact "Open Preview" button appears in the top toolbar, accessible from any page
- **Auto-detect** — when the coder starts a dev server via bash tool, the runner detects it and shows the UI automatically
- **Process lifecycle** — kill the server when navigating away or closing the project

## Architecture

### Backend (operator)
- New module or extension to `tool/`: detect running dev servers from bash tool output (port regex)
- Track active dev server per project: `{ projectPath, port, url, pid }`
- Expose via `runner.status` / `runner.start` / `runner.stop` requests

### Frontend
- `frontend/spaces/coder/components/DevRunner.vue` — the panel component
- `frontend/composables/useDevRunner.ts` — shared state for toolbar teleport
- Uses Vue `<Teleport to="#toolbar-actions">` when server is running
- Listens for `tool_result` events that contain port/URL patterns

### Desktop (Tauri)
- Open preview in webview window via existing window management
- Kill process on project close

## Reference Implementation

The `space-code` repo already has full run controls:
- `components/RunControls.vue` — toolbar with run/stop/restart, device selection, responsive preview
- `components/Run.vue` — VS Code-like run configuration panel
- `composables/useProjectRunner.ts` — project detection, run configs
- `composables/useProcessManager.ts` — process lifecycle via Tauri IPC
- `composables/useStaticHtmlServer.ts` — static file serving

These depend on Tauri's `run_shell_command` invoke and `@construct/sdk` window management. Extract the shared parts into `@construct-space/sdk` or copy the composables into the coder space.

## Not in scope
- Multi-server support (one server per project for now)
- Build deployment
- Docker/container management
