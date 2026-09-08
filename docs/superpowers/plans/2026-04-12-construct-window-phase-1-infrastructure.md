# ConstructWindow — Phase 1: Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the typed window factory, cross-window event bus, per-space handoff registry, and universal bootstrap composable. No behavior change — no existing file imports these yet. All new modules land with full unit tests.

**Architecture:** Five new modules, each self-contained and individually testable. The public entry points (`openWindow`, `registerHandoff`, `resolveWindowType`, `broadcast`/`listen`, `useUniversalBootstrap`) are designed in Phase 1 so subsequent phases (MainShell extraction, PreviewShell, DetachShell, BrowserShell) can consume them without further infrastructure work.

**Tech Stack:** TypeScript, Vue 3, Pinia, Tauri 2 (`@tauri-apps/api/webviewWindow`, `@tauri-apps/api/event`), Vitest (node environment, tests colocated as `*.test.ts`).

**Spec reference:** `docs/superpowers/specs/2026-04-12-construct-window-design.md` — this plan implements the "Phase 1 — Infrastructure, no behavior change" section.

**Out of scope for this plan:**
- Shell extraction (Phase 2+).
- Bootstrap extraction from `main.ts` / `App.vue` (Phase 3).
- `sessionHandoff.ts` claim/release state machine (Phase 5 — needs a working shell to test against).
- Any wiring of existing code to the new modules (intentional — Phase 1 is additive only).

---

## File Structure

| File | Purpose |
| --- | --- |
| `frontend/lib/window/windowType.ts` | `getWindowLabel()` + `resolveWindowTypeFromLabel()` + async `resolveWindowType()`. Single source of truth for label → type mapping. |
| `frontend/lib/window/windowType.test.ts` | Pure-logic tests for the label → type mapping table. |
| `frontend/lib/crossWindow/handoffRegistry.ts` | `SpaceHandoffContract` interface, `registerHandoff`/`getHandoff`/`hasHandoff`/`registeredSpaces`, `HandoffNotRegisteredError`, test-only `__resetHandoffRegistry`. |
| `frontend/lib/crossWindow/handoffRegistry.test.ts` | Register/retrieve/replace/list tests. |
| `frontend/lib/crossWindow/sync.ts` | `channels` constants, `stateSnapshotChannel`/`sessionChannel` helpers, `broadcast`/`emitTo`/`listen` thin wrappers over Tauri's event API. |
| `frontend/lib/crossWindow/sync.test.ts` | Channel-constant uniqueness, helper-string construction, Tauri-event call-through with mocks, no-op-outside-Tauri guarantee. |
| `frontend/lib/window/openWindow.ts` | `WindowSpec` union, `ConstructWindowHandle` interface, pure `resolveSpec()`/`validateSpec()` helpers, async `openWindow()` creating either a Tauri `WebviewWindow` or a browser `window.open` fallback. |
| `frontend/lib/window/openWindow.test.ts` | URL/label construction per type, handoff gating for detach types, URL protocol guard for browser type. |
| `frontend/composables/useUniversalBootstrap.ts` | Theme init + `Cmd+Alt+I` devtools shortcut + prod-only context-menu suppression. Called from every shell's `onMounted`. |
| `frontend/composables/useUniversalBootstrap.test.ts` | Smoke mount/unmount test with mocked Tauri env. |

Directories created in this phase: `frontend/lib/window/`, `frontend/lib/crossWindow/`. Neither exists yet.

---

## Conventions

- All new modules use `@/` import alias — e.g., `import { isTauriEnv } from '@/utils/tauri'`.
- Tests colocated next to source (`<name>.test.ts`), matching the pattern in `frontend/composables/useAIModel.test.ts` and `frontend/spaces/coder/composables/useCoder.test.ts`.
- Vitest: `environment: 'node'`; Tauri APIs mocked via `vi.mock('@tauri-apps/api/...')`.
- Every task ends with a commit. Commit messages use imperative mood (no "Co-Authored-By"), per repo convention.
- Before committing, run `bun run typecheck` and `bun run test` from `construct-app/` to ensure green.

---

## Task 1: `windowType.ts` — label → type resolution

**Files:**
- Create: `frontend/lib/window/windowType.ts`
- Test:   `frontend/lib/window/windowType.test.ts`

- [ ] **Step 1: Create the test file with failing cases**

