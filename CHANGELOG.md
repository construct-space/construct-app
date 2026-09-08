# Changelog

## [1.2.15] — 2026-06-05

### Fixed

- **Assistant panel froze mid-stream, then dumped the whole reply at once.** `useBrainSession.send()` closed the stream handlers over the raw `turn` literal and mutated it in place via `appendText`/`upsertTool`; Vue never tracked those per-token writes, so `ResponseBlocks` only repainted when the turn flipped to `done`. It now operates on the reactive turn from `turns.value` (the same pattern builder/space-developer already use), so the panel streams token-by-token. Also narrowed the streaming option-stripping regex so normal bullet/numbered lists stream instead of being held back until done.
- **Dev app booted to a blank screen with "A TLS error caused the secure connection to fail."** `index.html`'s `upgrade-insecure-requests` CSP (kept for production image loading) rewrote the Vite HTTP dev server's own `main.ts` / client requests to `https`, which it can't serve. A dev-only `transformIndexHtml` plugin now strips that meta during `vite serve`; the production build is unchanged.
- **21 frontend component tests failed under the bun + vitest test runner.** `@construct-space/ui` and `@vue/test-utils` each resolved their own copy of Vue, giving two `@vue/runtime-core` instances with separate `currentRenderingInstance` — so mounting a UI `<Card>` crashed in `renderSlot` ("Cannot read properties of null (reading 'ce')") and cascaded across browser/toolbar/provider/BlockRenderer tests. The test config now inlines both libraries and pins every Vue entry to the one copy the renderer uses.

### Changed

- **Frontend dead-code cleanup + fallow baseline.** Removed 14 unreachable source files and 3 orphaned tests (verified by import-site checks, typecheck and the full suite), and added `.fallowrc.jsonc` so the analyzer reports an accurate 0% dead-files / corrected dead-exports baseline (declares both Tauri HTML entries, test files, and the runtime `__CONSTRUCT__` SDK surface).

## [1.0.13] — 2026-05-07

### Added

- **Error stacks ship to telemetry-api** alongside the existing daily counter, so we stop seeing "230 not_supported_error/day" with no idea where they come from. New `POST /api/errors` endpoint on telemetry-api accepts one event per request with `source` (`frontend` | `operator` | `desktop`), `severity`, `error_class`, `message`, sanitized `stack`, and platform fields. Server fingerprints each event (sha256 of class + first 3 stack frame names) for grouping; admin queries: `GET /api/admin/error-events` (detail) and `GET /api/admin/error-events/groups` (top-200 by fingerprint). Client-side path sanitization (`/Users/<x>`, `/home/<x>`, `C:\Users\<x>`, `C:/Users/<x>` → `<HOME>`) before send; server runs the same regex as defense in depth. Message truncated to 500 chars, stack to 4000.
- **Frontend error reporting wired through `errorTracker`.** Vue render errors, `window.error`, and `unhandledrejection` now forward the original Error (with stack) via the new `trackErrorEvent` composable. The existing `trackErrorClass` aggregate counter still fires on the same path so dashboards keep their daily totals. Source-tagged classes (`type_error.toolbar3d`) introduced earlier this release continue to flow through.
- **Go panic capture in the operator.** `transport.SetPanicReporter` is now wired to the telemetry module on boot — every recovered handler panic ships a `go_panic.<context>` event with the full debug.Stack(), in addition to the local log. Async dispatch so a slow telemetry-api can't extend the crash window.
- **Rust panic capture in the desktop process.** `panic_report::install()` registers a global panic hook that writes panic info + a sanitized backtrace to `<base_dir>/desktop_panics.jsonl` (one JSON line per event so a power-loss in the middle leaves a recoverable suffix instead of corruption). The operator drains the queue on its next start and ships each entry to telemetry-api. Idempotent install, preserves the previous hook so dev-mode panics still print to stderr. RFC3339 timestamps formatted without pulling in `chrono` — bare `std::time` + the Howard Hinnant Y/M/D algorithm — to keep the desktop binary tidy.

### Fixed

- **Architecture label said "Apple Silicon (arm64)" on Windows-on-ARM.** The 1.0.12 attempt used Node-style platform strings (`darwin` / `win32`) but `@tauri-apps/plugin-os::platform()` returns `'macos'` / `'windows'` / `'linux'` / `'ios'` / `'android'`. SystemSettings now matches against the right values, distinguishes Windows-on-ARM and Linux ARM64 from Apple Silicon, and drops the misleading "Intel" prefix on non-mac x86_64.
- **`unused_imports` warning on Windows + Linux Tauri builds.** `desktop/src/browser_bridge.rs` had an unconditional `use base64::{engine::general_purpose::STANDARD, Engine};` whose only consumer is the `#[cfg(target_os = "macos")]`-gated `image_file_data_uri` helper, so non-mac compiles emitted a warning every time. Gated the import behind the same cfg.

## [1.0.12] — 2026-05-07

### Added

- **`navigate_space` tool — General agent hands off to installed Spaces instead of trying to answer cross-Space.** Registered alongside the existing `space_*` bridge tools; takes `space_id` (required, must come from `space_list_installed`), optional `page`, optional `prompt`. The bridge handler calls `navigateToSpace` and forwards `prompt` as `?q=` so the destination Space's agent can pick up the user's original question. `general.md` rewritten: when a user asks about something a dedicated Space already handles ("meetings today" → Calendar, "my tasks" → Board), General lists installed Spaces, picks the matching `id`, and calls the tool — no narration, no preamble, the tool call IS the response. Replaces the brittle output-convention path (`{spaceId, openMode:'space'}` action block) where the model would frequently emit raw JSON inside markdown fences and the chat would render it as a code box instead of navigating. Tool-shaped reasoning sidesteps schema coercion, fence-parsing, and normalization gymnastics entirely.

### Fixed

