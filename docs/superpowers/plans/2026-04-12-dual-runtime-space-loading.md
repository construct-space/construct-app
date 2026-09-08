# Dual Runtime Space Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow Construct to load dynamic spaces from either the current IIFE bundle format or a new raw WASM runtime, while keeping existing IIFE spaces working unchanged.

**Architecture:** Add an explicit `runtime` contract to space manifests, then refactor `SpaceLoader` into a dispatcher with two adapters: the existing IIFE path and a new WASM path. WASM spaces render through a generic Vue host page plus a small Construct WASM ABI; v1 is intentionally narrower than IIFE and only guarantees page rendering plus recursive asset installation, while widgets, assistant types, and space actions stay IIFE-only until the ABI is proven.

**Tech Stack:** TypeScript, Vue 3, Tauri plugin-fs, WebAssembly Web API, Bun CLI, Go operator tools, Vitest, Bun test, Go test

---

## Guardrails

- Legacy installed spaces with only `manifest.json` + `space-{id}.iife.js` must continue to load with zero manifest changes.
- "Raw WASM" means "a `.wasm` binary that implements the Construct WASM ABI." It does not mean arbitrary Emscripten, wasm-bindgen, or framework-generated bundles with hidden JS glue.
- v1 should reject unsupported WASM features early in validation: `widgets`, `assistant`, and runtime space `actions`.
- Runtime selection order should be deterministic:
  1. `manifest.runtime.kind`
  2. `manifest.runtime.entry` file extension
  3. file presence in the space directory (`space-{id}.wasm` before legacy IIFE only when runtime explicitly opts in during rollout)
  4. legacy default: IIFE

## File Structure

### Frontend (`/Users/flakerim/Construct/construct-app/frontend/`)

| File | Action | Purpose |
|------|--------|---------|
| `space_loader/SpaceLoader.ts` | **Modify** | Convert from hard-coded IIFE loader into runtime dispatcher |
| `space_loader/validation.ts` | **Modify** | Validate `runtime` config and enforce WASM v1 restrictions |
| `space_loader/errorActions.ts` | **Modify** | Add WASM-specific error phases and recovery copy |
| `space_loader/DynamicSpacePage.vue` | **Modify** | Surface WASM loader errors cleanly and keep page rendering path generic |
| `space_loader/runtime/loadIifeSpace.ts` | **Create** | Hold the current IIFE load path with minimal logic changes |
| `space_loader/runtime/loadWasmSpace.ts` | **Create** | Read `.wasm`, instantiate it, and return generic page components |
| `space_loader/runtime/runtimeTypes.ts` | **Create** | Shared `LoadedSpace`, `RuntimeKind`, and runtime handle interfaces |
| `space_loader/components/WasmSpacePage.vue` | **Create** | Generic Vue page host that mounts a WASM page into a DOM root |
| `space_loader/__tests__/validation.test.ts` | **Modify** | Add runtime contract tests |
| `space_loader/__tests__/spaceStability.test.ts` | **Modify** | Add runtime dispatch and unload coverage |
| `space_loader/__tests__/wasmLoader.test.ts` | **Create** | Cover WASM instantiate/mount/unmount behavior |
| `lib/spaceHost.ts` | **Modify** | Expose a small WASM host surface alongside existing JS host globals |
| `docs/architecture/host-contract.md` | **Modify** | Document dual runtime loading and the WASM host ABI |
| `docs/guides/building-spaces.md` | **Modify** | Add author guidance for `runtime.kind = "wasm"` |

