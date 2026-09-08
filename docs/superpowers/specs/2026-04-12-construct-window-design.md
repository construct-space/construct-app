# ConstructWindow — Typed Windows + App.vue Decomposition

Status: Proposed
Date: 2026-04-12
Owner: frontend

## Context

`App.vue` (292 lines) and `main.ts` (107 lines) carry the bootstrap logic for every window type the app opens: main, the static `standalone-assistant` popout, dynamic space preview windows, and runner popouts. The result is `if (isPrimaryAppWindow) …` branching scattered through both files, plus three overlapping composables that each re-implement window creation:

- `composables/useConstructWindow.ts` — generic wrapper (255 lines).
- `composables/useSpacePreview.ts` — dev preview, label `preview-<spaceId>`.
- `composables/useSpaceRunner.ts` — dual-mode popout or dev preview, label `runner-<spaceId>`.

Secondary windows rely on Pinia stores re-hydrating from `localStorage`; there is no live sync from the main window. When auth, project, or pending permissions change in main, child windows drift until they reload.

The lone branching helper today — `lib/windowBootstrap.ts` — exposes only `isPrimaryAppWindow`, so there is no way to express per-window-type behavior. Adding a new window type means adding another label check.

## Goals

- One typed factory for opening windows (`openWindow({ type, … })`).
- One shell per window type; `App.vue` is a dispatcher, not an orchestrator.
- Live cross-window state sync so child windows never drift from main.
- `main.ts` and `App.vue` shrink to their essential responsibilities.
- Session handoff for detach: the live session moves to the detached window and seamlessly returns on close.

## Non-Goals

- Third-party spaces registering custom window types (closed enum for now).
- External URLs inside a main-app shell; `GenericBrowser` is external-only.
- Multiple simultaneous copies of the same space session (detach is a handoff, not a clone).

## Window Type Taxonomy

| Type | Label | Purpose | Chrome |
| --- | --- | --- | --- |
| `Main` | `main` | Primary app — sidebar, router, full init | Traffic lights, no address bar |
| `SpacePreview` | `preview-<spaceId>` | Dev: load IIFE from disk, hot-reload on manifest change | Preview toolbar, reload button |
| `DetachSpace` | `detach-space-<spaceId>-<nonce>` or `detach-assistant-<nonce>` | Move an active space session (or the assistant) to its own window for multi-monitor work | Minimal; L2 sidebar for spaces; no sidebar for assistant |
| `GenericBrowser` | `browser-<nonce>` | External URLs (`https://…`, `http://localhost:*`) — OAuth, dev servers, docs | Address bar, back/forward/reload |

`Main` is implicit — every session has exactly one. `DetachSpace` covers two detach targets: a built-in space, or the assistant panel. The assistant popout that today lives in `tauri.conf.json` as `standalone-assistant` is replaced by `openWindow({ type: 'detach-assistant', sessionId })`.

## Architecture

```
main.ts (~40 lines)              createApp + plugins + mount. No bootstrap branching.
  └─ App.vue (~30 lines)         resolveWindowType(label) → <component :is="shell">
        ├─ MainShell.vue              owns sidebar, router, auth, bridge, permission modal
        ├─ SpacePreviewShell.vue      dev reload, hot-reload manifest watch
        ├─ DetachShell.vue            L2 sidebar for space / full-bleed for assistant
        └─ GenericBrowserShell.vue    address bar, back/forward, Tauri child webview
```

### File Layout

```
frontend/
├── App.vue                              30-line dispatcher
├── main.ts                              40-line entry
├── shells/
│   ├── MainShell.vue
│   ├── SpacePreviewShell.vue
│   ├── DetachShell.vue
│   └── GenericBrowserShell.vue
├── composables/
│   └── useUniversalBootstrap.ts         theme init, devtools shortcut, context-menu guard
├── lib/
│   ├── window/
│   │   ├── windowType.ts                resolveWindowType(label) → type + params
│   │   ├── openWindow.ts                typed factory (replaces 3 composables)
│   │   ├── bootstrapMain.ts
│   │   ├── bootstrapPreview.ts
│   │   ├── bootstrapDetach.ts
│   │   └── bootstrapBrowser.ts
│   └── crossWindow/
│       ├── sync.ts                      typed Tauri event channels
│       └── sessionHandoff.ts            detach/re-attach lifecycle
└── components/space/
    └── SpaceSubNav.vue                  L2 sidebar, shared by Main and Detach
```

