# Changelog

## [0.7.0] — 2026-03-29

### Added
- **OpenRouter provider** — Free model discovery, capability badges, and LLM settings overhaul
- **OAuth providers** — Anthropic, OpenAI Codex, GitHub Copilot, Google Gemini OAuth login flows with branded callback page
- **Space widgets system** — Dashboard widgets: Pinned Projects (4x4, 4x2), Deploy Status, Quick Open, Project Stats, Vibe/Architect 1x1 shortcuts. Drag-to-move, auto-downsize, swap overlap protection
- **Space actions framework** — Graph integration, space bridge, and space action tools in operator
- **Superpowers skills** — Brainstorming, planning, TDD, debugging, and verification skills embedded in Architect and Vibe agents
- **Oracle agent** — General chat agent (cookie icon), session persistence, centered chat UI, slideover sessions panel
- **Architect redesign** — Asks questions first, auto-scroll on stream, tool status, Open Project button. Context-aware empty state with project files sidebar
- **Vibe split UI** — Text narration on left, tool activity on right. Auto-start from project context
- **Smart doc builder** — Detects project type (game/space/app/landing/api), writes appropriate docs
- **Agent block types** — Question, plan, tasklist, progress, table, json, action, link, diff blocks with clickable choice buttons
- **Per-project colors** — Folder icons with unique colors on project cards

### Changed
- **Vibe → Coder** — Replaced Vibe with clean autonomous coding agent. Enforces implementation after planning
- **Agent naming** — Oracle (brainstorm), Architect (planning), Coder (execution). Removed Agent Smith label
- **Operator modular architecture** — Extracted handlers into domain modules: stream, front, context, state, session, tool, MCP. Ordered request router, runtime container, bootstrap helpers
- **Operator entrypoint** — Moved from `operator/cmd/operator/` to `operator/main.go`
- **Desktop refactor** — Split `lib.rs` (5881 lines) into 12 focused modules. Removed 10 unused Tauri plugins
- **Project layout** — Flat structure (no `.construct/`, no `code/` subdir). Frontend configs moved into `frontend/`
- **Architect agent** — Follows Superpowers pattern: brainstorm → bite-sized plan → coder goals. Restricted to planning-only tools
- **Sandbox security** — All tools sandboxed to project root with `guardPath`. Bash path guard hook, `~/ConstructProjects` allowlist
- **Sub-agent streaming** — Parent stream forwarded to sub-agents so spawned agent progress is visible in UI
- **Project detail page** — Two-column layout with file tree sidebar, README rendering, docs list with clickable preview modal

### Fixed
- **Operator orphans** — Operator self-terminates when parent Construct app dies
- **OAuth token exchange** — Routed to accounts service, fixed shared callback page
- **Splash screen flash** — No longer flashes login page by trusting persisted auth state
- **Anthropic OAuth streaming** — Was losing text content after tool calls
- **MCP panic** — Added panic recovery to background connect
- **Error display** — Parse JSON errors into human-readable key-value pairs, increased text contrast

## [0.6.7] — 2026-03-26

### Changed
- Externalize `@tauri-apps/api/window` in build for UI useTheme
- Upgrade UI to 0.3.5, rename `paasUrl` to `graphUrl`, use SDK theme

## [0.6.6] — 2026-03-25

### Fixed
- HomeGrid layout fixes
- Direct enrollment API call instead of opening browser

## [0.6.5] — 2026-03-25

### Fixed
- **Operator startup blocked by MCP** — MCP servers now connect in background instead of blocking port binding. Unreachable servers no longer prevent the operator from starting
- **MCP add/enable hangs UI** — `mcp.add` and `mcp.enable` return immediately, connect in background goroutine with 60s timeout
- **UIcon not resolved** — Replaced `UIcon` with auto-imported `Icon` component in toolbar and breadcrumb

### Changed
- **Native traffic lights** — Replaced custom HTML traffic light buttons with native macOS window controls via `tauri-plugin-decorum`. Proper fullscreen, hover icons, and position persistence through fullscreen transitions
- **Toolbar redesign** — DS-aligned toolbar with rounded-right corners, inset margins, surface background, proper `toolbar-btn` styling from design system. Breadcrumb uses chevron separators and space icon
- **No toolbar on home** — Hidden on dashboard since it has no actions
- **Settings cleanup** — Merged System + Updates into "General" with tabs. Removed Shortcuts (built-in spaces only), Browser Automation (fully automatic). Reordered: General above Appearance
- **Profile settings** — Replaced inline form with link to accounts.construct.space. Delete Account opens account portal
- **Developer enrollment** — Replaced toggle with server-side enrollment via developer.construct.space. Shows enrolled/pending/not-enrolled states
- **System info** — Added Operator and Desktop Bridge connection status, hostname, locale, architecture, session uptime. Removed operator version (now bundled)

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