### CLI (`/Users/flakerim/Construct/packages/construct-cli/`)

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/manifest.ts` | **Modify** | Add manifest types for `runtime.kind`, `runtime.entry`, `runtime.abiVersion` |
| `src/lib/artifacts.ts` | **Create** | Centralize runtime artifact discovery for build/dev/install |
| `src/commands/build.ts` | **Modify** | Hash the selected artifact and write runtime metadata into `dist/manifest.json` |
| `src/commands/dev.ts` | **Modify** | Watch the selected runtime artifact instead of hard-coded IIFE output |
| `src/commands/run.ts` | **Modify** | Validate selected runtime artifact exists before install |
| `src/lib/manifest.test.ts` | **Create** | Cover runtime manifest defaults and validation helpers |
| `src/commands/dev.test.ts` | **Modify** | Cover artifact watch path selection |
| `src/commands/build.test.ts` | **Create** | Cover runtime artifact detection and build metadata output |
| `src/commands/scaffold.ts` | **Optional follow-up** | Add a `--runtime wasm` template once loader support is merged |
| `src/commands/scaffold.test.ts` | **Optional follow-up** | Cover the WASM scaffold template |

### Operator / installer (`/Users/flakerim/Construct/construct-app/operator/`)

| File | Action | Purpose |
|------|--------|---------|
| `internal/tool/space_cli.go` | **Modify** | Make dev installs copy `dist/` recursively so WASM side assets survive |
| `internal/tool/space_cli_test.go` | **Modify** | Cover recursive dev install behavior |

### External docs

| File | Action | Purpose |
|------|--------|---------|
| `/Users/flakerim/Construct/infra/construct-docs/docs/api/space-manifest.md` | **Modify** | Document `runtime` and v1 WASM restrictions |
| `/Users/flakerim/Construct/infra/construct-docs/docs/api/wasm-space-abi.md` | **Create** | Define the Construct WASM ABI in one place |

## ABI Shape (v1)

Write this down first and implement against it exactly:

```ts
// manifest.json / space.manifest.json
interface RuntimeConfig {
  kind?: 'iife' | 'wasm'
  entry?: string          // e.g. "space-notes.iife.js" or "space-notes.wasm"
  abiVersion?: string     // required for wasm
}
```

WASM v1 is a self-rendered page runtime, not a Vue component runtime. The host is responsible for:

- loading bytes from disk
- instantiating the module
- providing a mount root
- forwarding lifecycle (`mount`, `unmount`, `resize`)
- exposing minimal host imports (logging, storage, operator bridge, current project/space ids)

Keep the ABI small in v1:

- required export: `memory`
- required export: `construct_mount`
- optional exports: `construct_init`, `construct_unmount`, `construct_resize`, `construct_dispose`

Do not attempt widget/action/assistant parity in the same slice. Reject those combinations in validation and document them as unsupported.

## Task 1: Lock the Dual-Runtime Manifest Contract

**Files:**
- Create: `/Users/flakerim/Construct/packages/construct-cli/src/lib/manifest.test.ts`
- Modify: `/Users/flakerim/Construct/packages/construct-cli/src/lib/manifest.ts`
- Modify: `/Users/flakerim/Construct/construct-app/frontend/space_loader/validation.ts`
- Modify: `/Users/flakerim/Construct/construct-app/frontend/space_loader/__tests__/validation.test.ts`
- Modify: `/Users/flakerim/Construct/construct-app/docs/architecture/host-contract.md`
- Create: `/Users/flakerim/Construct/infra/construct-docs/docs/api/wasm-space-abi.md`
- Modify: `/Users/flakerim/Construct/infra/construct-docs/docs/api/space-manifest.md`

- [ ] **Step 1: Write the failing manifest tests**

Add cases for:
- missing `runtime` defaults to IIFE
- `runtime.kind = "wasm"` requires `runtime.abiVersion`
- `runtime.entry = "space-demo.wasm"` implies WASM
- WASM manifests that also declare `widgets`, `assistant`, or `actions` fail validation in v1

Run:

```bash
cd /Users/flakerim/Construct/packages/construct-cli
bun test src/lib/manifest.test.ts

