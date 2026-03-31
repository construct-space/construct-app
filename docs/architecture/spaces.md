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
| Architect | `architect` | Plans project structure and specs | both |

Key files:
- `frontend/spaces/{id}/` — source code and manifest
- `frontend/space_loader/coreSpaces.ts` — component registry
- `frontend/types/space.ts` — canonical ID list (`HOST_NATIVE_SPACE_IDS`)
- `frontend/space_loader/builtin.ts` — re-export for sidebar filtering

### Dynamic Spaces

Installed from the marketplace or linked via `construct dev`. Their IIFE bundles live in the user's app data directory. Loaded at runtime by `SpaceLoader`, verified via SHA-256 checksum, and rendered through `DynamicSpacePage.vue`.

Key files:
- `frontend/space_loader/SpaceLoader.ts` — runtime loader
- `frontend/space_loader/DynamicSpacePage.vue` — catch-all renderer
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

## Manifest Contract

Every host-native space manifest MUST include:

```json
{
  "id": "string (matches HOST_NATIVE_SPACE_IDS)",
  "name": "string (display name)",
  "description": "string",
  "icon": "string (Iconify ID, e.g. lucide:terminal)",
  "version": "string (semver)",
  "scope": "app | project | both",
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

Dynamic spaces use the catch-all route:
- `/app/:spaceName` — any non-native space
- `/app/projects/:id/:spaceName` — dynamic space within project

## Scope

- `app` — global, not tied to a project (e.g. brainstorm, project)
- `project` — only visible within a project context (e.g. coder)
- `both` — works in either context (e.g. architect)

## SDK

External spaces import shared UI from `@construct-space/ui` and host APIs from `@construct-space/sdk`. Runtime implementations are injected by the host via `window.__CONSTRUCT__`.