### Axioms

1. **One window type = one shell.** No conditional rendering by label inside a shell.
2. **Main is the source of truth.** Other windows subscribe via Tauri events; they do not independently initialize backend state.
3. **Session handoff is explicit, persistence-backed, and per-space.** Each detachable space implements a `SpaceHandoffContract` ({ `save`, `load`, `stopAndFinalize` }) that the detach plumbing calls. Detach is a four-step dance: main (a) calls the space's `handoff.save()`, (b) emits `session:detach-ready` with the returned `HandoffSnapshot`; the detached window then (c) calls `handoff.load(snapshot)` to rehydrate its runtime, and (d) takes ownership of the stream. On window close, the detached window calls `handoff.stopAndFinalize()` (cancel in-flight work + clean up any partial state), then `handoff.save()`, then emits `session:released` with the saved `HandoffSnapshot`. Main receives that snapshot, calls `handoff.load(snapshot)`, and resumes rendering in idle. No operator work continues in the background after close. Spaces without a registered contract cannot be detached (factory rejects with a clear error).
4. **Per-type routes.** `/app/*` → `MainShell`, `/preview/:id` → `SpacePreviewShell`, `/detach/space/:id` and `/detach/assistant` → `DetachShell`, `/browser` → `GenericBrowserShell`. Router guards redirect wrong `window × route` combinations.

## Component Specs

### `MainShell.vue`

- **Template.** Native traffic-light spacer, app sidebar, `<RouterView>`, global permission modal (Teleported to body), `<Notification />`, splash screen.
- **Bootstrap.** `initAppPaths()`, `profileStore.init()`, `authStore.initialize()`, start bridge listener, preload space actions + signal `spaces.actions_ready`, wire `useAppMenu`, `useDeepLink`, `useUpdater().autoCheckOnStartup()`, window-resize → chrome state, focus/blur → `construct:window-focus`. Broadcast auth/profile/project/theme over cross-window channels.
- **Owns.** Authoritative stores, bridge listener, operator connection, permission UI.

### `SpacePreviewShell.vue`

- **Template.** Preview toolbar (badge, space name, reload button, optional page sidebar), `<component :is="currentPage">`.
- **Bootstrap.** Subscribe to auth/project/theme from main (read-only mirror). Load IIFE via `loadSpaceFromDir` or `loadSpace`. Start manifest polling → hot-reload on change.
- **Owns.** In-preview space instance, reload state. Does not initialize backend stores.

### `DetachShell.vue`

Target is discriminated at the route:

```ts
type DetachTarget =
  | { kind: 'space'; spaceId: string; sessionId: string }
  | { kind: 'assistant'; sessionId: string }
```

- **Template (space).** Space toolbar (three teleport targets) + L2 sidebar (`SpaceSubNav`) + page content.
- **Template (assistant).** Full-bleed assistant UI; no sidebar.
- **Bootstrap.** Read `spaceId` (or `'assistant'`) and `sessionId` from the route. Subscribe to cross-window state. Resolve the space's handoff contract via `getHandoff(spaceId)`; if none is registered, render an error state (should have been prevented at factory-time — this is defence in depth). Then call `sessionHandoff.claim(spaceId, sessionId)`:
  1. Install a one-shot listener for `session:detach-ready` in the child window.
  2. Emit `session:detach-request` to main with `{ spaceId, sessionId, targetLabel }`.
  3. Main looks up the stashed `HandoffSnapshot` created by `handoff.save()` during `initiateDetach()`, then responds with `session:detach-ready` targeted at the requesting window label.
  4. Child calls `handoff.load(snapshot)` to rehydrate the space's runtime (conversation state, runnerSessionId, tool history, whatever the space owns).
  5. The space's `load()` is responsible for mounting its own runtime primitives (e.g., assistant's `useAgentSession`, coder's `useCoder` wiring with the restored `runnerSessionId`) and subscribing to operator stream events.