cd /Users/flakerim/Construct/construct-app
bun run test -- frontend/space_loader/__tests__/validation.test.ts
```

Expected: FAIL with missing runtime support.

- [ ] **Step 2: Add `runtime` to the source manifest type**

Update `/Users/flakerim/Construct/packages/construct-cli/src/lib/manifest.ts`:

```ts
export interface RuntimeConfig {
  kind?: 'iife' | 'wasm'
  entry?: string
  abiVersion?: string
}
```

Wire it into `SpaceManifest`, and add helper functions:
- `getRuntimeKind(manifest)`
- `getRuntimeEntry(manifest)`

- [ ] **Step 3: Extend frontend validation**

Update `/Users/flakerim/Construct/construct-app/frontend/space_loader/validation.ts` so it:
- accepts legacy manifests with no `runtime`
- validates `runtime.kind`
- infers runtime from `runtime.entry` when `kind` is missing
- requires `abiVersion` for WASM
- rejects WASM + `widgets` / `assistant` / `actions` in v1

- [ ] **Step 4: Document the contract before writing loader code**

Document:
- runtime selection order
- ABI export/import names
- v1 WASM limitations
- backwards compatibility for existing IIFE spaces

- [ ] **Step 5: Re-run the tests**

Run:

```bash
cd /Users/flakerim/Construct/packages/construct-cli
bun test src/lib/manifest.test.ts

cd /Users/flakerim/Construct/construct-app
bun run test -- frontend/space_loader/__tests__/validation.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add /Users/flakerim/Construct/packages/construct-cli/src/lib/manifest.ts \
  /Users/flakerim/Construct/packages/construct-cli/src/lib/manifest.test.ts \
  /Users/flakerim/Construct/construct-app/frontend/space_loader/validation.ts \
  /Users/flakerim/Construct/construct-app/frontend/space_loader/__tests__/validation.test.ts \
  /Users/flakerim/Construct/construct-app/docs/architecture/host-contract.md \
  /Users/flakerim/Construct/infra/construct-docs/docs/api/space-manifest.md \
  /Users/flakerim/Construct/infra/construct-docs/docs/api/wasm-space-abi.md
git commit -m "feat: add dual-runtime space manifest contract"
```

## Task 2: Split SpaceLoader into Runtime Adapters

**Files:**
- Create: `/Users/flakerim/Construct/construct-app/frontend/space_loader/runtime/runtimeTypes.ts`
- Create: `/Users/flakerim/Construct/construct-app/frontend/space_loader/runtime/loadIifeSpace.ts`
- Create: `/Users/flakerim/Construct/construct-app/frontend/space_loader/runtime/loadWasmSpace.ts`
- Modify: `/Users/flakerim/Construct/construct-app/frontend/space_loader/SpaceLoader.ts`
- Modify: `/Users/flakerim/Construct/construct-app/frontend/space_loader/errorActions.ts`
- Modify: `/Users/flakerim/Construct/construct-app/frontend/space_loader/__tests__/spaceStability.test.ts`

- [ ] **Step 1: Write the failing runtime dispatch tests**

Add tests for:
- legacy manifest with only IIFE bundle still dispatches to the IIFE loader
- `runtime.kind = "wasm"` dispatches to the WASM loader
- bad `.wasm` runtime reports `instantiate` / `abi` style errors instead of `eval`
- `unloadSpace()` calls the runtime disposer

Run:

```bash
cd /Users/flakerim/Construct/construct-app
bun run test -- frontend/space_loader/__tests__/spaceStability.test.ts
```

Expected: FAIL because `SpaceLoader.ts` is still hard-coded to IIFE.

- [ ] **Step 2: Extract the current IIFE path unchanged**

Move the existing checksum/eval/export logic into `/Users/flakerim/Construct/construct-app/frontend/space_loader/runtime/loadIifeSpace.ts`. Do not change behavior beyond moving code.

- [ ] **Step 3: Add runtime dispatch to `SpaceLoader.ts`**

Introduce a shared runtime contract:

```ts
export type RuntimeKind = 'iife' | 'wasm'

