# Construct

AI-powered development environment. Design, code, and ship in one window.

## Structure

```
operator/    ← Go — AI engine (agents, tools, providers, sessions)
frontend/    ← Vue 3 — UI (components, composables, stores, spaces)
desktop/     ← Rust/Tauri 2 — native bridge (window management, IPC, sidecar)
scripts/     ← build and release scripts
docs/        ← architecture, guides, plans
```

## Quick Start

```bash
# Prerequisites: Node 20+, Bun, Rust, Go 1.23+, Tauri CLI
bun install
bun run dev
```

## Commands

| Command | What |
|---------|------|
| `bun run dev` | Full desktop app (builds operator + launches Tauri) |
| `bun run build` | Production build |
| `bun run release` | Local dev release (signed app, current platform) |
| `bun run test` | Frontend tests |
| `bun run lint` | ESLint |
| `bun run typecheck` | vue-tsc |
| `bun run frontend:dev` | Frontend only (Vite on :60200) |
| `bun run operator:test` | Go tests |

## Architecture

**Operator** — Go sidecar running locally on `:60100`. Powers 10+ AI agents with 22+ tools. Supports Anthropic, OpenAI, DeepSeek, Ollama. Each space can have its own agent defined in markdown (no code needed).

**Frontend** — Vue 3 with modular "Spaces" architecture. Each space is a self-contained module with pages, components, AI agent config, and theme. Host-native: Architect, Brainstorm (Chat), Coder, Project. Additional spaces are installed from the marketplace.

**Desktop** — Tauri 2 native shell. 3D rotating sidebar, toolbar with breadcrumb transitions, operator sidecar management, window state, deep links.

## Spaces

Spaces are the core building block. Each space teleports its icon into the sidebar, toolbar actions into the toolbar, and pages into the main area. Build a space with shared UI plus the host SDK:

```ts
import { Button, Modal, Notification, useNotification } from '@construct-space/ui'
import { useToolbar } from '@construct-space/sdk'
```

See [docs/guides/building-spaces.md](docs/guides/building-spaces.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Proprietary — Construct Team