- **Window close (driven by Tauri `tauri://close-requested`).** `bootstrapDetach` registers a close-requested listener on mount. When it fires:
  1. Call `handoff.stopAndFinalize()`. This is per-space responsibility and must:
     - cancel any in-flight operator work using the space's own request-id tracking (for `useAgentSession`-based spaces: call `stop()` which invokes `operator.stopStream(activeRequestId)` — existing `stream.cancel` + `operator_stop_stream` path); for spaces with bespoke runners (e.g., coder), call the equivalent cancel primitive;
     - drop any partial/incomplete final `Turn` from the in-memory transcript so it is not persisted. In `useAgentSession`, a streaming assistant reply lives inside the trailing `Turn` object (`request` + partial `response` + `status: 'streaming'`), not as a standalone assistant message; `useAgentSession.stop()` alone does **not** discard that partially-streamed turn, so the handoff implementation must explicitly remove the trailing `Turn` if it was active when cancellation began.
     - return once the runtime is in a persistable idle state.
  2. Call `handoff.save()` to persist the cleaned state and capture the returned `HandoffSnapshot`.
  3. Emit `session:released` with that `HandoffSnapshot`.
  4. Allow the window to close.
  Main listens for `session:released`, receives the saved `HandoffSnapshot`, calls `handoff.load(snapshot)` via the same contract, and resumes rendering in idle state.
- **Owns.** A view of a live session for the duration it is claimed; the underlying session state is owned by the operator process and persisted via the space's handoff contract. The shell does not "shut down" — window close is the trigger; the shell simply handles the close-requested event.

### `GenericBrowserShell.vue`

Renders external web content inside the Construct window using a **Tauri child `Webview`** (not an `<iframe>`). Iframes are rejected by `X-Frame-Options` / `frame-ancestors` CSP on OAuth providers and many docs sites, which is why the existing `browser.rs` / `oauth.rs` paths use Tauri webviews today; this shell follows the same approach, wrapped in Vue chrome.

- **Window layout.** A single Tauri `WebviewWindow` with two child `Webview`s laid out vertically:
  - Top `Webview` (Vue chrome, ~44 px) renders the `GenericBrowserShell.vue` address bar + back/forward/reload/home controls. Same Vue app as the rest of Construct.
  - Bottom `Webview` renders the external URL. Created via `Webview` API with the target URL; no shared origin with the parent chrome.
  Communication between chrome and content webviews is via Tauri events (`crossWindow:nav`, `crossWindow:reload`), routed through the Rust side.
- **Bootstrap.** Read initial `url` from query. No auth/store subscriptions. Create the content webview via `invoke('browser_create_content_webview', { parentLabel, url })`, which lives in `desktop/src/browser.rs` and extends the current single-webview browser path.
- **Navigation.** Back/forward/reload call into the Rust side which calls the content webview's navigation API directly (Tauri 2 exposes navigate/reload on `Webview`).
- **URL guard.** Accepts `http:`, `https:`, and `http://localhost:*` only. Rejects `file:`, `javascript:`, `data:`.
- **Scope.** In-app browser for generic external viewing (docs, dev servers like `localhost:3000`, marketplace previews). **Does not replace** the existing external-launch browser in `browser.rs` (`open_external_url`) or the OAuth flow in `oauth.rs` — those continue to use their specialized paths. GenericBrowser is additive: a new capability for "view external URL inside Construct", not a rewrite of existing launch-in-system-browser or OAuth flows.

## Per-Space Handoff Contract

Not every space has the same session model. The assistant uses `useAgentSession` + `sessions.save/load`. Coder uses `useCoder` with its own `runnerSessionId` and profile-storage-backed `saveSession` (`frontend/spaces/coder/composables/useCoder.ts`). Future spaces may invent others. A one-shape-fits-all "detach = sessions.save + useAgentSession.stop" is wrong. Instead, each detachable space **registers a handoff adapter**; the detach plumbing is contract-bound, not session-implementation-bound.