- **Synthetic `StructuredOutput` tool calls were leaking as "unknown tool" cards in chat.** When the runner used the tool-based structured-output fallback (Claude Code's pattern: model calls a fake tool whose input schema IS the desired output schema), the synthetic tool was injected into the per-run `agentTools` slice but the dispatcher in `tool_exec.go` only consulted the global `r.tools` registry. The lookup missed, the call surfaced as a red "unknown tool: StructuredOutput" tool result, and the user saw the entire envelope JSON inlined as the tool input. Fix: `RunRequest` now carries a per-run `runTools` field populated at setup (and updated when synthetic injection happens mid-run via `enableSyntheticOutput`); the dispatcher falls back to it when the global registry misses. Both stream paths (streaming + non-streaming) also skip emitting `tool.call` / `tool.result` events for `SyntheticOutputToolName` so the synthetic mechanism stays invisible to the UI even when validation fails and a retry is needed.
- **`assistant.v1` schema retries thrashed on common model drift.** Models routinely emit `{"type": "text", "text": "…"}` blocks (the canonical schema only allows `markdown` / `list` / `steps` / `kv` / `action`) or shove the entire response into `content` as a plain string. The runner's `validateStructuredOutput` would fail, retry up to 5×, and ultimately give up showing the raw envelope JSON in chat. Two-layer fix: (1) `coerceAssistantV1` now reshapes the parsed JSON before validation — `content: "string"` → `{ blocks: [{type:'markdown', text}] }`; `{type:'text'}` blocks → `{type:'markdown'}`; (2) the JSON Schema itself accepts `text` as an alternative discriminator alongside `markdown` so even un-coerced responses validate. Frontend `assistantContentBlockSchema` mirrors the same coercion via `z.preprocess` so the renderer treats both shapes identically. Retry nudges now include the actual schema text (`structuredOutputNudgeWith`) so the model can self-correct instead of guessing the same wrong shape five times in a row.
- **Action-block JSON inside markdown text rendered as raw text instead of buttons.** When `assistant.v1` content arrived with an `action` block embedded inside a markdown block's `text` (either inline or wrapped in a ```` ```json ```` fence), `normalizeContentBlock('markdown')` returned a plain text block and the JSON showed up unformatted in chat — no clickable button, no auto-fire on `auto: true`. `parseEmbeddedStructuredBlocks` now peeks inside fenced code blocks and lifts liftable JSON out (envelope or action), so a single `markdown` block can split into prose + button + prose. `normalizeContentBlock` returns `ResponseBlock[]` instead of a single block; callers `flatMap` instead of `map`.
- **`No automation provider registered for space: tetris` errors on every operator turn.** `preloadSpaceActions` only registered a lazy `AutomationProvider` when `manifest.actions` was non-empty, so spaces that are pure UI (Tetris, viewers, games) never got one — and any operator call to `space.snapshot` or `space.list_actions` for them threw, surfacing as `handler_error` in the operator log on every turn. `bridgeListener.ts` now returns an empty/minimal response when no provider is registered for snapshot + list_actions (a space with zero actions is a valid state, not an error); `space.run_action` still errors since running a non-existent action is a real bug. Test updated.

### Changed

- **Action block accepts `spaceId` / `page` / `openMode: 'space'` for in-app navigation targets.** `frontend/assistant/schema.ts`, `frontend/assistant/blocks.ts`, `frontend/assistant/normalize.ts`, and the Go `assistantV1Schema` all extended together. `AssistantPanel.executeAction` and `AskPage.handleAction` recognize the new shape and call `navigateToSpace({spaceId, page?, query: {q: lastUserPrompt}})`. The auto-fire watcher (previously gated on `action.url`) now also fires on `spaceId`-only actions. Kept as a fallback path even though `navigate_space` is now the preferred route — any space or agent that emits the action block continues to work.
- **`navigateToSpace` vs `openTargetInSpace` clarified.** `navigateToSpace({spaceId, page?, query?})` is the right call for "drop the user on this Space's main page" (what the new `navigate_space` tool does); `openTargetInSpace({spaceId, target, …})` runs space-registered open-handlers and is for "open this *specific item* inside Space X" (a particular calendar event by ID, a particular board ticket).
- **Org workspace pages and SystemSettings minor polish.** Org pages drop the `max-w-5xl mx-auto` centering wrapper for a full-width layout to match the rest of the workspace. SystemSettings distinguishes Windows-on-ARM from Apple Silicon in the architecture label (was lumping all `aarch64` as "Apple Silicon").

## [1.0.0] — 2026-05-01

**Public release.** After 19 internal cuts, Construct ships its first stable, publicly-distributed build. The desktop app, the marketplace, and the published CLI/SDK packages now follow semantic versioning under a single 1.0 contract — breaking changes from here go through deprecation cycles, not surprise patches.

### Added

- **Builder agent — full autonomous loop for any project (not just Construct Spaces).** Plans, executes, and verifies in one continuous loop covering landing pages, sites, apps, CLIs, scripts. Loads `builder:stack` / `builder:contracts` / `builder:go` / `builder:frontend` / `builder:game` / `builder:plan` / `builder:verify` / `builder:code-reviewer` skills on demand instead of stuffing them all into the system prompt; the SkillsMenu chip in the toolbar now lists only what was loaded this session. Skill bodies are markdown the agent treats as mandatory rules — `code-reviewer` runs before reporting any non-trivial change as done; `contracts` reads real APIs before guessing; `verify` runs the project's typecheck/build/test plus a behaviour probe. If a project's stack has no built-in skill, the agent offers to generate one to `.construct/skills/<name>.md` and load it on the spot.
- **`start_preview` tool — one-click run for any project type.** Agent calls it; the host detects whether the project is a JS/TS dev server (Vite, Next, Astro), a Go HTTP server (`go run .`, including stdlib `net/http` projects with no framework dep), a Python server (Flask/Django/FastAPI), Rust (Axum/Actix), or a static site, spawns the right command, picks up the URL from stdout, and opens the in-app browser. Builder agents no longer have to tell the user "click Preview" — they trigger the preview themselves.
- **Visual verification via `list_windows` + `screenshot_window`.** Agents enumerate Tauri-managed webviews (main, preview, browser, runner) by label and capture any of them inline. The result includes both a `path` for byte-level chains (vision uploads, image diffs) and a `data_uri` rendered immediately in the chat — fastest "did the page actually render?" check we have. Replaces an entire family of "is the layout broken?" mental walkthroughs with a thumbnail.
- **Tasks panel in the Builder sidebar.** `task_create` / `task_update` calls during a turn populate a live task list above the file explorer — the agent's own todo list, surfaced. Survives session resumes (the operator replays existing tasks as `task.created` events on reconnect, sorted by ID so order is deterministic).

### Changed

- **Default capabilities locked down for shipped binaries.** Removed the wildcard window/webview allowlist (`browser-*`, `tab-*`, `runner-*`, `preview-web-*`, …) and replaced it with a tight enumerated list. Removed `shell:allow-spawn` and the 25-command `shell:allow-execute` allowlist (`tar`/`curl`/`git`/`gh`/`bun`/`npm`/`cargo`/`go`/`docker`/`make`/…) from the default capability — the renderer no longer has the broad shell surface those entries opened up. Browser windows get their own `browser.json` capability with a scoped permission set instead of inheriting the kitchen-sink default.
- **`fs:scope` narrowed to the app data dir + project paths.** Was `$HOME`, `$HOME/**`, `$HOME/.*`, `$HOME/.*/**`, `$HOME/**/.*`, `$HOME/**/.*/**`, `/Volumes/**`, `/Volumes/**/.*`, `/Volumes/**/.*/**` — i.e. every dotfile, SSH key, AWS credential, browser profile, and external volume on the disk. Now restricted to: the platform app-data dir (`$HOME/Library/Application Support/Construct/**` on macOS, `$HOME/.local/share/construct/**` on Linux, `$HOME/AppData/Roaming/Construct/**` on Windows), `~/ConstructProjects/**`, `$DOWNLOAD/**`, `$DESKTOP/**`, and `/tmp/**`. Spaces and the renderer can no longer read arbitrary disk locations.
- **OAuth callback page redesigned in the Construct visual language.** The localhost bounce-back page after Anthropic / Codex / Gemini sign-in now matches the desktop app: slate-900 canvas, slate-800 surface, the iconic red (`#E63946`) accent, the signature `WORD.` title pattern with the period rendered in the accent colour, uppercase tracking-wide section labels, the red CTA close button. Single source of truth for all four providers — Claude OAuth, Anthropic API, Codex, Gemini — so the bounce experience is uniform.
- **Per-page UI polish across the Org workspace.** Members / Roles / Departments / Invitations / Activity now follow one card pattern: counts inline in the title (`Members (12)`, `Roles & permissions (6)`) instead of a duplicated `6 ROLES` accessory; admin-only Invite affordances live in the page header; `OrgActivity` paginates server-side and decodes the `{ data, total }` envelope correctly; `OrgProjectDetail` matches local folders to org-prefixed remote repos via suffix (e.g. `construct-website.git` ↔ `~/Construct/api/website`) so cloned repos collapse into a single linked entry instead of duplicating as MAIN + LINKED. The Danger Zone card only renders in edit mode.

### Fixed

- **`Card #accessory` slot was silently dropped whenever `#header` was provided.** `@construct-space/ui`'s Card had the accessory `<slot>` nested inside the `#header` fallback, so any consumer overriding `#header` (every page in the org workspace) lost the accessory rendering — the green dot, the count, the action buttons. Moved accessory out of the header fallback into a sibling div in the flex row, shipped as `@construct-space/ui@0.7.4`. Every card across the app now correctly renders both slots.
- **Org-project link persistence didn't survive a refresh.** The local-path mapping was written to raw `localStorage` with an unprefixed key, which read back as empty after a profile init. Migrated to `profileStorage` with the proper profile prefix; the read happens in `onMounted` (after auth has set the active profile ID) and re-registers stored paths through `projectStore.addExternalFolderByPath` so `linkedLocalProjects` finds them in the store on cold load. The "linked" badge sticks across refreshes now.
- **Builder Preview button missed Go stdlib HTTP servers.** Classification looked for framework imports (`gin`/`echo`/`fiber`/`chi`) in `go.mod` / `go.sum` and gave up — but stdlib `net/http` is never in the module graph. The classifier now reads `main.go` directly for `"net/http"` imports and `ListenAndServe`, so plain stdlib Go servers preview correctly instead of falling back to a `package.json` lookup in a sibling subdir.
- **Skills menu listed every built-in skill, not just the ones the agent loaded.** SkillsMenu was driven by `skills.value.filter(s => s.state === 'active')` — but every Builder skill starts as `active`, so the chip showed `Skills: 8` even before the agent did anything. Now driven by a session-scoped set populated from `skill.loaded` stream events — only skills the agent actually pulled in via `load_skill` show up in the menu, and the count resets on chat clear.

### Security

- **Hardened the desktop app surface for public distribution.** The shell IPC stack, the file-system scope, the per-window capability allowlist, and the OAuth flow all received a security pass before tagging. The default capabilities no longer hand the renderer a broad shell + filesystem reach by default; OAuth state validation is uniform across web and Tauri builds; CSP and webview labels are tighter. Detail in the Changed section above and in the `291788b` hardening commit.
- **Removed legacy in-app billing UI that proxied directly to Polar.** The in-app `MediaSettings.vue` flow that talked to `api.polar.sh/v1/checkouts/` from the renderer with a hardcoded org-scoped OAuth token has been removed; checkouts go through the billing API, which holds the credential on the server side.

### Removed

- **Hardcoded org-scoped Polar OAuth token from the bundled frontend** (`MediaSettings.vue:94`). The token has been revoked at polar.sh and rotated server-side.
- **Wide `shell:allow-execute` and `shell:allow-spawn` allowlists** in `capabilities/default.json`. The 25-command allowlist + plugin defaults are gone from the renderer's permission set.
- **`$HOME/**` from `fs:scope`.** See Changed → fs:scope.

## [0.19.5] — 2026-04-30

### Fixed

- **Subprocesses spawned by Construct couldn't find Homebrew / user-installed binaries.** macOS GUI apps inherit the launchd PATH (`/usr/bin:/bin:/usr/sbin:/sbin`) — `.zshrc` / `.bash_profile` never run for Finder-launched apps, so `ffmpeg`, `ffprobe`, `construct`, `bun`, `cargo`, `go`, anything under `/opt/homebrew/bin`, `~/.bun/bin`, `~/.cargo/bin`, `~/.local/bin`, `~/go/bin` was invisible to every subprocess: the operator sidecar, the shell tool, space-shipped binaries (`spaceprobe` and friends invoked via `useSpaceBinary`). The Video space's dependency probe correctly detected `ffmpeg` at `/opt/homebrew/bin/ffmpeg`, but its renderer called bare `ffmpeg` and got "command not found." Patched by `desktop/src/path_env.rs::augment()` which runs first thing in `lib.rs::run()` and prepends the canonical Homebrew + user-bin locations (and only those that actually exist as directories) to `PATH`. Every descendant — Tauri plugins, the Go operator, `space_binary.rs` children, `Command::new` calls — inherits the augmented value. Unix-only; Windows GUI apps already inherit the user PATH from the Environment Variables registry and the `:`-separator implementation would have corrupted Windows-style `C:\…;C:\…` strings.

## [0.19.4] — 2026-04-30

### Added

- **`useSpaceBinary()` — run platform-specific binaries shipped inside a space.** Spaces can now ship native helpers (e.g. `spaceprobe` for video metadata) under `bin/<os>-<arch>/<name>` in their tarball; `useSpaceBinary('name').invoke(args, { stdin, cwd })` resolves the platform-specific path and runs it via the host's `space_binary_invoke` Tauri command. The space-side caller never deals with absolute paths — the host owns resolution and the security boundary: resolved path is canonicalised and verified to still live inside `<profileDir>/spaces/<space_id>/bin/`, guarding against `..` traversal even though space-supplied components aren't accepted today. Picks this over Tauri's built-in `Command.sidecar` because sidecars are bundled at build time (spaces are dynamic plugins installed post-install) and the shell plugin's allowlist is per-command-name (letting any space allowlist any binary defeats sandboxing).
- **`useHttp()` — cross-origin HTTP from spaces.** The Tauri webview blocks `fetch()` to most external origins (CORS, mixed content); `useHttp().fetch(url, init)` wraps the host's `http_fetch` Tauri command, which runs the request in Rust via `reqwest` where those rules don't apply. Supports both UTF-8 `body` and a `bodyBytes: Uint8Array` channel for non-UTF-8 payloads (multipart form-data with file uploads, raw audio/video) — base64-encoded over the IPC boundary, decoded inside `reqwest`.
- **`useDelivery()` — transactional email from spaces.** `@construct-space/sdk` exposes `useDelivery()` matching the Resend / Postmark / Mailgun shape: spaces POST to `api.construct.delivery` directly with the user's `cat_*` Bearer, the delivery service validates against accounts itself (no cross-VPS hop through the gateway). v1 sends From the Construct-owned `construct.delivery` shared domain — a space ships welcome / password-reset / notification mail with no per-user DNS setup and no API key in its bundle. Two call shapes share the same endpoint: `useDelivery().send({ to, subject, html })` and a chainable `.to().subject().html().attach(att).send()` builder. Attachments arrived in SDK 0.7.1; types re-export from `@construct-space/sdk` so existing callers that imported them from the composable keep working.
- **Per-tool + chat telemetry.** `useAgentSession.dispatchStream` emits `trackChat()` at submit and one `trackToolCall(name, success, 0)` per `ToolBlock` at end-of-stream. The operator's Tools table now populates with real builtin tool names (`read`, `edit`, `bash`, `glob`, `grep`, …) instead of staying empty, and Usage's `chats_sent` becomes accurate. Per-tool duration ships as 0 — `ToolBlock` carries no timing today and instrumenting it is a separate pass; count-only is enough to answer "which tools matter."
- **Runtime error capture → `trackErrorClass`.** `frontend/lib/errorTracker.ts` mounts a global handler for `app.config.errorHandler`, `window.onerror`, and `unhandledrejection`, maps each to a stable low-cardinality class (`type_error`, `vue.<class>` for render errors), and forwards to the existing `trackErrorClass()` pipeline. No message or stack ships — class only. Pairs with the operator's `daily_errors` accumulator that flushes hourly to telemetry-api.

### Changed

- **Space wordmark surfaced through `spaceContextBus`.** `useSpaces` / `useSpaceMarketplace` populate the active space's wordmark on load; `HomePage` reads it via the bus and renders it in the header. `SpaceLoader` honours `layout=none` as an escape hatch for spaces that want to render outside the host chrome entirely. Profile storage gains a wordmark slot so the value survives reloads.

## [0.18.1] — 2026-04-23

### Changed

- **Home widgets: flat, typographic redesign.** Rubik dropped the `200` weight (unavailable in the loaded set) and standardised on `300` for display numbers and `600` for accent marks across every shipped widget — `CurrentUser4x2`, `FeedBlock`, `QuickChat2x1`/`4x2`, `DeployStatus2x2`, `PinnedProjects4x2`/`4x4`, `ProjectStats4x2`, `QuickOpen2x1`, `RecentProjects4x2`. `main.css` now loads `Rubik:wght@300;400;500;600;700` only. No icon tiles, no inner surface — kicker + name + quiet status line is the house voice now.
- **Home grid expands in edit mode.** `HomeGrid` splits its ceiling into `gridRows` (visible default, 4 rows) and `gridMaxRows` (expansion, 64 rows). `displayRows` grows to `bottom + EDIT_HEADROOM` while editing so users can drop widgets below the fold; outside edit mode the grid snaps back to the visible height.
- **Telemetry moved to the operator.** `useTelemetry` no longer owns a frontend SQLite store. Every `track*()` call and the Privacy Settings stored-data controls now forward through `send_context_request` → operator's new `internal/telemetry` module, which persists to `telemetry.db` (modernc.org/sqlite) and flushes rollups to telemetry-api on a periodic loop. The Tauri SQL plugin is no longer on the frontend's critical path for event capture.
- **Task replay on session resume.** `DiskTaskStore.SetEmitter` now replays every existing task as a `task.created` event when the stream reconnects, so the sidebar Tasks panel repopulates after a resume instead of silently dropping subsequent `task.updated` events. `useStreamStatus` and `TasksPanel` upsert on update so out-of-order arrivals survive.

### Fixed

- **Task replay order was non-deterministic.** `SetEmitter` built the replay slice by ranging `s.tasks` (a Go map), so `task.created` events fired in a different order every operator restart and the Tasks panel rendered tasks in a scrambled sequence. Now sorted by `ID` before emit — IDs are monotonic via `nextID.Add`, so ID order equals creation order.
- **Feed 5xx cache only matched 500–509.** `BuiltinWidgets`'s error-cache regex was `/\b50[0-9]\b|bad.gateway/i`, which missed 510/511 and the whole Cloudflare 520–527 block (521 web server down, 522 timeout, 524 origin timeout). Cloudflare-fronted deployments looped re-fetching `/feed` on every Home remount during an outage. Widened to `/\b5\d{2}\b/i`; dropped the redundant (and unescaped) `bad.gateway` half.
- **Widget scaffold templates asked for unloaded Rubik weights.** `scaffold/templates/widgets/{2x1,4x1}.vue.tmpl` specified `font-weight: 200` (thin display number) and `font-weight: 800` (accent period), but `main.css` loads 300–700 only. Browsers fell back to the nearest loaded weight or synthesized faux weights, so the intentional thin/heavy contrast the templates were designed around didn't render. Every widget scaffolded via `construct space dev … widget` inherited the mismatch. Swapped to `300`/`600` to match the rest of the dashboard.
- **Widget resize clamped tighter than the picker.** `HomeGrid`'s resize-drag handler clamped `targetH` to `displayRows - item.y` (≈6 rows with a single widget), while `addWidget`/`canPlace` clamped to the full `SPACE_ROWS = 64`. Widgets with `h > displayRows` were unreachable via the drag handle even though the picker placed them fine. Now clamps to `(gridMaxRows ?? gridRows) - item.y` so add and resize share the same ceiling.

## [0.18.0] — 2026-04-22

### Added

- **Live per-model pricing from source, $ per line item.** Operator reads input / output / cache-read / cache-write per-million-token prices from the source catalog (pushed from the frontend via a new `modelspec.load` IPC on every app open, cached to `providers.json` inside the active profile dir). `CostTracker.Record(providerID, model, …)` bills each turn at that turn's model rate, so a session that fails over from Opus → Sonnet no longer prices every turn as Sonnet. The Session Cost popover now renders a `$` column next to every token row, making the dominant line item obvious at a glance (on Opus 4.7 with cache-heavy sessions, `cache_write` often dwarfs `output` — which was invisible when the popover only showed totals).
- **Per-model context window.** The context-gauge event stops hardcoding 200k and reads each model's real ceiling from modelspec. Opus 4.7 shows `1.0M / 1.0M` when the catalog says so; 4.6 rows on a 1M-beta tier honour that too. Char limit tracks `tokens × 4` unless the session's `SnipConfig.MaxContextChars` is explicitly set.
- **Claude 4.7 effort knob.** `provider.Request.Effort` (`"low" | "medium" | "high" | "xhigh" | "max"`) emits as `output_config.effort` on the wire when the model's spec has `accepts_effort: true`. Older models that'd reject the param leave it off. Thinking mode is driven by `request_spec.thinking` (`"none" | "fixed" | "adaptive"`); adaptive omits the `thinking` block entirely since 4.7 drives reasoning through Effort instead.
- **Live `/models` per connector.** Each provider's `ListLiveModels` hits its own `/models` endpoint with the user's stored credentials, so the model picker shows exactly what the caller's plan exposes — no more "pick model X, get a 400 at dispatch" when ChatGPT Plus hides codex variants or MiMo's token plan ships a different catalogue. `useLiveModels` caches per session; dated Anthropic snapshot IDs (e.g. `claude-opus-4-5-20251101`) are filtered so only clean aliases appear.
- **Screenshot bridge (`space.screenshot`, `space.list_windows`).** Operator tools `list_windows` and `screenshot_window` let agents enumerate Tauri-managed webviews (main, space runners, builder, browser shell) and capture any of them to a PNG. macOS today via the existing `screencapture -l <CGWindowID>` helper shared with `browser.screenshot`. Response carries both `path` (for byte-level tools) and `data_uri` (for inline markdown rendering). The ToolCard shows the thumbnail inline and elides the base64 blob from the raw result dump; the assistant-prose renderer rewrites absolute `/tmp/...` image srcs through Tauri's `convertFileSrc` so `![](/tmp/construct-space-*.png)` also renders correctly.
- **Per-provider cards in Settings → Providers.** AnthropicCard / OpenAICard / MiMoCard / CopilotCard / LocalCard + GenericCard fallback, resolved via a registry keyed on provider id. Billing-mode toggles (API key vs Monthly / Token Plan) live in each card's header; OAuth flows (Claude Pro/Max, ChatGPT, Copilot device code, Gemini CLI) share a common `useProviderOAuth` composable.
- **Per-window capture agent affordance.** `screenshot_window`'s tool description tells agents to use `data_uri` for inline display and reserves `path` for tool-chain consumers (vision uploads, image diffs), so agents stop embedding unrenderable `/tmp/...` paths.

### Changed

- **Source is the single authority for pricing + context + capabilities.** Operator's `modelspec.Global` fallback table carries only wire-shape flags (API contracts that don't vary per customer — thinking mode, accepts_effort, accepts_temperature). Every dollar number and context window now comes from the source catalog. Alias pass at load time mirrors `anthropic:*` → `claude-oauth:*` and `openai:*` → `openai-oauth:*` so OAuth connectors resolve to the same catalog entry the API-key connectors do. No more guess-work after the fifth time I got Anthropic's Opus pricing wrong.
- **Modelspec disk cache + IPC load.** Operator no longer polls the source endpoint; the frontend pushes the catalog once per app open, the operator parses into memory and writes `providers.json` inside the profile dir. Next boot reads that file before anything dispatches. Admin-side catalog edits take effect after the user restarts Construct.
- **Adaptive thinking omits the block entirely.** 4.7 rejects `{"type":"enabled"}` without `budget_tokens` with `400 thinking.enabled.budget_tokens: Field required`. `applyAnthropicThinking` now only emits when mode is `fixed` AND a non-zero `BudgetTokens` is provided; adaptive mode passes through with no `thinking` block at all, and 4.7 drives reasoning through `output_config.effort` instead.
- **Haiku alias `claude-haiku-4-5`.** Model id aligned on the stable alias instead of the dated snapshot. The shared Anthropic `/v1/models` fetcher (`anthropic_models.go`) now drops dated-snapshot ids (`/-\d{8}$/`) so only clean aliases surface in the live picker.
- **Operator URLs go through the gateway.** `FetchOrgProviderKeys` + friends call `my.construct.space/api/source` instead of `source.construct.space/api` — source isn't exposed publicly, only through the my.c.s gateway.

