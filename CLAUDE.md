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

## Spaces

- **Built-in**: `frontend/spaces/` (architect, brainstorm, coder, editor, project) — host-native, explicit routes
- **Dynamic**: installed from marketplace or linked via `construct dev` — loaded at runtime via SpaceLoader
- **Routing**: filesystem-based — `pages/members/[id].vue` → `members/:id` route (Nuxt convention)
- **Manifest**: `space.manifest.json` declares pages, toolbar, agent, skills, scope
- **Scopes**: `app` (sidebar), `project` (inside project), `org` (requires org), `any` (everywhere)
- **CLI**: `@construct-space/cli` — scaffolds, builds, validates spaces. Entry.ts auto-generated from filesystem.

## Operator

- 22 builtin tools: read/write/edit/bash/glob/grep/git/lsp/task/memory/web_fetch/web_search/ask_user/coordinate
- Coder prompt: `operator/internal/coreagents/configs/coder.md` (source of truth, overrides Go fallback)
- System prompt assembled at runtime: base prompt + project context + CLAUDE.md + memory + skills
- Prompt cache: static prefix (cacheable) + dynamic suffix (per-turn), split at boundary marker

## Key Files

- `frontend/main.ts` — app entry, space host init, auth, mount
- `frontend/router/routes.ts` — hash-based routing, `:subPage(.*)` catch-all for space params
- `frontend/space_loader/DynamicSpacePage.vue` — renders dynamic spaces, matches parameterized routes
- `frontend/space_loader/SpaceLoader.ts` — loads IIFE bundles from disk
- `frontend/operator/` — operator client, useAgentSession, stream events
- `frontend/lib/appPaths.ts` — data directory paths
- `desktop/src/lib.rs` — Tauri runtime, operator spawn, bridge
- `desktop/tauri.conf.json` — window config, permissions
- `operator/main.go` — operator entry point
- `operator/internal/coreagents/configs/` — agent system prompts (coder.md, architect.md, etc.)

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

## Vapor Mode rollout (deferred — Vue 3.6 is currently beta)

Pilots already shipped (4 leaves with `<script setup vapor>`):
- `frontend/components/common/OrgManagedBadge.vue`
- `frontend/components/agent/ProgressCard.vue`
- `frontend/components/agent/PlanBlock.vue`
- `frontend/components/agent/TableBlock.vue`

Do NOT mass-convert until Vue 3.6 ships GA. Reasons: spaces are
non-Vapor IIFE bundles built against vue ^3.5; `@construct-space/ui`,
lucide, vue-router primitives are non-Vapor; `<Transition>`/`<Suspense>`/
`<KeepAlive>` have rough beta support that breaks animated panels.

When 3.6 GAs, convert in this order — one cluster per PR, with a
flamegraph delta to justify each:

1. Agent stream blocks (TaskListBlock, ToolCard, ActionButtons, RequestBubble)
2. Marketplace grid card — extract from `pages/MarketplacePage.vue` first,
   then convert
3. Sidebar3D / Toolbar3D leaf rows — host-only, frequent re-render
4. Common badges/avatars/tooltips — high reuse, compounding wins

Skip: settings forms, modals, bootstrap UI (cold paths, no measurable win).
Skip: anything used by space bundles via `@construct/sdk` (mixed-mode risk).

Verification per cluster: typecheck, full vite build, runtime smoke
in dev, then ship. If profiling shows no delta on the target hot path,
stop — remaining wins are speculative.