export interface RuntimeHandle {
  mountPage?(pagePath: string, el: HTMLElement, routeParams: Record<string, string>): Promise<void>
  unmountPage?(pagePath: string): Promise<void>
  resize?(width: number, height: number): void
  dispose?(): Promise<void> | void
}
```

`SpaceLoader.ts` should:
- read `manifest.runtime`
- resolve runtime kind using the guardrail order above
- dispatch to `loadIifeSpace(...)` or `loadWasmSpace(...)`
- stash `runtimeKind` and `runtimeHandle` on the loaded space

- [ ] **Step 4: Update error taxonomy**

Add WASM-specific phases to loader errors and UI messaging:
- `instantiate`
- `abi`

Update `/Users/flakerim/Construct/construct-app/frontend/space_loader/errorActions.ts` and `DynamicSpacePage.vue` labels so the failure mode is obvious to users.

- [ ] **Step 5: Keep space actions IIFE-only in v1**

Update `preloadSpaceActions()` so it:
- registers manifest actions for IIFE spaces as today
- skips WASM spaces with a debug log
- never tries to lazily run WASM actions in this slice

- [ ] **Step 6: Re-run the loader tests**

Run:

```bash
cd /Users/flakerim/Construct/construct-app
bun run test -- frontend/space_loader/__tests__/spaceStability.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add /Users/flakerim/Construct/construct-app/frontend/space_loader/SpaceLoader.ts \
  /Users/flakerim/Construct/construct-app/frontend/space_loader/errorActions.ts \
  /Users/flakerim/Construct/construct-app/frontend/space_loader/runtime/runtimeTypes.ts \
  /Users/flakerim/Construct/construct-app/frontend/space_loader/runtime/loadIifeSpace.ts \
  /Users/flakerim/Construct/construct-app/frontend/space_loader/runtime/loadWasmSpace.ts \
  /Users/flakerim/Construct/construct-app/frontend/space_loader/__tests__/spaceStability.test.ts
git commit -m "refactor: dispatch spaces by runtime kind"
```

## Task 3: Add the WASM Page Host

**Files:**
- Create: `/Users/flakerim/Construct/construct-app/frontend/space_loader/components/WasmSpacePage.vue`
- Create: `/Users/flakerim/Construct/construct-app/frontend/space_loader/__tests__/wasmLoader.test.ts`
- Modify: `/Users/flakerim/Construct/construct-app/frontend/space_loader/runtime/loadWasmSpace.ts`
- Modify: `/Users/flakerim/Construct/construct-app/frontend/space_loader/DynamicSpacePage.vue`
- Modify: `/Users/flakerim/Construct/construct-app/frontend/lib/spaceHost.ts`

- [ ] **Step 1: Write the failing WASM lifecycle tests**

Cover:
- binary bytes are read from disk and instantiated
- `construct_mount` is called when the page component mounts
- `construct_unmount` / `construct_dispose` are called on page unmount and space unload
- resize events are forwarded
- loader surfaces a clear ABI error when `construct_mount` is missing

Run:

```bash
cd /Users/flakerim/Construct/construct-app
bun run test -- frontend/space_loader/__tests__/wasmLoader.test.ts
```

Expected: FAIL because there is no WASM runtime host yet.

- [ ] **Step 2: Implement the WASM runtime adapter**

In `/Users/flakerim/Construct/construct-app/frontend/space_loader/runtime/loadWasmSpace.ts`:
- read the `.wasm` file bytes from disk
- instantiate with a minimal `construct_host` import object
- validate required exports
- return a `RuntimeHandle`
- return one generated page component per manifest page, all backed by `WasmSpacePage.vue`

- [ ] **Step 3: Keep the host surface deliberately small**

Expose only what the first slice needs in `/Users/flakerim/Construct/construct-app/frontend/lib/spaceHost.ts`:
- logging
- current `space.id`
- current `project.id`
- storage get/set/remove
- operator send bridge

Do not try to mirror the entire JS host API into WASM imports.

- [ ] **Step 4: Implement `WasmSpacePage.vue`**

The component should:
- render a single stable mount root
- call `runtimeHandle.mountPage(...)` on mount
- install a `ResizeObserver`
- call `runtimeHandle.resize(...)`
- call `runtimeHandle.unmountPage(...)` on unmount

- [ ] **Step 5: Keep `DynamicSpacePage.vue` generic**

Make only the minimum changes needed so:
- IIFE pages still render with `<component :is>`
- WASM generated page components render through the same path
- route params still flow through unchanged

- [ ] **Step 6: Re-run the WASM loader tests**

Run:

```bash
cd /Users/flakerim/Construct/construct-app
bun run test -- frontend/space_loader/__tests__/wasmLoader.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add /Users/flakerim/Construct/construct-app/frontend/lib/spaceHost.ts \
  /Users/flakerim/Construct/construct-app/frontend/space_loader/DynamicSpacePage.vue \
  /Users/flakerim/Construct/construct-app/frontend/space_loader/components/WasmSpacePage.vue \
  /Users/flakerim/Construct/construct-app/frontend/space_loader/runtime/loadWasmSpace.ts \
  /Users/flakerim/Construct/construct-app/frontend/space_loader/__tests__/wasmLoader.test.ts