### Fixed

- **Opus 4.7 billed as $0** for users signed in via Claude Pro/Max. The operator's `CostTracker` looked up pricing under `claude-oauth:claude-opus-4-7` but the source catalog keys under `anthropic:claude-opus-4-7`, so every lookup missed and the fallback (no pricing, since we stripped fallback prices) returned zero. The new alias-mirror pass at `LoadCatalog` time gives the OAuth key the same spec as the API-key key.
- **Context gauge stuck at 200k on 4.7.** Same root cause — `modelspec.Global.For("claude-oauth", "claude-opus-4-7")` found no context window, so the fallback 200k default was showing even though the catalog said 1M.
- **`anthropic-oauth` connector removed entirely.** Two Anthropic paths now: `anthropic` (API key at console.anthropic.com) and `claude-oauth` (real Claude Pro/Max OAuth via the Claude Code flow). The OpenCode-auto-discovery connector is gone — along with its `auth.anthropic.*` / `auth.oauth.*` handlers, its env-var intake, and its per-turn SSE parser. Stored `anthropic-oauth:` composite model IDs in settings are coerced to `claude-oauth:` on the frontend side so upgrade is transparent.
- **Configured filter includes OAuth + MiMo token-plan users.** Settings → LLMs → Configured was only checking `provider_key:*`; now it also checks `provider_key_monthly:*` (MiMo) and `oauth.providers` connected state (Claude Pro/Max, Codex, Copilot, Gemini CLI).
- **Cost popover no longer hides `cache_write: 0`.** Public catalog cost / limit fields dropped `omitempty`, so a zero price is explicit instead of missing — the difference between "unpriced" and "field not in the response" had been confusing.
- **Model add form dropped to one field.** Wire id only — context window, pricing, capabilities, request_spec all come from the models.dev sync that auto-runs after create. If the sync 404s because models.dev doesn't have that id, the server response now echoes back the full list of available ids for the provider so the admin can retype without leaving oracle.
- **`request_spec` no longer clobbered on sync.** The previous mapping wrote `{"thinking":"adaptive"}` whenever models.dev reported `reasoning: true` — which overwrote hand-set `"fixed"` flags on Claude 4.6 rows every refresh. models.dev's single bool can't distinguish adaptive from fixed, so `request_spec` is now admin-only; sync touches pricing, limits, and capability tags only.