```ts
// frontend/lib/crossWindow/handoffRegistry.ts

export interface HandoffSnapshot {
  spaceId: string
  sessionId: string
  payload: Record<string, unknown>  // opaque to the registry — space owns the shape
}

export interface SpaceHandoffContract {
  /**
   * Cancel any in-flight work and leave the runtime in a persistable idle state.
   * Must discard any partial/incomplete assistant turn — do not persist streamed-but-cancelled content.
   */
  stopAndFinalize(sessionId: string): Promise<void>

  /** Persist the current session state. Called on main before detach and on detach before close. */
  save(sessionId: string): Promise<HandoffSnapshot>

  /** Rehydrate the space's runtime from a snapshot. Called after load on the claiming window. */
  load(snapshot: HandoffSnapshot): Promise<void>

  /** Optional hook for the factory to verify detach is currently valid (e.g., "not while tool is running"). */
  canDetach?(sessionId: string): boolean
}

export function registerHandoff(spaceId: string, contract: SpaceHandoffContract): void
export function getHandoff(spaceId: string): SpaceHandoffContract | null
```

**Registration.** Each space registers at module load. Contracts live with the space, not in a central switch.

```ts
// frontend/spaces/assistant/handoff.ts
import { registerHandoff } from '@/lib/crossWindow/handoffRegistry'
import { useAgentSession } from '@/operator/useAgentSession'
import { sessions } from '@/operator/sessions'

registerHandoff('assistant', {
  async stopAndFinalize(sessionId) {
    const session = useAgentSession.resolve(sessionId)  // pattern to be defined
    const activeTurn = session.turns.value.at(-1)
    const shouldDropTrailingTurn = activeTurn?.status === 'streaming'
    if (session.isLoading.value) await session.stop()
    // useAgentSession stores a user request + assistant response together in one Turn.
    // If the last turn was still streaming when cancel began, drop that whole turn.
    if (shouldDropTrailingTurn && session.turns.value.at(-1)?.id === activeTurn?.id) {
      session.turns.value.pop()
    }
  },
  async save(sessionId) {
    return { spaceId: 'assistant', sessionId, payload: await sessions.save(sessionId) }
  },
  async load(snap) { await sessions.load(snap.sessionId, snap.payload) },
})
```

```ts
// frontend/spaces/coder/handoff.ts
registerHandoff('coder', {
  async stopAndFinalize(sessionId) {
    const coder = useCoder.resolve(sessionId)
    if (coder.isRunning.value) await coder.stop()   // calls the coder-side cancel, sets runnerSessionId idle
    // coder's message array already excludes partial streams (it appends on stream-complete), but verify
  },
  async save(sessionId) {
    const coder = useCoder.resolve(sessionId)
    return {
      spaceId: 'coder',
      sessionId,
      payload: {
        runnerSessionId: coder.runnerSessionId.value,
        messages: coder.messages.value,
        toolHistory: coder.toolHistory.value,
        agentId: coder.agentId.value,
        projectPath: coder.projectPath.value,
      },
    }
  },
  async load(snap) { await useCoder.hydrate(snap.payload) },
})
```

**Factory gating.** `openWindow({ type: 'detach-space', spaceId, … })` calls `getHandoff(spaceId)` and rejects with a clear error if no contract is registered. The main-window UI disables the "detach" button for spaces without a contract.

**MVP scope (Phase 5).** Assistant is the only space with a registered contract; the detach button is wired for it and disabled elsewhere. Coder's contract is **follow-on work** (Phase 5b): it lands once `useCoder` exposes the `resolve`/`hydrate`/`stop` primitives the contract needs. Other stateful spaces follow the same pattern as they need detach.

## `ConstructWindow` Factory

```ts
// lib/window/openWindow.ts
export type WindowSpec =
  | { type: 'space-preview'; spaceId: string; projectPath?: string }
  | { type: 'detach-space'; spaceId: string; sessionId: string; project?: string }
  | { type: 'detach-assistant'; sessionId: string }
  | { type: 'browser'; url: string; title?: string }

export interface ConstructWindowHandle {
  label: string
  type: WindowSpec['type']
  focus(): Promise<void>
  close(): Promise<void>
  emit(event: string, payload?: unknown): Promise<void>
}

export async function openWindow(spec: WindowSpec): Promise<ConstructWindowHandle>
```

**Per-type behavior (handled by the factory):**