git commit -m "feat: add wasm runtime host for dynamic spaces"
```

## Task 4: Make CLI Build, Dev, and Install Runtime-Aware

**Files:**
- Create: `/Users/flakerim/Construct/packages/construct-cli/src/lib/artifacts.ts`
- Create: `/Users/flakerim/Construct/packages/construct-cli/src/commands/build.test.ts`
- Modify: `/Users/flakerim/Construct/packages/construct-cli/src/commands/build.ts`
- Modify: `/Users/flakerim/Construct/packages/construct-cli/src/commands/dev.ts`
- Modify: `/Users/flakerim/Construct/packages/construct-cli/src/commands/dev.test.ts`
- Modify: `/Users/flakerim/Construct/packages/construct-cli/src/commands/run.ts`
- Modify: `/Users/flakerim/Construct/construct-app/operator/internal/tool/space_cli.go`
- Modify: `/Users/flakerim/Construct/construct-app/operator/internal/tool/space_cli_test.go`

- [ ] **Step 1: Write the failing artifact tests**

Add test cases for:
- default runtime artifact is `dist/space-{id}.iife.js`
- `runtime.kind = "wasm"` selects `dist/space-{id}.wasm`
- build metadata writes `runtime.entry`
- dev watch selects the runtime artifact instead of hard-coded `.iife.js`

Run:

```bash
cd /Users/flakerim/Construct/packages/construct-cli
bun test src/commands/build.test.ts src/commands/dev.test.ts
```

Expected: FAIL with hard-coded IIFE assumptions.

- [ ] **Step 2: Centralize artifact discovery**

Create `/Users/flakerim/Construct/packages/construct-cli/src/lib/artifacts.ts` with helpers:
- `resolveRuntimeArtifact(root, manifest)`
- `getRuntimeEntryName(manifest)`
- `getOptionalCssArtifact(manifest)`

Use those helpers from `build.ts`, `dev.ts`, and `run.ts`.

- [ ] **Step 3: Update build output**

`/Users/flakerim/Construct/packages/construct-cli/src/commands/build.ts` should:
- hash the selected runtime artifact
- preserve `runtime` into `dist/manifest.json`
- set `runtime.entry` if the source manifest omitted it
- keep existing IIFE rename behavior only for IIFE builds

- [ ] **Step 4: Update dev watch**

`/Users/flakerim/Construct/packages/construct-cli/src/commands/dev.ts` should watch the resolved runtime artifact so that:
- IIFE spaces still rebuild on `space-{id}.iife.js`
- WASM spaces rebuild on `space-{id}.wasm`

- [ ] **Step 5: Fix dev install recursion**

`/Users/flakerim/Construct/construct-app/operator/internal/tool/space_cli.go` currently copies only top-level files from `dist/`. Replace that with recursive copy so nested asset directories survive for WASM spaces.

- [ ] **Step 6: Re-run CLI and Go tests**

Run:

```bash
cd /Users/flakerim/Construct/packages/construct-cli
bun test src/commands/build.test.ts src/commands/dev.test.ts src/lib/manifest.test.ts