Write `frontend/lib/window/windowType.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveWindowTypeFromLabel } from './windowType'

describe('resolveWindowTypeFromLabel', () => {
  it('returns "main" for null', () => {
    expect(resolveWindowTypeFromLabel(null)).toBe('main')
  })

  it('returns "main" for empty string', () => {
    expect(resolveWindowTypeFromLabel('')).toBe('main')
  })

  it('returns "main" for the "main" label', () => {
    expect(resolveWindowTypeFromLabel('main')).toBe('main')
  })

  it('returns "space-preview" for preview-* labels', () => {
    expect(resolveWindowTypeFromLabel('preview-coder')).toBe('space-preview')
    expect(resolveWindowTypeFromLabel('preview-my-space-123')).toBe('space-preview')
  })

  it('returns "detach" for detach-space-* labels', () => {
    expect(resolveWindowTypeFromLabel('detach-space-coder-abc123')).toBe('detach')
    expect(resolveWindowTypeFromLabel('detach-space-architect-xyz')).toBe('detach')
  })

  it('returns "detach" for detach-assistant-* labels', () => {
    expect(resolveWindowTypeFromLabel('detach-assistant-abc123')).toBe('detach')
  })

  it('returns "browser" for browser-* labels', () => {
    expect(resolveWindowTypeFromLabel('browser-xyz')).toBe('browser')
  })

  it('falls back to "main" for unknown labels', () => {
    expect(resolveWindowTypeFromLabel('unknown')).toBe('main')
    expect(resolveWindowTypeFromLabel('standalone-assistant')).toBe('main')
    expect(resolveWindowTypeFromLabel('detach-other-123')).toBe('main')
  })
})
```

- [ ] **Step 2: Run to confirm failure**

From `construct-app/`:

```bash
bun run test -- windowType
```

Expected: failures with "Cannot find module './windowType'" or similar. This confirms the test targets the not-yet-existing module.

- [ ] **Step 3: Implement the module**

Write `frontend/lib/window/windowType.ts`:

```ts
import { isTauriEnv } from '@/utils/tauri'

export type WindowType = 'main' | 'space-preview' | 'detach' | 'browser'

export async function getWindowLabel(): Promise<string | null> {
  if (!isTauriEnv()) return null
  try {
    const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow')
    return getCurrentWebviewWindow().label
  } catch {
    return null
  }
}

export function resolveWindowTypeFromLabel(label: string | null): WindowType {
  if (!label || label === 'main') return 'main'
  if (label.startsWith('preview-')) return 'space-preview'
  if (label.startsWith('detach-space-') || label.startsWith('detach-assistant-')) return 'detach'
  if (label.startsWith('browser-')) return 'browser'
  return 'main'
}

export async function resolveWindowType(): Promise<WindowType> {
  return resolveWindowTypeFromLabel(await getWindowLabel())
}
```

- [ ] **Step 4: Run the tests again — expect pass**

```bash
bun run test -- windowType
```

Expected: 8 assertions pass.

- [ ] **Step 5: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd construct-app
git add frontend/lib/window/windowType.ts frontend/lib/window/windowType.test.ts
git commit -m "feat(window): add resolveWindowType label → type mapping"
```

---

## Task 2: `handoffRegistry.ts` — per-space handoff contracts

**Files:**
- Create: `frontend/lib/crossWindow/handoffRegistry.ts`
- Test:   `frontend/lib/crossWindow/handoffRegistry.test.ts`

- [ ] **Step 1: Write the failing test**

Write `frontend/lib/crossWindow/handoffRegistry.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import {
  registerHandoff,
  getHandoff,
  hasHandoff,
  registeredSpaces,
  __resetHandoffRegistry,
  HandoffNotRegisteredError,
  type SpaceHandoffContract,
} from './handoffRegistry'

function makeContract(): SpaceHandoffContract {
  return {
    stopAndFinalize: async () => {},
    save: async (sessionId) => ({ spaceId: 'test', sessionId, payload: {} }),
    load: async () => {},
  }
}

