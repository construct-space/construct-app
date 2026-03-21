# Construct DevMode

Run a separate "Construct DEV" instance alongside the production app for space development and testing.

## Quick Start

```bash
bun run tauri:devmode
```

## What DevMode Does

- Loads spaces from `~/.construct-dev/spaces/` instead of `~/.construct/spaces/`
- Runs as a separate app (`space.construct.personal.dev`) — no conflict with production
- Shows "Construct DEV" in the title bar and an orange DEV MODE badge
- Deep-link scheme: `construct-dev://` (instead of `construct://`)

## How It Works

| Aspect | Production | DevMode |
|--------|-----------|---------|
| App ID | `space.construct.personal` | `space.construct.personal.dev` |
| Window title | Construct | Construct DEV |
| Spaces dir | `~/.construct/spaces/` | `~/.construct-dev/spaces/` |
| Deep-link | `construct://` | `construct-dev://` |
| Env var | — | `VITE_CONSTRUCT_DEV_MODE=true` |

## Architecture

### Centralized path: `src/lib/appPaths.ts`

Single source of truth for the global app directory. All files import from here instead of hardcoding `~/.construct`.

```ts
import { getSpacesDir, APP_DIR_NAME, IS_DEV_INSTANCE } from '@/lib/appPaths'
```

### Tauri config override: `src-tauri/tauri.devmode.conf.json`

Deep-merged with `tauri.conf.json` via `cargo tauri dev --config`. Only overrides identifier, title, and deep-link scheme.

### Per-project config unchanged

`{project}/.construct/project.json` is project-scoped and shared between both instances.

## Setup (first run)

DevMode auto-creates `~/.construct-dev/spaces/` on first launch. To pre-populate with spaces, copy from production:

```bash
cp -r ~/.construct/spaces ~/.construct-dev/spaces
```

## Phase 2 (planned)

- **Dev Tools Panel** (`Cmd+Shift+D`): space inspector, hot reload console, brain status
- **Brain data isolation**: pass `--data-dir ~/.construct-dev` to brain sidecar