cd /Users/flakerim/Construct/construct-app
go test ./operator/internal/tool -run 'TestSpace'
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add /Users/flakerim/Construct/packages/construct-cli/src/lib/artifacts.ts \
  /Users/flakerim/Construct/packages/construct-cli/src/commands/build.ts \
  /Users/flakerim/Construct/packages/construct-cli/src/commands/build.test.ts \
  /Users/flakerim/Construct/packages/construct-cli/src/commands/dev.ts \
  /Users/flakerim/Construct/packages/construct-cli/src/commands/dev.test.ts \
  /Users/flakerim/Construct/packages/construct-cli/src/commands/run.ts \
  /Users/flakerim/Construct/construct-app/operator/internal/tool/space_cli.go \
  /Users/flakerim/Construct/construct-app/operator/internal/tool/space_cli_test.go
git commit -m "feat: make space build and install runtime-aware"
```

## Task 5: Add Docs, Fixtures, and Rollout Gates

**Files:**
- Modify: `/Users/flakerim/Construct/construct-app/docs/guides/building-spaces.md`
- Modify: `/Users/flakerim/Construct/construct-app/docs/architecture/host-contract.md`
- Create: `/Users/flakerim/Construct/construct-app/frontend/space_loader/__tests__/fixtures/space-wasm-hello/manifest.json`
- Create: `/Users/flakerim/Construct/construct-app/frontend/space_loader/__tests__/fixtures/space-wasm-hello/space-space-wasm-hello.wasm`
- Optional follow-up: `/Users/flakerim/Construct/packages/construct-cli/src/commands/scaffold.ts`

- [ ] **Step 1: Add a minimal WASM fixture**

Create a tiny test fixture that exercises:
- valid manifest with `runtime.kind = "wasm"`
- valid `abiVersion`
- successful loader mount path

- [ ] **Step 2: Document authoring rules**

Update the docs so they explicitly say:
- when to use IIFE vs WASM
- current WASM limitations
- required ABI exports
- how to debug loader failures

- [ ] **Step 3: Add rollout notes**

Ship the first release with these rules:
- existing spaces default to IIFE
- WASM remains opt-in via `runtime.kind = "wasm"`
- no automatic marketplace promotion for WASM spaces until at least one sample space is stable

- [ ] **Step 4: Verification sweep**

Run:

```bash
cd /Users/flakerim/Construct/packages/construct-cli
bun test

cd /Users/flakerim/Construct/construct-app
bun run test -- frontend/space_loader/__tests__/validation.test.ts frontend/space_loader/__tests__/spaceStability.test.ts frontend/space_loader/__tests__/wasmLoader.test.ts
go test ./operator/internal/tool -run 'TestSpace'
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add /Users/flakerim/Construct/construct-app/docs/guides/building-spaces.md \
  /Users/flakerim/Construct/construct-app/docs/architecture/host-contract.md \
  /Users/flakerim/Construct/construct-app/frontend/space_loader/__tests__/fixtures/space-wasm-hello
git commit -m "docs: add wasm space runtime guidance"
```

## Out of Scope for This Plan

- Arbitrary framework-generated WASM bundles that require opaque JS glue
- WASM widgets
- WASM assistant renderers
- WASM-backed `space.run_action` parity
- WASM marketplace publish validation beyond manifest/runtime checks

Those are follow-on slices after the page loader and install path are stable.
