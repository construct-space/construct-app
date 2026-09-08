# Spaces Architecture

## What is a Space?

A Space is a self-contained module that adds functionality to Construct. Each space has its own UI pages, widgets, AI agent config, and theme. Spaces teleport their content into the shell: sidebar icon, toolbar actions, and page content.

## Space Kinds

Spaces come in two kinds, distinguished by their loading mechanism:

### Host-Native Spaces

Ship with the app binary. Their page components are compiled into the frontend bundle, and they have explicit routes in `router/routes.ts`. No IIFE eval, no checksum verification, no disk I/O at runtime.

| Space | ID | Description | Scope |
|-------|----|-------------|-------|
| Projects | `project` | Project management and navigation | app |
| Coder | `coder` | Autonomous coding agent | project |
| Chat | `brainstorm` | Explore ideas and refine your vision | app |
| Architect | `architect` | Plans project structure and specs | project |
| Editor | `editor` | Code editor | project |

Key files:
- `frontend/spaces/{id}/` — source code and manifest
- `frontend/space_loader/coreSpaces.ts` — component registry
- `frontend/types/space.ts` — canonical ID list (`HOST_NATIVE_SPACE_IDS`)
- `frontend/space_loader/builtin.ts` — re-export for sidebar filtering

### Dynamic Spaces

Installed from the marketplace or linked via `construct dev`. A dynamic space is a macOS-app-style `<id>.space/` directory in the user's app data directory. Loaded at runtime by `SpaceLoader`, verified via SHA-256 checksum, and rendered through `DynamicSpacePage.vue`.

Key files:
- `frontend/space_loader/SpaceLoader.ts` — runtime loader
- `frontend/space_loader/DynamicSpacePage.vue` — catch-all renderer with parameterized route matching
- `frontend/composables/useSpaceMarketplace.ts` — install/update/remove

## Space File Structure

```
frontend/spaces/{id}/          (host-native)
  manifest.json                identity, pages, widgets, navigation, scope
  pages/                       Vue page components
  widgets/                     dashboard widget components
  components/                  space-specific UI
  composables/                 shared logic
  agent/                       AI configuration
    config.md                  YAML frontmatter + system prompt
    tools/                     custom tools (*.md)
    hooks/safety.json          pre/post tool hooks
```

Dynamic spaces are installed as a single `.space` bundle:

```
<profile>/spaces/{id}.space/
  manifest.json                identity, pages, widgets, navigation, build metadata
  app.iife.js                  canonical runtime JS
  style.css                    canonical runtime CSS, including space Tailwind utilities
  checksums.json               bundle integrity map
  SKILL.md                     agentskills.io root skill
  scripts/                     optional skill scripts
  references/                  optional skill docs
  assets/                      optional templates/resources
  agent/config.md              Construct agent prompt and tool whitelist
  widgets/                     dashboard widget Vue files
  tools/{platform}/{id}-tools  optional first-party space CLI
  lib/{platform}/...           optional third-party helpers, e.g. ffmpeg
```

Plain `<profile>/spaces/{id}/`, flat `dist/space-*.iife.js`, and `config.agent`
are not supported dynamic-space install formats.

When Construct runs a space tool it sets `SPACE_DIR`, `SPACE_TOOLS`,
`SPACE_LIB`, `SPACE_LIB_ROOT`, `CONSTRUCT_SPACE_ID`, `CONSTRUCT_PLATFORM`, and
prepends `SPACE_LIB` plus `SPACE_TOOLS` to `PATH`. A tool can call
`exec.Command("ffmpeg", ...)` and resolve the copy bundled under
`lib/{platform}/`.

## Manifest Contract

Every host-native space manifest MUST include:

```json
{
  "id": "string (matches HOST_NATIVE_SPACE_IDS)",
  "name": "string (display name)",
  "description": "string",
  "icon": "string (Iconify ID, e.g. lucide:terminal)",
  "version": "string (semver)",
  "scope": "app | project | org | any",
  "navigation": {
    "label": "string",
    "icon": "string",
    "to": "string (route segment)",
    "order": "number"
  },
  "pages": [
    {
      "path": "string",
      "label": "string",
      "default": "boolean (at least one must be true)"
    }
  ]
}
```

Dynamic space manifests extend this with optional fields: `build` (checksum, size, builtAt), `recommended`, `assistant`, `contextMenus`, `theme`, etc. See `SpaceManifest` in `SpaceLoader.ts` for the full schema.

## Routing

Host-native spaces have explicit routes in `router/routes.ts`:
- `/app/brainstorm` — standalone brainstorm page
- `/app/architect` — standalone architect page
- `/app/coder` — standalone coder page
- `/app/projects` — project list
- `/app/projects/:id` — project detail
- `/app/projects/:id/architect` — architect within project
- `/app/projects/:id/coder` — coder within project

Dynamic spaces use the catch-all route with parameterized path support:
- `/app/:spaceName` — space index page
- `/app/:spaceName/:subPage(.*)` — space sub-pages, supports nested params (e.g. `members/123`)
- `/app/projects/:id/:spaceName` — dynamic space within project
- `/app/projects/:id/:spaceName/:subPage(.*)` — nested sub-pages within project

### File-Based Page Routing

Space pages use Nuxt-style filesystem conventions. The CLI (`@construct-space/cli`) scans `src/pages/` and auto-generates `entry.ts`:

```
src/pages/
  index.vue              → path: ""
  members.vue            → path: "members"
  members/[id].vue       → path: "members/:id"
  departments/[id].vue   → path: "departments/:id"
  settings.vue           → path: "settings"
```

Rules:
- `[param]` in filenames or directories → `:param` in route path
- `index.vue` → empty segment (parent path)
- Manifest `pages` array still required for metadata (label, icon, hidden, toolbar)
- Manifest `component` field is an optional override — if absent, CLI resolves from filesystem
- The host's `DynamicSpacePage.vue` matches URL paths against `:param` patterns and passes extracted params as props to space components

## Scope

Scopes determine where a space appears and how its data is partitioned:

| Scope | Shows in | Data keyed by | Requires |
|-------|----------|---------------|----------|
| `app` | App sidebar | `user_id` | Nothing |
| `project` | Project detail | `project_id` | Active project |
| `org` | App sidebar | `org_id` | Org space enabled |
| `any` | Both locations | Adapts to context | Nothing |

- `app` spaces are always visible in the sidebar (brainstorm, project)
- `project` spaces only appear inside a project (coder, architect, editor)
- `org` spaces appear in the sidebar only when the org space is enabled — they share data across all org members
- `any` spaces adapt to context — work standalone or inside a project

## SDK

External spaces import shared UI from `@construct-space/ui` and host APIs from `@construct-space/sdk`. Runtime implementations are injected by the host via `window.__CONSTRUCT__`.