### Removed

- **Hardcoded Sonnet-4 pricing in `internal/harness/cost.go`.** `defaultPricing` map and the fixed `TokenInput / TokenOutput / TokenCacheWrite / TokenCacheRead` constants — the tracker reads prices from modelspec per turn now.
- **`anthropic-oauth` connector + `oauth/anthropic.go` provider.** See above.
- **15-minute HTTP polling of `/api/providers`.** Disk cache + frontend IPC push cover the same job without a background timer.
- **`models.dev` sync in oracle.** Replaced per-provider sync with per-model sync that respects a per-row `locked` flag — admin edits via the Edit drawer flip `locked=true`, and subsequent syncs skip the row until the admin explicitly Unlocks it.

## [0.17.7] — 2026-04-21

### Fixed

- **Guided tour arrow placement.** The chat-bubble arrow now mirrors sides based on where the target sits on screen: right-half targets (dashboard Edit) keep a right-side arrow, left-half targets (sidebar icons, avatar) get a left-side arrow, and the popover extends the other way so it never covers the highlighted element. The arrow tip also aligns on the target's exact centre now (previous maths forgot the arrow's own half-width). Dropped the `filter: drop-shadow` on the triangle that was rendering a boxy ghost behind it, and put the arrow behind the card surface via a scoped stacking context (`isolation: isolate` + `z-index: -1`) so the tail looks like part of the bubble instead of an overlay on top of it.

## [0.17.6] — 2026-04-20

### Added

- **In-app sign-in — password, 2FA, register, forgot/reset, all inline.** The desktop app no longer bounces to the browser for the common case. `POST /api/auth/login` (and `/verify-2fa`, `/api/auth/register`) on the accounts service now mints `cat_*` bearer tokens when the JSON body carries `client_id` — browsers keep the session-cookie flow unchanged. Frontend: new `LoginPage` with email+password, TOTP swap-in on `{ requires_2fa }`, inline `RegisterPage`, `ForgotPasswordPage`, `ResetPasswordPage`. The browser OAuth path stays as a secondary button for passkey users.
- **Biometric unlock (Touch ID / Windows Hello).** Settings → Profile → Biometric unlock toggle stores the access + refresh pair in the OS keychain (via macOS `security` CLI / `keyring` on Linux+Windows) behind a platform biometric prompt. macOS uses `LAContext.evaluatePolicy(DeviceOwnerAuthenticationWithBiometrics)` via `objc2-local-authentication`; Windows uses `UserConsentVerifier.RequestVerificationAsync`. On launch, if enabled, Construct prompts for biometric before any UI appears; on the `/login` page a dedicated "SIGN IN WITH TOUCH ID" button sits next to the "PASSKEY (browser)" button.
- **Explicit logout dialog.** Avatar → Log out now opens a modal with two clickable option cards: "Sign out only" (clears session + biometric/keychain, keeps profile + onboarding + tasks + pinned items) and "Sign out & delete local data" (destructive — also removes the profile directory, profiles.json entry, and per-user localStorage). Replaces the previous silent-logout-then-redirect-to-profile-picker behaviour that was confusing when users had multiple profiles.

### Changed

- **One profile per user — no more `org:<uuid>` row.** `checkOrgMembership` used to create a second profile directory alongside the personal one whenever the user belonged to an org. Now org membership lives in the auth store (`orgId`, `orgName`, `scope`, `roles`) and all callers key off the single `profiles/<accountsUUID>/` directory. `ensureProfileForUser` also gained an email-based dedup pass so the first login after an accounts-UUID cutover renames the existing random-UUID row instead of stacking a new folder next to it.
- **Soft logout keeps the profile on disk.** Clearing the session no longer wipes `profiles.json`, onboarding progress, tasks, or pinned items — signing back in picks up where the user left off. Use "Sign out & delete local data" for the old aggressive behaviour.
- **Login screen layout.** Touch ID + Passkey now sit side-by-side in a single row under the password form ("Password" above, "alternative auths" below), replacing the big primary-CTA-at-the-top Touch ID button. Touch ID only appears when a stored profile has biometric enabled; otherwise the Passkey button fills the row.

### Fixed

- **Windows OAuth handoff finally works.** Browser redirects to `construct://oauth/callback?...` used to spawn a second Construct.exe instead of delivering the URL to the running instance, so users would click Sign in, nothing would visibly happen, and they'd retry indefinitely. Fixed by adding `tauri-plugin-single-instance` with the `deep-link` feature — the new process forwards its argv to the existing window's `onOpenUrl` handler. Also added `app.deep_link().register_all()` under `cfg(linux, debug+windows)` so dev builds register the scheme at runtime.
- **OAuth success page tab auto-closes after deep-link.** `my.construct.space/oauth/code-status` was falling through to the SPA's `index.html` because the gateway only proxied `/api/oauth/*`. Accounts' polling HTML (with its 2s `fetch(...).then(r => r.json())` loop) couldn't parse the SPA shell and silently hung on "Attempting to open automatically…". Gateway now proxies `/oauth/*` to the accounts upstream.
- **`/api/accounts/me/scope` 401 no longer looks like a CORS error.** nginx `@unauthorized` / `@bad_gateway` / `@gateway_timeout` named locations now carry `Access-Control-Allow-Origin` + `Allow-Credentials` (with `always`), so a stale-token response is a clean 401 the SPA can react to instead of a browser-level CORS failure that hides the status.
- **Biometric unlock actually persists tokens on macOS.** The `keyring` crate's `apple-native` backend reported `set_password` success but the entry never landed in the user's default Keychain for ad-hoc-signed Tauri dev builds. Confirmed via `security find-generic-password` returning "item could not be found" right after a supposedly successful write. macOS path now shells to the `security` CLI (same pattern `oauth_read_keychain` already used for Claude Code credentials); Linux + Windows continue through `keyring`.
- **Don't send `refresh_token` as Bearer to `/api/accounts/me`.** `applyBearerTokens`'s second positional slot is the accounts-service access token (legacy naming from the OAuth flow). The direct-login and biometric-unlock paths were filling it with `refresh_token`, so subsequent `fetchProfile` calls sent the refresh token as Bearer and the gateway correctly 401'd. Both paths now pass `null` and let `applyBearerTokens` default to `accessToken`.
- **Touch ID doesn't auto-prompt right after a soft logout.** `authGuard` used to call `hydrateAuthState` whenever `isAuthenticated` was false, including on the `/login` page — which fired a biometric prompt seconds after the user had tapped Log out. Hydrate is now gated on "not on a guest route" (`/login`, `/register`, `/forgot-password`, `/reset-password`). Boot-time auto-prompt is unchanged because it runs through `authStore.initialize` in `bootstrapMain`, not the guard.
- **Stale biometric flag self-heals.** `getBiometricCandidate` now preflights the keychain — if the flag says biometric is enabled but the keychain has no tokens (e.g. a session whose keychain was cleared out-of-band), the stale flag is removed so the Touch ID button doesn't reappear on the next render pointing at a dialog it can't complete. `enableBiometricUnlock` also reads the keychain back after the write and refuses to set the flag if the token didn't actually land.

## [0.17.5] — 2026-04-20

### Added

- **Cancel button for OAuth provider login** — Settings → LLM providers now shows a Cancel next to the spinning Login, mirroring what the GitHub Copilot device-code flow already had. If the browser opens in the wrong Chrome profile, you can abort and click Login again instead of waiting 5 minutes for the server-side timeout. Under the hood: `LoginCallbacks` gained a `CancelCh`, the operator's `oauth.cancel` handler closes it and waits for the Login goroutine to finish so the local callback port is released before retry. Wired for Anthropic, Claude, OpenAI Codex, Gemini, and GitHub Copilot device flow.

### Changed