| Type | Label | URL | Size | Focus-existing |
| --- | --- | --- | --- | --- |
| `space-preview` | `preview-<id>` | `/#/preview/<id>` (optional `?dir=`) | 1100×750 | Same `spaceId` → focus |
| `detach-space` | `detach-space-<id>-<nonce>` | `/#/detach/space/<id>?session=<sid>` | 1200×820 | Same `sessionId` → focus |
| `detach-assistant` | `detach-assistant-<nonce>` | `/#/detach/assistant?session=<sid>` | 480×700 | Same `sessionId` → focus |
| `browser` | `browser-<nonce>` | `/#/browser?url=<encoded>` | 1200×820 | Never (always new) |

**Usage from any component:**

```ts
const win = useConstructWindow()
await win.openSpacePreview({ spaceId: 'coder', projectPath: '/path' })
await win.openDetachedAssistant({ sessionId: 'sess_123' })                    // Phase 5 — ships
await win.openDetachedSpace({ spaceId: 'coder', sessionId: 'sess_123' })      // Phase 5b — requires coder handoff contract; rejects until then
await win.openBrowser({ url: 'https://localhost:3000', title: 'Dev server' })
```

`useConstructWindow` is a thin composable wrapping `openWindow` plus tracking state (`windows: Ref<ConstructWindowHandle[]>`, `getByLabel`, `closeAll`).

**Handoff gating.** `openDetachedSpace` and `openDetachedAssistant` call `getHandoff(spaceId)` before creating the window. If no contract is registered, the factory throws `HandoffNotRegisteredError` synchronously with a message listing registered contracts. Callers should check `hasHandoff(spaceId)` before showing a detach UI affordance.

