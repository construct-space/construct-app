# Construct

AI-powered desktop development environment. Vue 3 + Tauri 2 + Go operator.

## Structure

```
operator/    ← Go — AI engine (agents, tools, providers, sessions)
frontend/    ← Vue 3 — UI (components, composables, stores, spaces)
desktop/     ← Rust/Tauri 2 — native bridge (window, IPC, sidecar)
scripts/     ← build + release scripts
docs/        ← architecture, guides, plans
```

## Commands

```bash
bun run dev              # Full app (builds operator + launches Tauri)
bun run dev:frontend     # Frontend only (Vite on :60200)
bun run build            # Production build
bun run test             # Frontend tests (Vitest)
bun run lint             # ESLint
bun run typecheck        # vue-tsc
bun run operator:build   # Build Go operator
bun run operator:test    # Go tests
bun run release          # Local dev release (signed app)
```

## Conventions

- **Imports**: use `@/` alias (resolves to `frontend/`), never raw `frontend/` paths
- **Components**: auto-imported from `frontend/components/`. Spaces use `@construct/sdk` instead
- **Stores**: Pinia in `frontend/stores/`, auto-imported
- **Composables**: `use` prefix, in `frontend/composables/`, auto-imported
- **Operator logic**: keep AI/agent/tool logic in `operator/` (Go), not frontend
- **Spaces**: built-in in `frontend/spaces/`, marketplace spaces in app data dir
- **Agent configs**: `frontend/spaces/*/agent/` (config.md, tools/*.md, hooks/safety.json)
- **Tests**: Vitest, `*.test.ts` or `*.spec.ts`, node environment

## Key Files

- `frontend/main.ts` — app entry, space host init, auth, mount
- `frontend/router/` — hash-based routing with auth guards
- `frontend/operator/` — operator client, useAgentSession, stream events
- `frontend/lib/appPaths.ts` — data directory paths
- `desktop/src/lib.rs` — Tauri runtime, operator spawn, bridge
- `desktop/tauri.conf.json` — window config, permissions
- `operator/main.go` — operator entry point

## Versioning

- Git tags on `construct-space/releases` are the source of truth
- `bun run release` builds locally for current platform
- CI release: `../releases/release.sh` bumps version + triggers GitHub Actions
- Operator version = Construct version, always

## Ports

| Port | Service |
|------|---------|
| 60100 | Operator (TCP) |
| 60101 | Bridge listener |
| 60200 | Vite dev server |

## Working Rules

- Never manually edit version numbers — use release scripts
- Do not add Co-Authored-By to commits
- SDK comes from npm (`@construct-space/sdk`), not file: paths
- `desktop/src/lib.rs` and `frontend/lib/appPaths.ts` must stay aligned for data dir paths