- **Renamed `internal/coder/` → `internal/harness/`** — the package was the agent runtime (permissions, budget, compaction, memory, file tracking, session state, verification, background tasks) that all agents (`builder`, `spacedev`, the coder agent config, etc.) run inside. The old name was a historical holdover from when `coder` was the only agent. New name matches industry vocabulary. Storage dir on disk migrates from `<appdir>/coder/` to `<appdir>/harness/` on first boot (no-op if already migrated; legacy dir left untouched if both exist). IPC route names (`coder.set_permission_mode`, `coder.permission_respond`) kept for frontend compatibility.
- **Go toolchain bumped 1.25 → 1.26** (`operator/go.mod`). Green Tea GC is now the default (10–40% less GC overhead on a long-running server like the operator), and the compiler puts more slice backing stores on the stack. Zero code change required; build + full test suite green.

### Removed

- **Dead symbols in the harness package** — `RegisterSpaceToolPrefix` + supporting slice/mutex/loops, `isSpaceActionTool`, `errTaskNotFound`, `WithPermissionMode`, `WithToolBudget`, `WithWarnThreshold`. All had zero callers per `golang.org/x/tools/cmd/deadcode`.

### Fixed

- **Marketplace install fails on legacy tarball URLs** — registry entries still carry absolute URLs on `developer.construct.space`, whose TLS cert is no longer maintained. `useSpaceMarketplace.install` now rewrites any `developer.construct.space/api/...` tarball to the `my.construct.space/api/developer/...` gateway path at download time, using the well-trusted cert on the gateway host. Matches the post-migration routing already in place for developer API calls.

## [0.17.4] — 2026-04-19

### Fixed

- **BuiltinWidgets feed stops spamming 401s** — `/api/source/feed` was firing during the brief window where OAuth callback had set `isAuthenticated=true` but hadn't yet attached the bearer token to the API client, so the request went out without an Authorization header and the gateway (correctly) returned 401. BuiltinWidgets now watches both `isAuthenticated` **and** `token` and only fetches once both are set. For users whose token is valid for accounts but lacks source scope, the deny is cached in profile-scoped storage for 1 hour so repeated loads don't re-fire the fetch; successful calls clear the marker.

## [0.17.3] — 2026-04-19

### Fixed

- **Check for Updates works before sign-in** — the Construct → "Check for Updates..." menu item previously navigated to `/app/settings/updates`, which the auth guard bounced back to `/login`, so nothing happened on the login / register screens. The handler now runs the updater inline via the existing `useUpdater` composable and surfaces the result through the shared toast: "Update available: v{version}" with an "Install & Restart" action, "You're up to date" on success, or "Update check failed" with the reason. Works from every route. The Settings → Updates panel stays as the full detail view.
- **Sign-in race stranded users on /login** — after OAuth callback succeeded and `router.replace('/app')` fired, the guard read `profileStore.hasProfiles` before the store finished its first `init()`. With no profiles loaded yet, the guard redirected back to `/login` even though auth was valid; re-navigating then bounced between `/app` and `/login`. Guard now awaits `profileStore.init()` before the hasProfiles check.

## [0.17.2] — 2026-04-19

Issue-driven bug-bash release — addresses every open P0/P1/P2 issue plus the external ultrareview findings.

### Added

