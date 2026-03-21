# Construct Agent Guide

## Overview

- Construct is a desktop app built with Vue 3, Vite, Pinia, and Tauri 2.
- The frontend lives in `src/`; the Rust/Tauri shell lives in `src-tauri/`.
- This repo also hosts the built-in "spaces" system under `src/spaces/` and the operator client integration under `src/operator/`.

## Workspace Dependencies

- `../construct-sdk` is required by the app via `"@construct-space/sdk": "file:../construct-sdk"`.
- `../construct-operator` is required for `scripts/build-operator.sh` and all Tauri flows that bundle the sidecar.
- Releases are handled from `../construct-releases`, not from this repo.

## Working Rules

- Use Bun for JS package management and script execution.
- If you create commits, use author `flakerimi` and do not add Codex co-authors.
- Do not manually bump versions in `package.json` or `src-tauri/tauri.conf.json`; the release workflow handles versioning.

## Common Commands

- `bun run dev` starts the frontend only.
- `bun run tauri:dev` builds the operator sidecar, then launches the desktop app.
- `bun run tauri:devmode` launches the isolated dev instance (`construct-dev://`, separate app data dir).
- `bun run build` runs `vue-tsc --noEmit` and the Vite production build.
- `bun run typecheck` runs `vue-tsc --noEmit`.
- `bun run lint` checks `src/` with ESLint.
- `bun run test` runs Vitest unit tests.
- `bun run operator:build` rebuilds the sidecar binary into `src-tauri/bin/`.

## Architecture Map

- `src/main.ts` boots the Vue app, initializes the space host early, then initializes auth before mount.
- `src/router/` uses hash history and applies auth + telemetry hooks.
- `src/stores/` contains Pinia stores for auth, settings, projects, panels, preferences, and related app state.
- `src/composables/` holds most shared frontend logic.
- `src/spaces/` contains built-in spaces such as `vibe`, `architect`, and `project`.
- `src/operator/` is the frontend integration layer for the external operator backend. Keep prompt/tool-loop logic in operator land rather than rebuilding it in the frontend.
- `src-tauri/src/lib.rs` manages desktop runtime concerns including operator startup, bridge plumbing, app data paths, and dev/prod instance behavior.

## Repo-Specific Conventions

- Vite aliases `@` and `~` both resolve to `src/`.
- Host Vue components are auto-imported from `src/components/**` via `unplugin-vue-components`.
- Space bundles are different: do not rely on global component registration inside space IIFE code. Use `@construct/sdk` exports there.
- `src/lib/appPaths.ts`, `src-tauri/src/lib.rs`, and `src-tauri/tauri.devmode.conf.json` must stay aligned when changing app-path or dev-mode behavior.
- The main window alone should own desktop bridge startup. Do not make secondary windows compete for bridge listeners.
- Vitest is configured for `node` environment and picks up `src/**/*.test.ts`, `src/**/*.spec.ts`, and `__tests__` files.

## Spaces Notes

- Dynamic space loading is implemented in `src/space_loader/` and built-in space definitions live in `src/config/spaces.ts`, `src/space_loader/coreSpaces.ts`, and `src/spaces/**/manifest.json`.
- Agent-facing prompts, tools, hooks, and skills for built-in spaces live alongside the spaces under paths like `src/spaces/*/agent/`.
- When editing space UI, preserve the host SDK component patterns instead of introducing duplicate local primitives.

## Release Notes

- Release automation runs from `../construct-releases`:

```bash
cd ../construct-releases
./release.sh <version> [branch]
```

- That workflow builds signed desktop binaries and publishes updater artifacts. Do not hand-roll local release version changes here.

## Useful Entry Points

- `src/main.ts`
- `src/router/index.ts`
- `src/lib/appPaths.ts`
- `src/operator/`
- `src/spaces/`
- `src-tauri/src/lib.rs`
