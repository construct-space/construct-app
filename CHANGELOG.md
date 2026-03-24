# Changelog

## [0.6.4] — 2026-03-24

### Fixed
- **Clipboard shortcuts** — Restored `tauri-plugin-clipboard-manager` so Cmd+V / Ctrl+V works (removed in 0.6.2 by mistake)
- **Data directory paths** — Telemetry DB, settings store, and all fallback paths now use centralized `~/Library/Application Support/Construct` instead of old bundle-ID-based `space.construct.personal` path
- **Auth storage** — Single source of truth: `auth.json` in data dir. Consolidated from 4 locations (localStorage, Tauri store, SQLite, file) to one
- **OAuth callback page** — Removed broken Close button, shows "{Provider} connected in Construct" with provider name
- **GitHub Copilot crash** — Device code polling no longer blocks main thread (was "Application Not Responding"). Non-blocking poll every 5s. Detects existing `gh` CLI auth from `~/.config/gh/` + keychain
- **Switch component** — Replaced reka-ui SwitchRoot (broken controlled mode) with plain HTML implementation
- **Projects root** — Operator now reads user-configured projects root via `CONSTRUCT_PROJECTS_ROOT` env var instead of hardcoded `~/ConstructProjects`
- **API client** — Consolidated `useSource` into `useApi` — single API client, token from auth store

### Changed
- **Onboarding** — Simplified to welcome screen with AI provider connect buttons (Claude, ChatGPT, Gemini, Copilot). Projects dir auto-set. Construct identity: "your operating environment that loads the spaces you need"
- **Developer Mode** — New toggle in Settings > Developer (disabled by default). Gates: projects sidebar button, CLI tools, Construct DEV, environment runtimes. Settings stored in `developer.json`
- **Developer settings** — 3 tabs: Developer (CLI, version, DEV instance, updates), Environment (runtime detection moved from System), Projects (directory, external paths)
- **Naming** — Oracle → Chat, Agent Smith → Vibe. Removed all Matrix references from UI, manifests, agent prompts, and breadcrumbs
- **Sidebar** — Chat button added under logo (always visible). Projects button only in developer mode
- **Project page** — Hero empty state with 4 start paths: New Project, Open Folder, Let's Plan (Architect), Let's Code (Vibe). Tooltips explain each path
- **System settings** — Simplified (removed Environment tab, moved to Developer)

### Known
- Tauri still creates empty `~/Library/Application Support/space.construct.personal/` due to bundle identifier — will be changed in 1.0.0

## [0.6.3] — 2026-03-23

### Fixed
- Operator not found in release: check bare name first (Tauri strips target triple)
- Trailing comma in capabilities JSON

### Added
- Auto-update artifacts (.tar.gz + .sig) via `createUpdaterArtifacts`

### Changed
- Hide global shortcuts tab (requires accessibility permission)
- Remove `tauri-plugin-window-state` — app stays open, center on launch
- Remove `tauri-plugin-single-instance`

## [0.6.2] — 2026-03-22

### Changed
- Remove auto-install spaces — user manages spaces
- Project cards: show path relative to ~/, no truncation
- Project cards: remove spaces count, hide "Never" timestamp

### Fixed
- Build loop: `beforeBuildCommand` builds frontend only
- Mic in dev mode: wrap dev binary in .app bundle for TCC permissions
- Dev runner path: use absolute $PWD path