- **Project type badge on Projects page** (#49) — each card probes for `space-*/` subdirs on mount and shows a pill: cyan "Space" or accent "Builder". Detection is async so paint isn't blocked.
- **Plan-mode suggestion banner** (#51) — new `usePlanSuggestion` composable. When a project has no `docs/plan-*.md` and the user is in Code mode, BuilderPage and SpaceDeveloperPage show a non-blocking banner with "Switch to Plan" action and a dismiss X. Dismissal persists per-project in localStorage.
- **Lightbox ESC + ARIA** — ResponseBlocks lightbox closes on Escape; gains `role="dialog"`, `aria-modal`, `aria-label`.
- **`space:cli` skill** (`operator/internal/spacedev/skills/cli.md`) — full CLI reference (install, login/logout/whoami, publish, update, clean, graph subcommands) with explicit guidance on when the agent should use `space_*` tools vs. tell the user to run CLI directly (publish needs TTY).

### Changed

- **Space Developer prompt hardening** (#46) — new "A Space has a required structure" block at top shows mandatory layout; Hard Rule #1 explicitly forbids single-file outputs for "simple" asks; new Anti-patterns section calls out plain HTML at project root, skipping `space_create` on trivial asks, hand-writing the manifest.
- **Graph skill requires CLI** — `operator/internal/spacedev/skills/graph.md` explicitly requires `construct graph` for all schema ops (no hand-written migrations, no direct API POSTs), cross-references the cli skill for `construct login` auth requirement.
- **Scaffold skill package.json aligned with template** — `@construct-space/*` packages pinned to `"latest"` (matches actual `scaffold/templates/package.json.tmpl`), preventing drift.
- **Lazy `bun install` for Spaces** (#50) — scaffold skill no longer tells the agent to run `bun install` after `space_create`. `space_build` auto-installs lazily when `node_modules/` is missing via new `runBunInstall` helper. Simple Spaces that never build stay in single-digit MB instead of 143MB.
- **Builder + Space Developer default to Plan mode** (#45) — new sessions start in plan; restored sessions honor the saved mode.
- **Plan/Code tabs and PREVIEW button gain affordances** (#45) — `cursor-pointer`, hover state via `hover:bg-white/5` and `hover:brightness-125`, proper disabled styling.
- **TUI icon scoped to project index + detail** — removed from ProjectLayout's always-visible teleport; now only present on `/app/projects` (→ `/app/tui`) and `/app/projects/:id` (→ project-scoped TUI).
- **Static preview uses `bun run index.html`** — Bun 1.2+ native HTML dev server with HMR replaces `bunx serve`.
- **Builder preview classifier tightened** (#47) — now checks common SSG output dirs (`web/`, `dist/`, `public/`, `out/`, `build/`, `_site/`) with `index.html` before falling through to language servers. Go classification additionally requires a listener call detection in `main.go` (`ListenAndServe`, `http.Server{}`, `gin.New`, `echo.New`, `fiber.New`, `chi.NewRouter`, `mux.NewRouter`) — a bare `net/http` import is treated as a client, not a server.
- **Developer Settings always visible** (#44) — `devOnly: true` gate dropped from nav; the page itself already handles pre-enrollment (Enroll button) and post-enrollment (full panel) states.
- **Projects scan tightened** (#48) — auto-import under projects root now requires `.construct/project.json`. Arbitrary sibling folders no longer auto-imported.

### Fixed

- **Choice-button extractor no longer fires outside Ask** (ultrareview) — `extractActionButtonsFromLastText` gated on `assistantType === 'ask'`. Non-ask consumers (AssistantPanel, Oracle, Live, Space Developer) no longer lose prose to a button list nobody can click.
- **Choice regex tightened** (ultrareview) — regex class narrowed from `[—–-]` to `[—–]` so ordinary `- foo - bar` bullets stop getting rewritten as button lists.
- **Choice click sends bare label** (ultrareview) — ActionBlock gained a `description?` field; `ActionButtons.vue` renders label and description distinctly. Clicking sends just the label back as the user message, no longer concatenating the agent's own description text.
- **ToolCard image previews privacy-hardened** (ultrareview) — auto-rendered images now carry `referrerpolicy="no-referrer"` and `crossorigin="anonymous"`. Attacker-influenced URLs in tool output no longer leak the user's IP + headers.
- **Home widgets auto-reload on rebuild** (#36) — SpaceLoader exposes `subscribeToSpaceReload(spaceId, cb)`; `reloadSpace` now fires subscribers after a fresh load. `WidgetChrome` subscribes on mount and re-mounts its Shadow DOM with the new component. WidgetChrome also starts its own `watchSpace` so manifest polling (`construct dev` / `.dev` marker) reaches widgets on the Home grid. No restart required to see widget edits.
- **Projects "Remove From Construct" persists across restarts** (#48) — new `hiddenPaths` list persisted via `profileStorage` (key `construct_hidden_project_paths`). `loadProjects` filters hidden paths; `createProject` auto-unhides on re-create at the same path; new `unhideProject` action for re-import.
- **Builder preview "No such file or directory (os error 2)"** (#47) — pre-checks `projectPath` exists before spawning; translates opaque Rust IO errors when a spawned binary (bun/go/python3/cargo/bunx) isn't on PATH into an actionable message.
- **Preview detects build-and-exit processes** (#47) — runtime races on the child closing. If the child exits before binding a URL, surfaces "build tool, not a server" error instead of opening an in-app browser at a dead port.
- **TUI nested-button HTML warning** — tab row rewritten as `<div role="tab" tabindex="0">` so the inner close `<button>` is no longer nested inside another `<button>`. Keyboard activation via Enter/Space preserved.
- **TUI xterm dispose crash** — `destroySession` wraps `terminal.dispose()` in try/catch; xterm throws "Could not dispose an addon that has not been loaded" when the addon state is partially torn down, but the terminal instance is discarded anyway.
- **builtin_web_search `cap` shadow** (ultrareview) — local `cap` renamed to `limit` so it no longer shadows the `cap()` builtin.

### Operator

- `operator/internal/tool/builtin_web_search.go` — `cap` → `limit`.
- `operator/internal/tool/space_cli.go` — `space_build` lazy-installs deps via new `runBunInstall`; `space_create` "next steps" message no longer prescribes `bun install`.

## [0.17.1] — 2026-04-18

### Fixed

- **capabilities** — allow `preview-*` / `detach-*` windows to invoke plugins
- **tauri bundle** — drop unsupported `infoPlist` key from `bundle.macOS`

## [0.17.0] — 2026-04-17

### Added

- **Org Project space** — org-scoped project management with list/detail pages, clone/link to local, member assignment, tags, status tracking
- **Space tool permissions** — space action tools (e.g., `nba_get_scores`) auto-allowed via `RegisterSpaceToolPrefix`
- **Agent handoff system** — agents emit `<<handoff:<target>>>` when a request is out of scope; UI strips the marker and renders a "Switch to X" button that carries the user's prompt to the target via `?q=` (auto-sent on arrival). Ask → Builder, Builder → Space Developer.
- **`load_skill` tool** — agent-invocable (Claude Code style). Pulls a skill's full body into the conversation on demand when the auto-trigger didn't match but the agent realizes the skill applies. Agent-scoped via `tool.WithAgentID` context.
- **`space:scope` skill** — explains manifest scope (`app` / `project` / `org` / `any`) and data tenancy. Tells the agent to `ask_user` with a friendly explanation when scope is ambiguous — most users don't know the model.
- **`builder:game` skill** (shared with Space Developer) — recognizes game requests and asks the user which rendering stack (Canvas 2D / SVG / Pixi / Phaser) before scaffolding. Trigger covers arcade, puzzle, platformer, card game, RPG, tilemap, sprite, etc.
- **`keyGuard`** (`frontend/lib/keyGuard.ts`) — wraps `window` + `document` `addEventListener` for key events so space keydown handlers are bypassed when a host input is focused and the key has no Cmd/Ctrl modifier. Protects Assistant + any other input from space-level key hijacking (fixes #37) and from malicious keystroke snooping. Installed early in `bootstrapMain`, `SpacePreviewShell`, `SpaceRunnerPage`.
- **Matched-skills chip** — Builder and Space Developer show the skill name + Sparkles icon above the chat input while a turn is streaming (parity with Ask).
- **`ask_user` Question card** — the tool call is rendered as a highlighted Question card with the question text front-and-center and a subtle "waiting for your reply…" indicator while running, instead of the raw JSON input + "Question sent to user / Waiting for user response" tool blob.

### Changed

- **Operator PATH** — augments PATH at startup with `~/.bun/bin`, `~/.cargo/bin`, `~/go/bin`, Homebrew, etc. (Tauri sidecar doesn't source shell profiles)
- **Space Preview** — page content now scrolls, sidebar shows page navigation for multi-page spaces
- **Construct Space run labels** — dropdown shows Build Space / Validate / Install instead of generic names; removed `construct dev` (workflow is build → preview)
- **Sound settings** — gated by experimental flag; Live Mode nested under Voice & Sound
- **bridge.rs** — routes `space.open_runner` and `space.open_preview` to frontend
- **Brainstorm → Ask** — space id `brainstorm` → `ask`, display name "Ask", icon stays `lucide:message-circle`. Cookie crumbs canvas animation + "Cookie" icon stripped from the empty state; copy updated to point at Builder / Space Developer instead of Coder / Architect. All code references (49 files across frontend + operator) renamed via whole-word replacement; skills/coder dir renamed to skills/builder.
- **Coder + Architect retired — Builder replaces both** (plan + code modes).
  - Deleted: `frontend/spaces/{coder,architect}/`, `operator/internal/agent/builtin/agent_{coder,architect}.go`, `verification_architect.*`, `operator/internal/coreagents/configs/{coder,architect}.md`, `operator/internal/coreskills/skills/architect/`, `skills/builder/construct-spaces.md`, `frontend/operator/__tests__/streamCoordination.test.ts`.
  - Kept: `operator/internal/coder/` package — autocompact, microcompact, permission_*, memory_*, turn_budget, session_memory. Generic agent-loop infrastructure all agents use. Package rename to `agentloop/` deferred to its own PR.
  - Morpheus moved from brainstorm chat tabs to Builder's toolbar, and the wake loop now wakes Builder instead of Coder.
  - Project agent's `canInvokeAgents` updated from `[architect, coder, docs]` → `[builder, space, docs]`.
  - Restored to shared locations (collateral damage from the coder dir removal): `frontend/components/agent/{ContextGauge,CostBadge,PermissionControl}.vue`, `frontend/composables/{useProcessManager,useAnsiStrip}.ts`.
- **`space_preview` tool unified with `space_runner`** — the Play button in the Space Developer toolbar and the agent's `space_preview` tool now open the same Space Runner window (dev-preview mode, loads built IIFE from `dist/`). Previously `space_preview` opened a separate SpacePreviewShell that users confused with Builder's dev-server Preview.
- **Developer endpoints routed through gateway** — `useDevMode` enrollment (`/api/enroll/personal`) and CLI-key sync (`/api/auth/cli-verify`) now hit `${accountsUrl}/api/developer/*` on `my.construct.space` instead of the retired `developer.construct.space` subdomain. Developer Settings "Manage API keys" button points at `${accountsUrl}/developer/keys`.
- **Preferences split: user on accounts, org on source** — user preferences moved from source's `/api/preferences` (retired) to accounts' `/api/accounts/preferences/*`. Desktop `preferences.ts` now calls a new `useAccounts()` composable pointed at `${gatewayUrl}/api/accounts`. A new `orgPreferences.ts` store backs team-wide policies against source's `/api/source/org/preferences`, with typed getters for the four v1 keys: `members.invite_role_default` (string), `members.require_2fa` (bool), `projects.default_visibility` ("private"|"internal"|"public"), `providers.allow_member_oauth` (bool). Writes require the new `org.settings.edit` permission (granted to Owner + Admin); non-admins see 403 and revert the control optimistically.
- **LLM provider OAuth respects org policy** — `startOAuthLogin` in LLMSettings checks `orgPreferences.allowMemberOAuth` before launching the browser. When the caller's scope is `org` and the policy is off, the connect is blocked with a user-visible toast explaining the org restricts personal OAuth provider connections. Personal scope and the default (unset → true) proceed unchanged.
- **Space Developer UI skill** (`operator/internal/spacedev/skills/ui.md`) — trigger widened to cover page/form/dashboard/admin/table/list/grid/settings/panel/view/screen/input/select/dropdown/tabs/drawer/empty-state/skeleton/notification/toast/shell/Vue/.vue/template/design vocabulary. Reframed from menu-of-options into hard rules ("Never write `<button class=...>` — use `<Button>`", "Never hardcode colors", "Never add `.dark:` branching").
- **Space Developer prompt** — hard rules to `load_skill` scope before scaffolding a new Space, `ui` before writing any `.vue` file, and `game` before scaffolding anything game-shaped (ask about stack first).
- **Builder prompt** — new `## Skills` section with same `builder:game` load-before-scaffold rule. Also told to emit `<<handoff:space-developer>>` for Construct Space requests.
- **Ask prompt** — emits `<<handoff:builder>>` or `<<handoff:space-developer>>` when the user asks for implementation work, with short acknowledgement before the marker.
- **Space Preview window auth** — `authGuard` in `router/guards.ts` now hydrates the auth store for `/preview/*` routes (parity with `/runner/*`), so spaces loaded in the preview window see the logged-in user instead of rendering signed-out.

### Fixed

- **Preview/detach windows had no auth in release builds** — `preview-*`, `detach-space-*`, and `detach-assistant-*` labels weren't in the default capability's `windows` / `webviews` allowlist, so Tauri silently denied `invoke('get_data_dir')` and `plugin-fs` reads on those webviews. `hydrateAuthState` swallowed the error, the auth store stayed empty, and the space rendered signed-out — showing "AUTH:FAILED / Missing login context" whenever a provider or OAuth flow was touched. Dev was permissive so the bug only surfaced after `bun run release`.
- `space.open_runner` bridge dispatch — was missing from Rust match arm, caused "Unknown bridge method" error
- Project sidebar — Coder and Editor now visible inside projects (added to `SpaceType` + `DEFAULT_SPACES`)
- Project-scoped spaces no longer hidden by dev mode gating (removed `requiresDeveloper` from project-scope manifests)
- Min window sizes — runner 800x500, assistant 400x500
- **Stale `findings_test.go` expectations** — updated to `.construct/verification/` layout (the impl moved there intentionally; tests never caught up).
- **Stale `coreagents_test.go` + `coreskills_test.go`** — witnesses updated from removed architect/coder to ask + project + builder.
- **Stale router smoke tests** — `/architect` and `/coder` route assertions replaced with `/builder` and `/space-developer`.
- **`space_loader/__tests__/spaceContract.test.ts`** — `HOST_NATIVE_SPACE_IDS` list updated.
- **Assistant registry/renderer/runtime tests** — coder/architect surface mappings stripped.
- **`lib/__tests__/widgetApi.test.ts`** — coder → builder in test stub.

### Polish

- **Lint warnings 92 → 0.** Pruned unused Lucide icon + Vue composable imports across ~20 files; `_`-prefixed unused functions/variables to satisfy the allowlist while keeping structurally meaningful bindings; replaced `any` with concrete types (`File & { path?: string }`, type-guarded `FileLike`, `Array<{ type: string; content?: string }>`, `Record<string, unknown>`, `unknown` catch-bindings narrowed with `instanceof Error`, `Parameters<typeof>` / `RouteLocationNormalized` in tests). File-level `eslint-disable vue/one-component-per-file` on `useUniversalBootstrap.test.ts` (legitimate harness pattern).

## [0.16.0] — 2026-04-08

### Added

- **Agent Verification System (MVP)** — mandatory fresh-agent verification for all core agents
  - Runner intercepts agent completion and spawns a fresh read-only verifier with no prior context
  - 3-strike cross-turn flow: verify → original agent fixes → verify → fixer agent → verify → escalate to user
  - Verifier prompt rewritten — closes all 8 gaps vs Claude's verifier (adversarial probes, anti-rationalization, change-type playbooks, tightened PARTIAL semantics, FAIL discipline, tool awareness)
  - Findings files written on failure with structured check results, deleted on pass
  - Verification profiles registered for coder, architect, coordinator, and morpheus
  - Coder profile extracts real changed files via `git diff` and auto-detects playbook (frontend/backend)
- **Morpheus verification learning** — observer tracks verification outcomes, detects recurring failure patterns (3+ in same category within 7 days), queues improvement actions
- **Local prompt overlays** — Morpheus writes improvement overlays to Application Support, injected into system prompt assembly at runtime
- **Verification stream events** — `verification.started`, `verification.passed`, `verification.failed`, `verification.escalated`, `verification.fixer_spawned` emitted by operator, consumed by frontend
- **Morpheus cockpit verification stats** — verification status section in Morpheus dashboard
- **Verification telemetry** — `POST /api/v1/morpheus/patterns` endpoint in infra service for anonymized aggregate analysis, opt-in via `morpheus_telemetry` setting
- **`operator/internal/verification/` module** — profile registry, findings format, verifier/fixer prompt builders, flow orchestration, overlay store

### Changed

- **Homepage top strip** — user card (3x2, clickable → profile settings), rest is API-driven feed blocks from `GET /api/feed`
- **Scope vocabulary unified** — all scopes now `app/project/org/any` across manifests, prompts, CLI templates, types, and agent configs
- **Developer spaces gated** — architect, coder, editor hidden from sidebar and widgets when dev mode inactive
- **Icon component** — supports `lucide:name`, `i-lucide-name`, and bare kebab-case formats
- **Breadcrumb** — fallback icons for all routes (projects=folder, settings=gear, etc.)

### Fixed

- #29, #31, #28, #30, #24, #25 — widget sandbox, audio, navigation, persistence, sidebar
- #20 — session memory path validation
- #21 — duplicate OAuth provider removed
- #16 — chat auto-scroll
- #33 — recent projects navigation
- #26 — Bun PATH detection
- #34 — project sidebar clickable
- #19 — chat widget text carry-over
- #22 — stale session cleanup
- #32 — coder header overflow
- #23 — scope vocabulary unified
- #18 — dev spaces gating
- #17 — architect action buttons (Open Project)
- #35 — homepage redesigned
- #15 — window close behavior (by design)
- Markdown links open in new window
- README loads from root or docs/
- Breadcrumb icons for all routes
- Morpheus moved from brainstorm tabs to coder toolbar
- Sound settings gated by experimental flag
- Min window sizes enforced
- Project sidebar shows coder and editor

### Deferred (not resolved — requires goal tracking system)

- Contract extraction: ContextBuilder uses generic task/criteria text instead of real goal data
- Per-goal findings paths: uses synthetic naming instead of `goal-{goalId}-findings.md`
- goalId in events: emits empty string — frontend stores it but data is incomplete

## [0.15.0] — 2026-04-06

### Added

- **Global permission modal** — Always Allow / Allow Once / Deny in App.vue, works across all spaces
- **Rich project logging** — coder.log now shows 💭 thinking, 📝 narration, 🔧 tools, ❌ errors, 📊 tokens
- **Orphaned tool_result sanitizer** — prevents API errors on resume/interrupt/hook-block
- **Space Ownership Phase 1** — claim enforcement, 5-space quota, transfer endpoint (Developer Portal + Graph + CLI)

### Changed

- **Shell budget 120s** (was 15s) — bun install and builds won't get killed
- **Morpheus auto-enabled** — backend always ready, frontend gates via experimental toggle
- **Steering interrupts** — stops current stream immediately instead of queuing
- **bun enforced** — hard rule across all agents, system sections, and skills

### Fixed

- **spawn_background/spawn_agent/space_dev_start** — classified safe (were dangerous/write)
- **ask_user** — classified safe (was dangerous, blocked by permission system)
- **rm/cd/sed/curl/cp/mv** — added to safe bash commands
- **cd && command chains** — auto classifier now checks command after &&
- **Findings P1**: settings schema accepts construct_projects_root
- **Findings P1**: workflow tasks not wiped on resume
- **Findings P2**: permission mode emitted on stream start
- **Morpheus audit**: policy enforcement wired, observer project-start called, discover_skills interpreted, wake history real, notification emitter wired, shell budget enforced, WakeUserMessage produced, skill refresh on struggle, discoveredPaths race fixed
- **Architect prompt**: always call get_project_context, never guess paths
- **Verifier example**: bun run build not npm run build

## [0.14.0] — 2026-04-06

### Added

- **Morpheus Phase 3-4 Complete** — proactive observer, policy enforcement, desktop notifications, durable recovery
  - Observer watches tool calls, detects struggles (3+ consecutive errors), auto-triggers skill discovery
  - Policy enforcement in tool_exec.go: observe=read-only, local_execute=no commits, execute_and_commit=full
  - Shell budget enforced: bash commands exceeding 15s get cancelled with spawn_background guidance
  - Morpheus directly owns skill discovery and specialist creation (not prompt-driven)
  - Desktop notifications via Browser Notification API for success/failure events
  - Wake + notification history persisted to disk, loaded on startup
  - WakeUserMessage produced from AI module on user input
  - Wake history ring buffer (50 items) returned in morpheus.status
  - Enable/Disable toggle bound in Morpheus Space cockpit
  - morpheus.notification stream events consumed by frontend
  - morpheus.observer_status RPC with project, errors, turn count
  - Tests for direct skill discovery and specialist creation hooks
- **Skill Auto-Discovery** — detects project stack, fetches focused skill files
  - `skill_install` tool for agent-driven installation
  - 10 known stacks with focused llms-skills.txt URLs
  - Background auto-discovery in run_setup.go
- **Enriched Frontend Skill** — stack decisions, scaffolding, landing/SaaS/dashboard patterns
- **Skills/Hooks Settings Split** — skills always visible, hooks developer-mode only
- **Skill Badges in Chat** — matched skills shown during sessions
- **Community Skills Link** — browse skills on GitHub from settings

### Changed

- Chat page tabs: Live + Morpheus gated by experiment flags
- Coder prompt: removed skill discovery (background work), kept coding focus

### Fixed

- **Findings P1**: settings schema accepts `construct_projects_root`
- **Findings P1**: workflow tasks not wiped on resume (isResumingSession flag)
- **Findings P2**: permission mode emitted on stream start
- **Findings P2**: `dont_ask` added to settings schema
- **Findings P2**: `swarm.team_loaded` handled by frontend
- **Findings P2**: 11 missing event type constants in events.go
- **OAuth scopes**: removed invalid scopes from all 3 OAuth files
- **web_fetch/web_search**: classified as safe (were dangerous)
- **Morpheus set_policy**: frontend sends correct `level` field
- **discoveredPaths race**: sync.Map replaces plain map
- **Safe bash commands**: mkdir, bun, npm, construct CLI auto-allowed
- **Architect prompt**: always call get_project_context, never guess paths
- **Stale shell budget comment**: removed contradictory comment

## [0.13.0] — 2026-04-06

### Added

- **Morpheus Autonomous Mode** — full 4-phase implementation:
  - State machine (disabled/active/sleeping/paused), sleep/wake event loop
  - Proactive observer — watches coder tool calls, detects struggles (3+ consecutive errors), auto-triggers skill discovery on project start
  - Policy enforcement — observe (read-only), local_execute (no commits), execute_and_commit
  - Notifications with bounded history, shell budget config
  - Cockpit Space with status, observer, dynamic agents (score bars), timeline, policy controls
- **Self-Improving Agents** — coordinator creates, evaluates, and improves agents at runtime:
  - Dynamic agent store on disk (`agent_create`/`agent_update`/`agent_delete`/`agent_list_dynamic`)
  - Self-evaluation with score tracking and prompt improvement suggestions
  - Coordinator CTO mode — hire specialists, evaluate, coach, fire
- **Skill Auto-Discovery** — detects project stack, fetches focused skill files from framework docs
  - 10 known stacks: Nuxt, Next.js, Astro, SvelteKit, Tailwind, Vue, React, Supabase, Drizzle, Stripe
  - Prefers focused `llms-skills.txt` over full `llms.txt` to save tokens
  - `skill_install` tool for agent-driven skill installation
- **Experimental Features** — Settings > Experimental with per-feature toggles (Sound, Morpheus, Live, Swarm)
- **Microphone Permission Gate** — Live page shows permission request screen, SoundSettings shows mic status
- **Space Dev Tools** — `space_dev_start`/`space_dev_stop` for watch mode
- **Graph Tools** — `space_graph_init`/`generate`/`push`/`migrate`/`status` as first-class tools
- **Read Dedup** — SHA-256 hash tracking, returns stub on unchanged re-reads to save context tokens
- **Skills Settings** — categories (Built-in/Space/User), trigger patterns, agent scoping, community link
- **Hooks Settings** — separate page, developer mode only
- **Skill Badges in Chat** — matched skills shown as badges during active sessions
- **Frontend Skill** — enriched with stack decisions, scaffolding, landing/SaaS/dashboard patterns

### Changed

- **Morpheus cockpit** — full dashboard with observer status, timeline, dynamic agents with score bars
- **Chat tabs** — Live and Morpheus are tabs in Chat page, gated by experiment flags
- **Coder prompt** — removed skill discovery (background work), kept focused on coding

### Fixed

- **OAuth scopes** — removed invalid `org:create_api_key` + 3 other scopes from all 3 OAuth files
- **web_fetch/web_search** — classified as safe (were defaulting to dangerous)
- **Morpheus set_policy** — frontend sends `level` field matching backend handler
- **ConstructDevMode** — fully removed (6 files)
- **Space preview** — loads directly from dist/, no install needed
- **Swarm spawn** — defaults to coder agent when name doesn't match registered agents

## [0.10.0] — 2026-04-05

### Added

- **Permission Control Plane** — Multi-source rules (session/project/user/agent), auto classifier with heuristics, filesystem-aware path policy, sandbox policy, dangerous rule stripping for auto mode, headless worker mode, rule shadowing detection
- **Tool Runtime Metadata** — `Metadata` struct on every tool: concurrency, interrupt behavior, risk class, activity description templates, classifier hints, per-tool timeouts
- **Persistent Tasks** — `DiskTaskStore` with session-scoped JSON persistence, `TaskOutputStore` for background results, `task_get` tool, file-offset reading (`ReadTail`, `ReadRange`)
- **Delegation MVP** — `wait_task` join primitive (blocks on done channel), `spawn_background` with worktree isolation, background merge failure detection
- **Verifier Agent** — Adversarial verification specialist with change-type playbooks, anti-rationalization section, mandatory adversarial probe before PASS, strict PARTIAL semantics
- **Coordinator Agent** — Orchestrates workers via spawn/wait/verify pattern with concurrency guidance
- **Context Control v2** — `AutoCompact` (progressive reduction), `ContextCollapse` (withhold/recover), `TurnBudget` (per-turn tracking), `DynamicBudget` (pressure-based limits), compaction circuit breaker
- **Worktree Sessions** — `enter_worktree`/`exit_worktree` tools, `WorktreeManager`, state persistence, stale cleanup
- **Attachment System** — Typed transient messages (12 types), delta-aware queue with FNV-1a dedup, message injector, 8 producer factories
- **Cache-Preserving Microcompact** — `CacheEdit` type on API requests, expires old tool results without rewriting transcript
- **System Prompt Sections** — Reusable system/actions/tools/efficiency sections injected into all agents, environment info (platform, git, date)
- **Shell Stall Watchdog** — Detects background tasks stuck on interactive prompts (y/n, password:, Continue?)
- **Overflow Recovery** — `prompt_too_long` triggers context collapse then autocompact before failing
- **Space Agent** — 24KB consolidated prompt from 3 sources, full UI component table, Graph API reference, CLI generation shorthand, 6-tier tool hierarchy, verification contract
- **Workflow Task Board** — `WorkflowTasks.vue` shows agent's work plan from `task.created`/`task.updated` events
- **Background Task Center** — `BackgroundTasks.vue` upgraded with cancel, inspect result/error, expandable details, live elapsed timer
- **Platform Runtime** — `useAgentSession` expanded with backgroundTasks, costInfo, contextInfo, permissionMode, pendingPermission, respondToPermission(), setPermissionMode()
- **Event Protocol** — 7 new event types: permission.request, task.created/updated, swarm.member_spawned/done, swarm.team_created/shutdown. Permission mode expanded to all 6 modes.
- **Memory Enrichment** — Extraction guidance (what to save vs skip), dream prompt with 4-type taxonomy and feedback preservation

### Changed

- **Coder Prompt** — Delegation workflow (spawn -> wait -> verify), reporting outcomes section, collaboration rule, tightened narration (no thinking out loud between tool calls)
- **Tool Descriptions** — bash, read_file, write_file, edit_file, grep, glob enriched with behavioral rules
- **Swarm Tools** — `RegisterAllTools` with full wiring (setTeam, runFn, getEmitter, agentResolver), lazy emitter resolution
- **Space Subagent** — Slimmed to activation hint, points to full space agent for deep knowledge
- **Coder canInvokeAgents** — Now includes verifier for delegation workflow

### Fixed

- **Session Continue** — Was passing projectId where filesystem path expected, now resolves via projectStore
- **TaskID Path Traversal** — `validateTaskID` rejects path separators, dots, and non-alphanumeric characters
- **Circuit Breaker Data Race** — Changed to `atomic.Int32`/`atomic.Bool` for goroutine safety
- **Worktree Tools** — Were defined but never registered in main.go
- **Merge Failure** — `spawn_background` now fails the task when worktree merge fails (was silent data loss)
- **Task Persistence** — Fixed empty session ID and double-tasks path bug in `SetTaskStoreSession`
- **Agent-Scoped Rules** — `AddAgentRules` now stores and filters by agentID
- **Debug Logs** — Removed `console.log` from PermissionControl.vue and CoderPage.vue
- **Session History** — Now excludes current active session

### Removed

- **ConstructDevMode** — Removed `dev:devmode`/`build:devmode` scripts, `VITE_CONSTRUCT_DEV_MODE` env var, `is_dev_build()`, `tauri.devmode.conf.json`, `ConstructDevMode` directory path

## [0.9.0] — 2026-04-02

### Added

- **Web Fetch Tool** — `web_fetch` builtin: fetch URLs, strip HTML, extract text content for agent research
- **Notebook Tools** — `notebook_read` + `notebook_edit`: parse/render/edit Jupyter .ipynb cells
- **Git Tools** — `git_status`, `git_diff`, `git_log`, `git_commit`, `git_branch`: structured git operations without raw bash
- **Cost Tracking UI** — Real-time `CostBadge` in coder toolbar with token/cost breakdown, cache hit rate, budget bar
- **Context Window Gauge** — `ContextGauge` shows context utilization %, warning at 80%/95%
- **Cron Scheduler** — Persistent scheduled agent tasks with CRUD RPC handlers + `CronPanel` UI
- **Insights Dashboard** — Settings > AI > Insights: session analytics, daily activity chart, agent usage, cost trends
- **Lifecycle Hooks** — `session_start`, `session_end`, `file_changed` hook types with shell command support
- **Subagent Worktrees** — `spawn_agent` accepts `isolation: "worktree"` for git-isolated parallel agents
- **MCP Manifest** — Spaces can declare `mcpServers` inline in manifest.json
- **Session Memory** — Mid-session extraction every 10 turns preserves learnings during long runs
- **Fast Mode** — Zap button skips memory hints + skill matching for faster turns
- **Thinking Indicator** — Expandable reasoning content display during extended thinking
- **Vision-Aware Input** — `AgentInput` adapts to model capabilities: image paste/drop only when model supports vision
- **Cross-Platform Paths** — Shared `paths.ts` utilities: `shortenHomePath`, `basenamePath`, `normalizeSeparators`
- **Space Rebuild Polling** — Shared `spacePolling.ts` helper consolidates 3 duplicate polling loops
- **Lazy Space Loading** — Startup reads manifests only (no bundle eval), lazy-loads on first action invoke
- **Swarm Mode** — Team agent coordination with mailbox IPC for multi-agent collaboration

### Changed

- **Session Resume** — Runner reuses existing session ID on resume instead of creating new one
- **Project Lifecycle** — Replaced `mkdir -p`, `ls -A`, `trash`, `osascript` with Tauri FS APIs (cross-platform)
- **Space Contract** — Test suite updated for 5 host-native spaces (includes editor), derives counts from registry
- **Auth Sync** — Removed no-op `auth.set_api_base`/`auth.sync_token` passthrough handlers (was for construct-dev)
- **useTauriContext** — Deprecated in SDK with `@deprecated` annotation, replaced by `useOperator`

### Fixed

- **SVG Sanitization** — SVG blocks now sanitized via DOMPurify before `v-html` render (prevents XSS in Tauri)
- **Doc Preview** — Preserves original filename alongside display title (no more lossy roundtrip)
- **File Count** — Project summary uses `files.length` not `entries.length` (excludes directories)
- **Watcher Guard** — `useProjectDirectory` watcher installs once via module-level flag
- **Architect Fallback** — Removed hardcoded `/Users/flakerim/ConstructProjects` path
- **LLMSettings Test** — Fixed hardcoded absolute path, uses `resolve(__dirname)` instead
- **Integration Tests** — `TestSessionPersistence` skips on provider auth failures, asserts session ID stability
- **Lint Cleanup** — 147 warnings reduced to 64 (removed unused vars/imports across 35 files)
- **Steer Fix** — Enter key queues message for after current run instead of stopping agent

## [0.8.3] — 2026-04-02

### Added

- **Claude Pro/Max (Direct OAuth)** — New direct Claude login via OAuth PKCE, same flow as Claude Code. Tokens stored in `providers/auth.json` under `claude` key
- **Model capabilities** — Real capability badges for all providers (tools, vision, reasoning, structured, citations, code_execution, pdf_input) using Lucide icons instead of emoji
- **GitHub Copilot device code UI** — Yellow card shows the device code inline with copy button and auto-polling
- **MiMo v2 Pro/Omni models** — Added mimo-v2-pro and mimo-v2-omni alongside flash
- **xAI Grok 4.x models** — Updated from Grok 3 to Grok 4.20 Reasoning, Grok 4.20, Grok 4.1 Fast Reasoning, Grok 4.1 Fast

### Changed

- **Anthropic OAuth hidden from UI** — OpenCode-based "Claude Pro/Max (OpenCode)" removed from Auth tab; auto-discovered silently as fallback
- **Duplicate provider hidden on Models tab** — When `claude-oauth` is connected, `anthropic-oauth` is filtered out to avoid showing same models twice
- **GitHub Copilot login** — Silently tries `gh` CLI token first, falls through to device code flow on failure. No more "Yes/No" prompt
- **Model labels** — OpenAI models use hyphenated format matching ChatGPT UI (GPT-5.4-Mini, GPT-5.3-Codex, etc.)
- **Provider model updates** — DeepSeek (chat + reasoner capabilities), xAI (Grok 4.x), MiMo (3 models), all with ModelsMeta

### Fixed

- **Device code card disappearing** — `finally` block was clearing deviceCode ref on every pending poll iteration
- **Double-serialized JSON from Tauri bridge** — `operator.send` now auto-unwraps string responses globally
- **OAuth UI not updating after login** — Added `claude` to `oauthProviderDescriptors` and `FromOAuthCredentials` so connected state propagates
- **Removed `claude-sonnet-4-5`** — Dropped from all connector model lists
- **Lint errors fixed** — `Function` type in tests, unused imports, v-for key, prop mutation in QuestionBlock

## [0.8.2] — 2026-04-02

### Added

- **Space Runner** — Detach any space into its own standalone window for multitasking. Open coder in one window, editor in another, while the main app stays on a different space
- **Space Preview** — Test dev spaces directly from the project `dist/` directory. HMR polling reloads on rebuild
- **Detach button** — External link icon on toolbar-right opens the current space in a separate window with project context
- **Build/Preview toolbar** — RunControls and editor show "Build" when space has no `dist/`, "Preview" when built output exists
- **Bridge: space.open_runner** — Operator/agent can open the runner programmatically via bridge request

### Changed

- **`construct dev` refactored** — No longer copies to `~/Library/Application Support/Construct/spaces/`. Watches and rebuilds to `dist/` only. Runner polls `builtAt` for HMR
- **`construct run` → `construct install`** — Renamed to clarify it installs to the spaces directory (for marketplace-style install). `run` kept as alias
- **CLI: removed Construct Dev directory** — `devDataDir`, `devSpacesDir`, `devSpaceDir` removed from appdir.ts. No more dual data directory concept
- **Settings cleanup** — Removed "Open Construct DEV" from Spaces and Developer settings. Developer settings now has "Open Runner" button. Removed `IS_DEV_INSTANCE` from System and Browser settings
- **Secondary window optimization** — Runner/assistant windows skip `preloadSpaceActions`, operator bridge calls, and auto-updater. Fixes 11s hang on window open

### Fixed

- **Hash routing for runner windows** — Tauri webview URLs now use `/#/runner/...` for Vue Router hash history compatibility
- **Runner guard** — Extracts space name from window label as fallback when redirecting
- **Tauri capabilities** — Added `runner-*` to allowed windows in `desktop/capabilities/default.json`
- **SpaceLoader directory resolution** — `loadSpaceFromDir` now checks for `manifest.json` at baseDir before appending spaceId (supports project dir loading)
- **Teleport targets in runner** — Added `#toolbar-left`, `#toolbar-center`, `#toolbar-right` slots so space pages can teleport toolbar items
- **Decorum crash** — Runner windows use `decorations: true` to avoid null pointer in traffic light positioning plugin

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