describe('handoffRegistry', () => {
  beforeEach(() => __resetHandoffRegistry())

  it('returns null for an unregistered space', () => {
    expect(getHandoff('unknown')).toBeNull()
    expect(hasHandoff('unknown')).toBe(false)
  })

  it('stores and retrieves a registered contract', () => {
    const contract = makeContract()
    registerHandoff('assistant', contract)
    expect(getHandoff('assistant')).toBe(contract)
    expect(hasHandoff('assistant')).toBe(true)
  })

  it('replaces a previously-registered contract for the same spaceId', () => {
    const first = makeContract()
    const second = makeContract()
    registerHandoff('assistant', first)
    registerHandoff('assistant', second)
    expect(getHandoff('assistant')).toBe(second)
  })

  it('lists all registered spaces', () => {
    registerHandoff('assistant', makeContract())
    registerHandoff('coder', makeContract())
    expect(registeredSpaces().sort()).toEqual(['assistant', 'coder'])
  })

  it('HandoffNotRegisteredError carries the requested spaceId and registered list', () => {
    registerHandoff('assistant', makeContract())
    const err = new HandoffNotRegisteredError('coder', registeredSpaces())
    expect(err.message).toContain("'coder'")
    expect(err.message).toContain('assistant')
    expect(err.name).toBe('HandoffNotRegisteredError')
  })

  it('HandoffNotRegisteredError lists "<none>" when no contracts are registered', () => {
    const err = new HandoffNotRegisteredError('coder', [])
    expect(err.message).toContain('<none>')
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
bun run test -- handoffRegistry
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement the module**

Write `frontend/lib/crossWindow/handoffRegistry.ts`:

```ts
export interface HandoffSnapshot {
  spaceId: string
  sessionId: string
  payload: Record<string, unknown>
}

export interface SpaceHandoffContract {
  /**
   * Cancel in-flight work and leave the runtime in a persistable idle state.
   * Must discard any partial/incomplete turn; do not persist streamed-but-cancelled content.
   */
  stopAndFinalize(sessionId: string): Promise<void>

  /** Persist the current session state; called on main before detach and on detach before close. */
  save(sessionId: string): Promise<HandoffSnapshot>

  /** Rehydrate the space's runtime from a snapshot. Called after claim on the receiving window. */
  load(snapshot: HandoffSnapshot): Promise<void>

  /** Optional: verify detach is currently valid (e.g., not while a tool is running). */
  canDetach?(sessionId: string): boolean
}

export class HandoffNotRegisteredError extends Error {
  constructor(spaceId: string, registered: string[]) {
    super(
      `No handoff contract registered for space '${spaceId}'. ` +
      `Registered: [${registered.join(', ') || '<none>'}]`,
    )
    this.name = 'HandoffNotRegisteredError'
  }
}

const registry = new Map<string, SpaceHandoffContract>()

export function registerHandoff(spaceId: string, contract: SpaceHandoffContract): void {
  registry.set(spaceId, contract)
}

export function getHandoff(spaceId: string): SpaceHandoffContract | null {
  return registry.get(spaceId) ?? null
}

export function hasHandoff(spaceId: string): boolean {
  return registry.has(spaceId)
}

export function registeredSpaces(): string[] {
  return Array.from(registry.keys())
}

/** Test-only: clear the module-local registry between test cases. */
export function __resetHandoffRegistry(): void {
  registry.clear()
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
bun run test -- handoffRegistry
```

Expected: 6 assertions pass.

- [ ] **Step 5: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd construct-app
git add frontend/lib/crossWindow/handoffRegistry.ts frontend/lib/crossWindow/handoffRegistry.test.ts
git commit -m "feat(crossWindow): add per-space handoff contract registry"
```

---

## Task 3: `crossWindow/sync.ts` — typed Tauri event bus

**Files:**
- Create: `frontend/lib/crossWindow/sync.ts`
- Test:   `frontend/lib/crossWindow/sync.test.ts`

- [ ] **Step 1: Write the failing test**

Write `frontend/lib/crossWindow/sync.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  channels,
  stateSnapshotChannel,
  sessionChannel,
  broadcast,
  emitTo,
  listen,
} from './sync'

const tauriEnvMock = vi.hoisted(() => ({ isTauriEnv: vi.fn(() => true) }))
vi.mock('@/utils/tauri', () => tauriEnvMock)

const tauriEventMock = vi.hoisted(() => ({
  emit: vi.fn(async () => {}),
  emitTo: vi.fn(async () => {}),
  listen: vi.fn(async (_c: string, _h: unknown) => () => {}),
}))
vi.mock('@tauri-apps/api/event', () => tauriEventMock)

describe('crossWindow/sync', () => {
  beforeEach(() => {
    tauriEventMock.emit.mockClear()
    tauriEventMock.emitTo.mockClear()
    tauriEventMock.listen.mockClear()
    tauriEnvMock.isTauriEnv.mockReturnValue(true)
  })

  it('channel constants are unique', () => {
    const values = Object.values(channels)
    expect(new Set(values).size).toBe(values.length)
  })

  it('stateSnapshotChannel interpolates the requestId', () => {
    expect(stateSnapshotChannel('abc')).toBe('construct:state-snapshot-abc')
  })

  it('sessionChannel interpolates the sessionId', () => {
    expect(sessionChannel('sess_1')).toBe('construct:session-sess_1')
  })

  it('broadcast calls tauri emit when in Tauri', async () => {
    await broadcast(channels.auth, { token: 't' })
    expect(tauriEventMock.emit).toHaveBeenCalledWith(channels.auth, { token: 't' })
  })

  it('broadcast is a no-op outside Tauri', async () => {
    tauriEnvMock.isTauriEnv.mockReturnValue(false)
    await broadcast(channels.auth, { token: 't' })
    expect(tauriEventMock.emit).not.toHaveBeenCalled()
  })

  it('emitTo forwards to a specific window label', async () => {
    await emitTo('detach-assistant-abc', channels.theme, 'dark')
    expect(tauriEventMock.emitTo).toHaveBeenCalledWith('detach-assistant-abc', channels.theme, 'dark')
  })

  it('listen registers a handler and returns an unlisten function', async () => {
    const unlisten = await listen(channels.theme, () => {})
    expect(tauriEventMock.listen).toHaveBeenCalled()
    expect(typeof unlisten).toBe('function')
  })

  it('listen returns a noop unlisten outside Tauri', async () => {
    tauriEnvMock.isTauriEnv.mockReturnValue(false)
    const unlisten = await listen(channels.theme, () => {})
    expect(tauriEventMock.listen).not.toHaveBeenCalled()
    expect(typeof unlisten).toBe('function')
    unlisten() // must be safely callable
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
bun run test -- crossWindow/sync
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement the module**

Write `frontend/lib/crossWindow/sync.ts`:

```ts
import { isTauriEnv } from '@/utils/tauri'

export const channels = {
  auth: 'construct:auth-state',
  profile: 'construct:profile-state',
  project: 'construct:project-state',
  permission: 'construct:permission',
  theme: 'construct:theme',
  sessionDetachReady: 'construct:session-detach-ready',
  sessionReleased: 'construct:session-released',
  stateRequest: 'construct:state-request',
} as const

export function stateSnapshotChannel(requestId: string): string {
  return `construct:state-snapshot-${requestId}`
}

export function sessionChannel(sessionId: string): string {
  return `construct:session-${sessionId}`
}

export type Unlisten = () => void

export async function broadcast(channel: string, payload: unknown): Promise<void> {
  if (!isTauriEnv()) return
  try {
    const { emit } = await import('@tauri-apps/api/event')
    await emit(channel, payload)
  } catch (err) {
    console.warn('[crossWindow.broadcast] failed:', channel, err)
  }
}

export async function emitTo(targetLabel: string, channel: string, payload: unknown): Promise<void> {
  if (!isTauriEnv()) return
  try {
    const { emitTo: tauriEmitTo } = await import('@tauri-apps/api/event')
    await tauriEmitTo(targetLabel, channel, payload)
  } catch (err) {
    console.warn('[crossWindow.emitTo] failed:', targetLabel, channel, err)
  }
}

export async function listen<T = unknown>(
  channel: string,
  handler: (payload: T) => void,
): Promise<Unlisten> {
  if (!isTauriEnv()) return () => {}
  try {
    const { listen: tauriListen } = await import('@tauri-apps/api/event')
    return await tauriListen<T>(channel, (event) => handler(event.payload))
  } catch (err) {
    console.warn('[crossWindow.listen] failed:', channel, err)
    return () => {}
  }
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
bun run test -- crossWindow/sync
```

Expected: 8 assertions pass.

- [ ] **Step 5: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd construct-app
git add frontend/lib/crossWindow/sync.ts frontend/lib/crossWindow/sync.test.ts
git commit -m "feat(crossWindow): add typed event channels and broadcast/listen helpers"
```

---

## Task 4: `openWindow.ts` — typed window factory

**Files:**
- Create: `frontend/lib/window/openWindow.ts`
- Test:   `frontend/lib/window/openWindow.test.ts`

This task covers only the pure-logic parts (`resolveSpec`, `validateSpec`) under TDD. The `openWindow` async function that actually calls Tauri is written immediately after but not integration-tested in Phase 1 (no shell to host it yet) — its correctness is covered by the pure helpers plus a type-level check.

- [ ] **Step 1: Write failing tests for `resolveSpec` and `validateSpec`**

Write `frontend/lib/window/openWindow.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { resolveSpec, validateSpec } from './openWindow'
import {
  registerHandoff,
  __resetHandoffRegistry,
  type SpaceHandoffContract,
} from '@/lib/crossWindow/handoffRegistry'

function stubContract(): SpaceHandoffContract {
  return {
    stopAndFinalize: async () => {},
    save: async (sessionId: string) => ({ spaceId: 'x', sessionId, payload: {} }),
    load: async () => {},
  }
}

describe('resolveSpec', () => {
  it('constructs space-preview URL with encoded projectPath', () => {
    const r = resolveSpec({
      type: 'space-preview',
      spaceId: 'coder',
      projectPath: '/Users/me/my space',
    })
    expect(r.label).toBe('preview-coder')
    expect(r.url).toContain('/#/preview/coder')
    expect(r.url).toContain(`dir=${encodeURIComponent('/Users/me/my space')}`)
    expect(r.focusExistingBy).toBe('spaceId')
  })

  it('constructs space-preview URL without dir when projectPath omitted', () => {
    const r = resolveSpec({ type: 'space-preview', spaceId: 'coder' })
    expect(r.url).toBe('/#/preview/coder')
  })

  it('detach-space label uses prefix + spaceId + nonce; URL carries session', () => {
    const r = resolveSpec({ type: 'detach-space', spaceId: 'coder', sessionId: 'sess_1' })
    expect(r.label).toMatch(/^detach-space-coder-/)
    expect(r.url).toContain('/#/detach/space/coder')
    expect(r.url).toContain('session=sess_1')
    expect(r.focusExistingBy).toBe('sessionId')
  })

  it('detach-space URL encodes project path when provided', () => {
    const r = resolveSpec({
      type: 'detach-space',
      spaceId: 'coder',
      sessionId: 'sess_1',
      project: '/tmp/proj space',
    })
    expect(r.url).toContain(`project=${encodeURIComponent('/tmp/proj space')}`)
  })

  it('detach-assistant uses detach-assistant- prefix and /#/detach/assistant URL', () => {
    const r = resolveSpec({ type: 'detach-assistant', sessionId: 'sess_2' })
    expect(r.label).toMatch(/^detach-assistant-/)
    expect(r.url).toContain('/#/detach/assistant')
    expect(r.url).toContain('session=sess_2')
    expect(r.focusExistingBy).toBe('sessionId')
  })

  it('browser URL is hash-routed with encoded target URL', () => {
    const r = resolveSpec({ type: 'browser', url: 'https://google.com/?q=hi' })
    expect(r.label).toMatch(/^browser-/)
    expect(r.url).toContain('/#/browser?url=')
    expect(r.url).toContain(encodeURIComponent('https://google.com/?q=hi'))
    expect(r.focusExistingBy).toBeNull()
  })

  it('assigns sane default sizes per type', () => {
    expect(resolveSpec({ type: 'space-preview', spaceId: 'x' }).width).toBe(1100)
    expect(resolveSpec({ type: 'detach-space', spaceId: 'x', sessionId: 's' }).width).toBe(1200)
    expect(resolveSpec({ type: 'detach-assistant', sessionId: 's' }).width).toBe(480)
    expect(resolveSpec({ type: 'browser', url: 'https://x.com' }).width).toBe(1200)
  })
})

describe('validateSpec', () => {
  beforeEach(() => __resetHandoffRegistry())

  it('detach-space rejects when no handoff is registered', () => {
    expect(() =>
      validateSpec({ type: 'detach-space', spaceId: 'coder', sessionId: 's' }),
    ).toThrow(/No handoff contract registered for space 'coder'/)
  })

  it('detach-space accepts when handoff is registered', () => {
    registerHandoff('coder', stubContract())
    expect(() =>
      validateSpec({ type: 'detach-space', spaceId: 'coder', sessionId: 's' }),
    ).not.toThrow()
  })

  it('detach-assistant rejects when no assistant handoff registered', () => {
    expect(() =>
      validateSpec({ type: 'detach-assistant', sessionId: 's' }),
    ).toThrow(/'assistant'/)
  })

  it('detach-assistant accepts when assistant handoff registered', () => {
    registerHandoff('assistant', stubContract())
    expect(() =>
      validateSpec({ type: 'detach-assistant', sessionId: 's' }),
    ).not.toThrow()
  })

  it('browser rejects malformed URLs', () => {
    expect(() => validateSpec({ type: 'browser', url: 'not a url' }))
      .toThrow(/Invalid browser URL/)
  })

  it('browser rejects disallowed protocols', () => {
    expect(() => validateSpec({ type: 'browser', url: 'file:///etc/passwd' }))
      .toThrow(/Disallowed browser protocol 'file:'/)
    expect(() => validateSpec({ type: 'browser', url: 'javascript:alert(1)' }))
      .toThrow(/Disallowed browser protocol/)
  })

  it('browser accepts http and https', () => {
    expect(() => validateSpec({ type: 'browser', url: 'http://localhost:3000' })).not.toThrow()
    expect(() => validateSpec({ type: 'browser', url: 'https://example.com' })).not.toThrow()
  })

  it('space-preview does not require a handoff', () => {
    expect(() => validateSpec({ type: 'space-preview', spaceId: 'whatever' })).not.toThrow()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
bun run test -- openWindow
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement `openWindow.ts`**

Write `frontend/lib/window/openWindow.ts`:

```ts
import { isTauriEnv } from '@/utils/tauri'
import {
  hasHandoff,
  registeredSpaces,
  HandoffNotRegisteredError,
} from '@/lib/crossWindow/handoffRegistry'

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

export interface ResolvedSpec {
  label: string
  url: string
  width: number
  height: number
  title: string
  focusExistingBy: 'spaceId' | 'sessionId' | null
}

const ALLOWED_BROWSER_PROTOCOLS = new Set(['http:', 'https:'])

let nonceCounter = 0
function nextNonce(): string {
  nonceCounter++
  return `${Date.now().toString(36)}-${nonceCounter}`
}

export function resolveSpec(spec: WindowSpec): ResolvedSpec {
  switch (spec.type) {
    case 'space-preview': {
      const label = `preview-${spec.spaceId}`
      const dir = spec.projectPath ? `?dir=${encodeURIComponent(spec.projectPath)}` : ''
      return {
        label,
        url: `/#/preview/${spec.spaceId}${dir}`,
        width: 1100,
        height: 750,
        title: `Preview — ${spec.spaceId}`,
        focusExistingBy: 'spaceId',
      }
    }
    case 'detach-space': {
      const label = `detach-space-${spec.spaceId}-${nextNonce()}`
      const proj = spec.project ? `&project=${encodeURIComponent(spec.project)}` : ''
      return {
        label,
        url: `/#/detach/space/${spec.spaceId}?session=${encodeURIComponent(spec.sessionId)}${proj}`,
        width: 1200,
        height: 820,
        title: spec.spaceId,
        focusExistingBy: 'sessionId',
      }
    }
    case 'detach-assistant': {
      const label = `detach-assistant-${nextNonce()}`
      return {
        label,
        url: `/#/detach/assistant?session=${encodeURIComponent(spec.sessionId)}`,
        width: 480,
        height: 700,
        title: 'Operator',
        focusExistingBy: 'sessionId',
      }
    }
    case 'browser': {
      const label = `browser-${nextNonce()}`
      return {
        label,
        url: `/#/browser?url=${encodeURIComponent(spec.url)}`,
        width: 1200,
        height: 820,
        title: spec.title ?? 'Construct Browser',
        focusExistingBy: null,
      }
    }
  }
}

export function validateSpec(spec: WindowSpec): void {
  if (spec.type === 'detach-space') {
    if (!hasHandoff(spec.spaceId)) {
      throw new HandoffNotRegisteredError(spec.spaceId, registeredSpaces())
    }
    return
  }
  if (spec.type === 'detach-assistant') {
    if (!hasHandoff('assistant')) {
      throw new HandoffNotRegisteredError('assistant', registeredSpaces())
    }
    return
  }
  if (spec.type === 'browser') {
    let parsed: URL
    try {
      parsed = new URL(spec.url)
    } catch {
      throw new Error(`Invalid browser URL: ${spec.url}`)
    }
    if (!ALLOWED_BROWSER_PROTOCOLS.has(parsed.protocol)) {
      throw new Error(
        `Disallowed browser protocol '${parsed.protocol}' — allowed: ${[...ALLOWED_BROWSER_PROTOCOLS].join(', ')}`,
      )
    }
  }
}

export async function openWindow(spec: WindowSpec): Promise<ConstructWindowHandle> {
  validateSpec(spec)
  const resolved = resolveSpec(spec)

  if (isTauriEnv()) {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')

    if (resolved.focusExistingBy === 'spaceId') {
      const existing = await WebviewWindow.getByLabel(resolved.label)
      if (existing) {
        await existing.setFocus()
        return wrap(resolved.label, spec.type, existing)
      }
    }
    // focusExistingBy === 'sessionId' (detach windows) — Phase 1 always
    // opens a new window. Sessionid-based focus-existing lookup lands with
    // sessionHandoff in Phase 5, where the sessionId lifecycle is owned.

    const win = new WebviewWindow(resolved.label, {
      url: resolved.url,
      title: resolved.title,
      width: resolved.width,
      height: resolved.height,
      center: true,
      decorations: true,
      resizable: true,
      minimizable: true,
      maximizable: true,
      closable: true,
    })

    return wrap(resolved.label, spec.type, win)
  }

  if (spec.type !== 'browser' && spec.type !== 'space-preview') {
    throw new Error(`Window type '${spec.type}' is not supported outside Tauri`)
  }

  const popup = window.open(
    resolved.url,
    resolved.label,
    `width=${resolved.width},height=${resolved.height},resizable=yes,menubar=no,toolbar=no`,
  )
  return {
    label: resolved.label,
    type: spec.type,
    focus: async () => { popup?.focus() },
    close: async () => { popup?.close() },
    emit: async () => { /* no-op in browser */ },
  }
}

interface TauriWindowLike {
  setFocus(): Promise<void>
  close(): Promise<void>
  emit?(event: string, payload?: unknown): Promise<void>
}

function wrap(label: string, type: WindowSpec['type'], win: TauriWindowLike): ConstructWindowHandle {
  return {
    label,
    type,
    focus: () => win.setFocus(),
    close: () => win.close(),
    emit: async (event: string, payload?: unknown) => {
      if (typeof win.emit === 'function') await win.emit(event, payload)
    },
  }
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
bun run test -- openWindow
```

Expected: 15 tests pass (7 in `resolveSpec`, 8 in `validateSpec`).

- [ ] **Step 5: Typecheck**

```bash
bun run typecheck
```

Expected: no errors. The `openWindow` async function is exercised by types but not runtime-tested in Phase 1.

- [ ] **Step 6: Commit**

```bash
cd construct-app
git add frontend/lib/window/openWindow.ts frontend/lib/window/openWindow.test.ts
git commit -m "feat(window): add typed openWindow factory with handoff gating and URL guard"
```

---

## Task 5: `useUniversalBootstrap.ts` — composable for per-shell boilerplate

**Files:**
- Create: `frontend/composables/useUniversalBootstrap.ts`
- Test:   `frontend/composables/useUniversalBootstrap.test.ts`

- [ ] **Step 1: Write the failing smoke test**

Write `frontend/composables/useUniversalBootstrap.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'

const themeMock = vi.hoisted(() => ({
  useTheme: vi.fn(() => ({ init: vi.fn() })),
}))
vi.mock('@construct-space/ui', () => themeMock)

const tauriEnvMock = vi.hoisted(() => ({ isTauriEnv: vi.fn(() => false) }))
vi.mock('@/utils/tauri', () => tauriEnvMock)

import { useUniversalBootstrap } from './useUniversalBootstrap'

describe('useUniversalBootstrap', () => {
  beforeEach(() => {
    themeMock.useTheme.mockClear()
    tauriEnvMock.isTauriEnv.mockReturnValue(false)
  })

  it('initializes theme on mount by default', async () => {
    const init = vi.fn()
    themeMock.useTheme.mockReturnValue({ init })

    const Comp = defineComponent({
      setup() { useUniversalBootstrap(); return () => h('div') },
    })
    const wrapper = mount(Comp)
    await nextTick()
    expect(init).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('skips theme init when disabled', async () => {
    const init = vi.fn()
    themeMock.useTheme.mockReturnValue({ init })

    const Comp = defineComponent({
      setup() { useUniversalBootstrap({ initTheme: false }); return () => h('div') },
    })
    mount(Comp)
    await nextTick()
    expect(init).not.toHaveBeenCalled()
  })

  it('mounts and unmounts cleanly outside Tauri', async () => {
    const Comp = defineComponent({
      setup() { useUniversalBootstrap(); return () => h('div') },
    })
    const wrapper = mount(Comp)
    await nextTick()
    expect(() => wrapper.unmount()).not.toThrow()
  })

  it('registers and removes the devtools keydown listener in Tauri env', async () => {
    tauriEnvMock.isTauriEnv.mockReturnValue(true)
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')

    const Comp = defineComponent({
      setup() { useUniversalBootstrap(); return () => h('div') },
    })
    const wrapper = mount(Comp)
    await nextTick()
    const registered = add.mock.calls.some(([evt]) => evt === 'keydown')
    expect(registered).toBe(true)
    wrapper.unmount()
    const unregistered = remove.mock.calls.some(([evt]) => evt === 'keydown')
    expect(unregistered).toBe(true)

    add.mockRestore()
    remove.mockRestore()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
bun run test -- useUniversalBootstrap
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement the composable**

Write `frontend/composables/useUniversalBootstrap.ts`:

```ts
import { onMounted, onUnmounted } from 'vue'
import { useTheme } from '@construct-space/ui'
import { isTauriEnv } from '@/utils/tauri'

export interface UniversalBootstrapOptions {
  /** Initialize theme (CSS vars + dark/light class). Default: true. */
  initTheme?: boolean
  /** Register Cmd+Alt+I / Ctrl+Alt+I devtools shortcut (Tauri only). Default: true. */
  enableDevtoolsShortcut?: boolean
  /** Suppress the browser's default right-click menu in production builds (Tauri only). Default: true. */
  suppressContextMenuInProd?: boolean
}

export function useUniversalBootstrap(options: UniversalBootstrapOptions = {}): void {
  const {
    initTheme = true,
    enableDevtoolsShortcut = true,
    suppressContextMenuInProd = true,
  } = options

  const theme = useTheme()

  function allowNativeContextMenu(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    return !!target.closest('[data-allow-native-context-menu]')
  }

  function handleContextMenu(event: MouseEvent) {
    if (allowNativeContextMenu(event.target)) return
    event.preventDefault()
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!(e.metaKey || e.ctrlKey) || !e.altKey || e.code !== 'KeyI') return
    e.preventDefault()
    ;(async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow')
        const label = getCurrentWebviewWindow().label
        await invoke('open_devtools', { label })
      } catch (err) {
        console.error('[useUniversalBootstrap] devtools invoke failed:', err)
      }
    })()
  }

  onMounted(() => {
    if (initTheme) theme.init()
    if (!isTauriEnv()) return
    if (enableDevtoolsShortcut) {
      window.addEventListener('keydown', handleKeydown)
    }
    if (suppressContextMenuInProd && import.meta.env.PROD) {
      document.addEventListener('contextmenu', handleContextMenu, true)
    }
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeydown)
    document.removeEventListener('contextmenu', handleContextMenu, true)
  })
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
bun run test -- useUniversalBootstrap
```

Expected: 4 assertions pass.

If `@vue/test-utils` is not listed in `package.json`, check whether any existing `*.test.ts` imports it (e.g., a grep of `frontend/` for `@vue/test-utils`). If absent, install with `bun add -d @vue/test-utils@latest` before re-running tests, then include the lockfile in the commit.

- [ ] **Step 5: Typecheck**

```bash
bun run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd construct-app
git add frontend/composables/useUniversalBootstrap.ts frontend/composables/useUniversalBootstrap.test.ts
# If @vue/test-utils was installed, also:
#   git add package.json bun.lock
git commit -m "feat(composables): add useUniversalBootstrap for per-shell boilerplate"
```

---

## Phase 1 Wrap-Up

- [ ] **Full suite verification**

From `construct-app/`:

```bash
bun run test
bun run typecheck
bun run lint
```

Expected: all green. The new modules should add five test files, each passing.

- [ ] **Verify nothing was accidentally wired up**

```bash
git log --oneline -5
```

Expected: five commits, one per task. No modifications to `App.vue`, `main.ts`, `router/`, `stores/`, or any existing composable — Phase 1 is strictly additive.

Spot-check by grepping for imports of the new modules from existing code (should return no matches):

```bash
# From construct-app/:
grep -rEn "from '@/lib/window/(openWindow|windowType)'" frontend --exclude-dir=node_modules || echo "no callers — correct for Phase 1"
grep -rEn "from '@/lib/crossWindow/(sync|handoffRegistry)'" frontend --exclude-dir=node_modules || echo "no callers — correct for Phase 1"
grep -rEn "from '@/composables/useUniversalBootstrap'" frontend --exclude-dir=node_modules || echo "no callers — correct for Phase 1"
```

- [ ] **Push the branch / open PR (per user's commit-and-push workflow)**

```bash
cd construct-app
git push origin HEAD
```

Open a PR into `dev` titled "feat: ConstructWindow Phase 1 — infrastructure (no behavior change)". Body: link to the design spec, note that this is strictly additive, list the five modules.

---

## Next Phases (separate plans to be written)

Each subsequent phase gets its own plan file:

- `2026-04-xx-construct-window-phase-2-main-shell.md` — extract `MainShell` from `App.vue`; add the App.vue dispatcher; no behavior change for non-main windows (they still fall through to MainShell).
- `2026-04-xx-construct-window-phase-3-bootstrap-extraction.md` — move profile/auth/bridge/telemetry init from `main.ts`/`App.vue` into `bootstrapMain.ts`; delete `lib/windowBootstrap.ts`.
- `2026-04-xx-construct-window-phase-4-space-preview-shell.md` — convert `SpacePreviewPage.vue` → `SpacePreviewShell.vue`; migrate callers; delete `useSpacePreview.ts`.
- `2026-04-xx-construct-window-phase-5-detach-shell.md` — `DetachShell.vue`, `sessionHandoff.ts`, assistant handoff contract, migrate popout path; replace `standalone-assistant` static window.
- `2026-04-xx-construct-window-phase-5b-coder-handoff.md` — expose `resolve`/`hydrate`/`stop` primitives on `useCoder`; add `spaces/coder/handoff.ts`.
- `2026-04-xx-construct-window-phase-6-generic-browser-and-sync.md` — `GenericBrowserShell.vue`, `browser_create_content_webview` Tauri command, activate cross-window sync, delete legacy pages and composables.