**Browser fallback.** When `!isTauriEnv()`, the factory falls back to `window.open()` with sensible features. Returns the same handle shape; `emit` is a no-op. Detach types throw in non-Tauri environments (handoff cannot work without Tauri's event layer).

## Cross-Window State Sync

Main owns every authoritative store. Child windows mirror slices via Tauri events.

```ts
// lib/crossWindow/sync.ts
export const channels = {
  auth: 'construct:auth-state',
  profile: 'construct:profile-state',
  project: 'construct:project-state',
  permission: 'construct:permission',
  session: (id: string) => `construct:session-${id}`,
  theme: 'construct:theme',
} as const
```

| State | Main | Preview | Detach | Browser |
| --- | --- | --- | --- | --- |
| Auth | owns, broadcasts | mirrors | mirrors | — |
| Profile | owns, broadcasts | mirrors | mirrors | — |
| Project | owns, broadcasts | mirrors | mirrors (for this session) | — |
| Permissions | owns modal | — | forwards to main | — |
| Session stream | owns when not detached | — | owns while detached | — |
| Theme | owns, broadcasts | mirrors | mirrors | — |

### Permission Modal — Single Source of Truth

Only `MainShell` renders the global permission modal. When a permission request arrives in a detached session, `DetachShell` forwards it to main via Tauri event. Main shows the modal, the user decides, main sends the response back to the operator. Fixes the "every window runs its own permission UI" risk.

### Hydration on Window Open

Tauri commands execute in Rust, not inside the main webview's Pinia stores, so hydration is a **webview-to-webview request/response over Tauri events**, not a Tauri command. The pattern mirrors `bridgeListener.ts` (`bridgeListener.ts:28`), which already handles cross-webview request/response for bridge calls.

1. On mount, the child shell calls `crossWindow.hydrate()`, which generates a `requestId` and emits `construct:state-request` with `{ requestId, targetLabel: <self> }`.
2. Main's `MainShell` runs a `listen('construct:state-request', …)` handler. On a request, it snapshots `{ auth, profile, project, theme }` from Pinia stores and emits `construct:state-snapshot-<requestId>` targeted at the requesting window label (via `emitTo`).
3. Child shell's one-shot listener resolves the `hydrate()` promise with the snapshot payload.

After hydration, continuous updates come over the `listen` channels defined above. If main does not respond within a timeout (e.g., 2 s), child logs a warning and operates in "last known localStorage" mode until the next broadcast arrives.

### Failure Mode

If main closes unexpectedly, child windows show a "Main window closed — reopen Construct" banner and disable interactive features. Child windows never attempt to take over authority.

## `main.ts` and `App.vue` After the Refactor

**`main.ts` — ~40 lines.** `createApp`, `createPinia`, `router`, `initSpaceHost` (universal), register global components (`Icon`, `Notification`), mount. Every branching path moves into `bootstrap*.ts` files, invoked from the shell's `onMounted`.

**`App.vue` — ~30 lines.** A dispatcher:

```vue
<script setup lang="ts">
import { shallowRef, onMounted } from 'vue'
import { resolveWindowType } from '@/lib/window/windowType'
import MainShell from '@/shells/MainShell.vue'
import SpacePreviewShell from '@/shells/SpacePreviewShell.vue'
import DetachShell from '@/shells/DetachShell.vue'
import GenericBrowserShell from '@/shells/GenericBrowserShell.vue'

const shells = {
  main: MainShell,
  'space-preview': SpacePreviewShell,
  detach: DetachShell,
  browser: GenericBrowserShell,
}

const shell = shallowRef<typeof MainShell | null>(null)
onMounted(async () => {
  const type = await resolveWindowType()
  shell.value = shells[type]
})
</script>

<template>
  <component :is="shell" v-if="shell" />
</template>
```

`resolveWindowType` reads the Tauri window label and maps prefixes to types:

- `''` or `'main'` → `main`
- `preview-*` → `space-preview`
- `detach-space-*` or `detach-assistant-*` → `detach` (single dispatcher target; `DetachShell` discriminates on its route internally)
- `browser-*` → `browser`
- anything else → `main` (safe fallback)

## Migration Plan

Six phases, each shippable as its own PR into `dev`. Old and new paths coexist until a phase explicitly removes the old one.

### Phase 1 — Infrastructure, no behavior change *(low risk)*

- Add `lib/window/windowType.ts`, `lib/window/openWindow.ts`, `lib/crossWindow/sync.ts`, `composables/useUniversalBootstrap.ts`.
- Unit tests for `resolveWindowType` and the factory's URL/label construction.
- Nothing imported yet.

### Phase 2 — Extract `MainShell` *(low risk, pure move)*

- Create `shells/MainShell.vue` and move today's `App.vue` content into it verbatim.
- `App.vue` becomes the 30-line dispatcher; its shell map initially only contains `main: MainShell`, so every window still lands on `MainShell`.
- Verify main window boot and all flows are unaffected.

### Phase 3 — Bootstrap extraction *(medium risk)*

- Create `lib/window/bootstrapMain.ts`; move profile/auth/bridge/telemetry/updater init from `main.ts` and `App.vue` into it.
- `MainShell.onMounted` calls `bootstrapMain()`; `main.ts` shrinks to ~40 lines.
- Delete `lib/windowBootstrap.ts` after verifying no regressions.

### Phase 4 — `SpacePreviewShell` *(low risk, isolated)*

- Convert `SpacePreviewPage.vue` → `shells/SpacePreviewShell.vue` + `bootstrapPreview.ts`.
- Dispatcher gains `'space-preview': SpacePreviewShell`.
- Migrate callers from `useSpacePreview` to `openWindow({ type: 'space-preview', … })`; delete `useSpacePreview.ts`.

### Phase 5 — `DetachShell` + session handoff *(high risk)*

- Create `shells/DetachShell.vue` (space + assistant modes) and `bootstrapDetach.ts`.
- Implement `lib/crossWindow/handoffRegistry.ts` (`registerHandoff`, `getHandoff`, `HandoffSnapshot`, `SpaceHandoffContract`).
- Implement `lib/crossWindow/sessionHandoff.ts` — `claim(spaceId, sessionId)` (wait for `session:detach-ready` carrying a `HandoffSnapshot`, then call the registered `handoff.load(snapshot)`) / `release(spaceId, sessionId)` (call `handoff.stopAndFinalize(sessionId)` → `handoff.save(sessionId)` → emit `session:released` with the returned `HandoffSnapshot`). The handoff registry is the only thing that knows about space-specific runtimes; `sessionHandoff.ts` is generic. No new operator-side cancel API is introduced; cancellation happens inside each space's `stopAndFinalize` via whatever request-id-scoped path that space already uses (`operator.stopStream` for `useAgentSession`-based spaces, bespoke for others).
- Implement `spaces/assistant/handoff.ts` with the full contract. Explicitly pop the trailing incomplete assistant turn in `stopAndFinalize` before `save` runs — the current `useAgentSession.stop()` does **not** discard already-streamed content by itself (`useAgentSession.ts:485`), so this cleanup must be explicit.
- Confirm `sessions.save` / `sessions.load` round-trip preserves conversation transcript, tool calls, and project context for the assistant. If gaps exist, extend the payload in `useAgentSession.ts:83` / `useAgentSession.ts:539` *as a prerequisite* to Phase 5 shipping — the handoff is only correct if persistence is complete.
- **Assistant is the only space with a registered contract in Phase 5.** The detach button is enabled only for spaces where `getHandoff(spaceId) !== null`; every other space keeps the button disabled until its own contract lands. This is intentional scope narrowing — Phase 5 ships assistant detach, not generic space detach.
- Migrate popout path from `useSpaceRunner` to `openWindow({ type: 'detach-assistant', … })` for the assistant case. Popouts of non-assistant spaces (e.g., coder) continue to use the existing `useSpaceRunner` path until their Phase 5b contracts land.
- Replace `standalone-assistant` static window in `tauri.conf.json` with a dynamic `openWindow({ type: 'detach-assistant', sessionId })` call from the main window's "pop out assistant" action. Keep `/assistant` route as a redirect wrapper for one release, then remove.
- **Phase 5b (follow-on, not in this phase).** Add `spaces/coder/handoff.ts`, expose the `resolve`/`hydrate`/`stop` primitives on `useCoder` that the contract requires, migrate coder popouts. Same pattern for any other stateful space that wants detach.
- Gating test Phase 5: detach assistant with an active generation, close the detached window mid-stream; verify (a) `operator.stopStream(activeRequestId)` fires and operator logs show cancel, (b) the trailing partial assistant turn is popped before `sessions.save`, (c) `sessions.save` persists the cleaned state, (d) main re-loads and shows the assistant idle at the last complete turn, (e) no background tokens or tool calls continue after close.
- Implement permission-modal forwarding from detach to main.

### Phase 6 — `GenericBrowserShell`, full cross-window sync, cleanup *(low risk)*

- Create `shells/GenericBrowserShell.vue` and `bootstrapBrowser.ts`.
- Migrate remaining `useConstructWindow` callers to `openWindow({ type: 'browser', … })`; delete `useConstructWindow.ts`.
- Activate full cross-window sync: broadcast auth/profile/project/theme from main; child shells mirror. Remove the "child window skips init" pattern — hydration is now explicit via `crossWindow.hydrate()`.
- Delete `SpaceRunnerPage.vue`, `SpacePreviewPage.vue`, `AssistantPage.vue` (or retain thin redirect wrappers for one release).
- Update `docs/` and `CHANGELOG`.

**Rollback.** Each phase is its own PR; revert is a single `git revert`. No feature flag needed — old and new paths coexist within a phase boundary.

## Testing Strategy

### Unit (Vitest)

- `resolveWindowType(label)` — table-driven per the type taxonomy; unknown labels fall back to `main`.
- `openWindow` factory — per-type URL/label construction; mocked Tauri `WebviewWindow`; browser fallback to `window.open`.
- `crossWindow/sync.ts` — broadcast on channel A does not leak to channel B; payloads round-trip through typed listeners. Mocks `@tauri-apps/api/event`.
- `handoffRegistry` — `registerHandoff` / `getHandoff` round-trip; re-registering the same `spaceId` replaces the previous contract; `getHandoff('unknown')` returns `null`.
- `sessionHandoff` — state machine correctness: `claim(spaceId, sid)` when already held → rejects; `release(spaceId, sid)` when not held → no-op; on release, contract methods are invoked in order `stopAndFinalize` → `save` → `session:released`, and the emitted event carries the `HandoffSnapshot` returned by `save` (ordering verified via mock contract with spies on each method). Idempotent release.
- Assistant handoff — `stopAndFinalize` drops the trailing incomplete `Turn` before returning: fixture session with `[turn(done), turn(streaming)]` → after `stopAndFinalize`, turns are `[turn(done)]`. Fixture with only complete turns → unchanged. Fixture with no active streaming turn → unchanged.
- `openWindow({ type: 'detach-space', spaceId: 'coder' })` rejects with `HandoffNotRegisteredError` when coder contract is not registered; succeeds after `registerHandoff('coder', …)` is called.
- `GenericBrowser` URL guard — only `http:`, `https:`, and `http://localhost:*` accepted; rejects `file:` and `javascript:`.

### Component (Vitest + @testing-library/vue)

- `App.vue` — stubbed `resolveWindowType` returns each type; correct shell mounts. No shell renders before `onMounted` resolves.
- `MainShell` — splash dismisses after bootstrap; permission modal renders when pending; `<RouterView>` only after `appReady`.
- `DetachShell` — space mode renders `SpaceSubNav`; assistant mode does not. Active subspace reflects the route.
- `SpacePreviewShell` — reload button triggers reload; polling spawns and cleans up.
- `GenericBrowserShell` — address bar submit invokes `browser_create_content_webview` or its navigate equivalent (mocked); back/forward dispatches nav events that resolve through the mock. Internal history ref walks correctly.

### Integration (manual runbook, per-phase)

- Fresh boot → main only. Open a preview → two windows. Close preview → one.
- **Assistant detach (Phase 5, in scope).** Detach assistant from main → assistant continues in detached window; main shows a detached placeholder. Type in the detached assistant; verify state. Close detached → assistant restored in main at the same transcript, **with any in-flight generation cancelled**: detach during a long response, close the window, and confirm (a) operator logs show `stream.cancel` + `operator_stop_stream` for the local `activeRequestId`, (b) the trailing incomplete assistant turn is popped before persistence, (c) `sessions.save` persists the cleaned transcript, (d) main re-loads at the last complete turn. No background completion continues after close.
- **Coder detach (Phase 5b, deferred).** Until `spaces/coder/handoff.ts` lands, the coder detach button is disabled; verify the factory rejects `detach-space` for `coder` with `HandoffNotRegisteredError`. Once the Phase 5b contract is merged, re-run the same checklist using coder's `runnerSessionId`-based state.
- Log out in main while a detach window is open → detached reflects logout.
- Permission request in a detached session → modal appears in main, not detach; approval resumes detached session.
- Kill main window (Cmd+W) while a detach exists → detached shows "Main window closed — reopen Construct".

### Regression Lock

- `bun run test` stays green after each phase.
- `bun run typecheck` remains clean; no `any` introduced in new shells.
- Per-phase smoke: open main, open preview, log in, open a space, send a message.

### Out of Scope for Auto-Tests (runbook only)

- Tauri IPC round-trips (require a real runtime).
- Multi-monitor placement (OS-specific).
- `standalone-assistant` removal — manual check that the dynamic assistant detach lands at the expected window size and position.

## Open Questions

- **`sessions.save`/`sessions.load` completeness for the assistant.** Phase 5 depends on the existing assistant persistence APIs round-tripping everything the detach window needs to render: full conversation transcript, completed tool calls, project context, model selection, session-scoped UI state. Before Phase 5 is implementable, audit `useAgentSession.ts:83` (initial state) and `useAgentSession.ts:539` (save path) to confirm parity; extend the payload if gaps exist. This is the biggest unresolved dependency for the MVP.
- **Coder handoff contract primitives (Phase 5b).** `useCoder` does not currently expose a `resolve(sessionId)` / `hydrate(payload)` / `stop()` surface that the contract pattern needs. Phase 5b spec can decide whether to refactor `useCoder` to singleton-per-sessionId (matching assistant), or to expose explicit resolver helpers. Deferred until Phase 5 lands and the handoff contract is proven with assistant.
- **Partial-turn semantics across spaces.** Phase 5 defines "pop trailing incomplete assistant turn" for the assistant. Each new space joining Phase 5b must define, in its `stopAndFinalize`, what a "partial" turn looks like in its runtime and how to drop it — there is no generic cleanup helper.
- **`browser_create_content_webview` Tauri command.** Phase 6 assumes a new Rust-side command that creates a child `Webview` inside the `GenericBrowserShell` parent window, wired to navigation events. This extends the existing `browser.rs` path from "launch external webview" to "create child webview in parent window"; needs a short Rust implementation spike to confirm Tauri 2's `Webview` API behaves correctly across macOS/Windows/Linux before locking Phase 6 scope.
- **Project context per detach window.** Today the design mirrors main's project. If a detached window should allow switching to a different project without affecting main, it needs a per-window project override — deferred until a concrete use case appears.
