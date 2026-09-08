# Space File-Based Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make space page routing filesystem-driven — `pages/members/[id].vue` just works, no manual `component` fields in manifests.

**Architecture:** Three changes: (1) CLI scans `src/pages/` to auto-discover pages and map `[param]` dirs/files to `:param` routes, (2) Host router adds a `/:subPage(.*)` catch-all so multi-segment paths like `members/123` reach `DynamicSpacePage`, (3) `DynamicSpacePage` matches nested paths and passes extracted params as props.

**Tech Stack:** TypeScript (CLI + Construct frontend), Vue Router 4, Vite

---

## File Structure

### CLI (`/Users/flakerim/Construct/packages/construct-cli/`)

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/entry.ts` | **Rewrite** | Scan filesystem instead of manifest-only; handle `[param]` convention |
| `src/lib/manifest.ts` | **No change** | `component` field stays as manual override |
| `src/commands/build.ts` | **No change** | Already calls `writeEntry()` |

### Host (`/Users/flakerim/Construct/construct-app/frontend/`)

| File | Action | Purpose |
|------|--------|---------|
| `router/routes.ts` | **Modify** | Change `:subPage` to `:subPage(.*)` catch-all for multi-segment paths |
| `space_loader/DynamicSpacePage.vue` | **Modify** | Add nested path matching + param extraction + pass params as props |

### Test space (`/Users/flakerim/ConstructProjects/organization-space/space-organization/`)

| File | Action | Purpose |
|------|--------|---------|
| `space.manifest.json` | **Modify** | Remove `component` fields (CLI should discover them) |
| `src/pages/members/[id].vue` | **Create** | Move `members-detail.vue` to filesystem convention |
| `src/pages/departments/[id].vue` | **Create** | Move `departments-detail.vue` to filesystem convention |
| `src/pages/teams/[id].vue` | **Create** | Move `teams-detail.vue` to filesystem convention |

---

## Conventions

Filesystem → route mapping (same as Nuxt):

```
src/pages/
  index.vue              → path: ""
  members.vue            → path: "members"
  members/[id].vue       → path: "members/:id"
  members/[id]/edit.vue  → path: "members/:id/edit"    (future)
  settings.vue           → path: "settings"
```

Rules:
- `[param]` in filenames or directories → `:param` in route path
- `index.vue` → empty segment (just the parent path)
- Manifest `pages` array still required for metadata (label, icon, hidden, toolbar)
- Manifest `component` field is an optional override — if absent, CLI resolves from filesystem
- If filesystem file doesn't exist for a manifest page, CLI errors with a clear message

---

## Task 1: CLI — Rewrite entry.ts generation with filesystem discovery

**Files:**
- Modify: `/Users/flakerim/Construct/packages/construct-cli/src/lib/entry.ts`

### Step 1: Write the new `resolvePages` function

- [ ] Replace the current `resolvePages` in `src/lib/entry.ts` with filesystem-aware resolution:

```typescript
import { writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs'
import { join, basename, extname, relative } from 'path'
import type { SpaceManifest, Page } from './manifest.js'

function capitalize(s: string): string {
  if (!s) return s
  return s
    .split(/[-_]/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('')
}

interface PageInfo {
  varName: string
  importPath: string
  path: string
}

/**
 * Scan src/pages/ directory and build a map of filesystem paths to route paths.
 * Convention: [param] in filenames → :param in routes (Nuxt-style).
 *
 * Examples:
 *   pages/index.vue         → ""
 *   pages/members.vue       → "members"
 *   pages/members/[id].vue  → "members/:id"
 */
function scanPagesDir(pagesDir: string, prefix = ''): Map<string, string> {
  const routes = new Map<string, string>()
  if (!existsSync(pagesDir)) return routes

  const entries = readdirSync(pagesDir, { withFileTypes: true })

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue

    if (entry.isDirectory()) {
      // Convert [param] directory name to :param
      const dirSegment = entry.name.replace(/\[([^\]]+)\]/g, ':$1')
      const subRoutes = scanPagesDir(join(pagesDir, entry.name), prefix ? `${prefix}/${dirSegment}` : dirSegment)
      for (const [filePath, routePath] of subRoutes) {
        routes.set(filePath, routePath)
      }
    } else if (entry.name.endsWith('.vue')) {
      const name = entry.name.replace('.vue', '')
      const filePath = join(pagesDir, entry.name)

      if (name === 'index') {
        // index.vue → parent path (or "" for root)
        routes.set(filePath, prefix)
      } else {
        // Convert [param] in filename to :param
        const segment = name.replace(/\[([^\]]+)\]/g, ':$1')
        routes.set(filePath, prefix ? `${prefix}/${segment}` : segment)
      }
    }
  }

  return routes
}

/**
 * Generate a safe JS variable name from a route path.
 *   ""              → "IndexPage"
 *   "members"       → "MembersPage"
 *   "members/:id"   → "MembersIdPage"  (but prefers "MembersDetailPage" from filename)
 */
function varNameFromFile(filePath: string, routePath: string): string {
  if (routePath === '') return 'IndexPage'

  const name = basename(filePath, '.vue')
  // Use the filename for the var name (more readable than route path)
  // Strip [brackets] and capitalize
  const clean = name.replace(/\[([^\]]+)\]/g, '$1')
  
  // Include parent directory if it exists (avoids collisions like members/[id] vs departments/[id])
  const parts = routePath.split('/').filter(Boolean)
  if (parts.length > 1) {
    // e.g. "members/:id" → use parent + filename: "MembersIdPage"
    const parent = parts[0]!.replace(/:/g, '')
    return capitalize(parent) + capitalize(clean) + 'Page'
  }

  return capitalize(clean) + 'Page'
}

function resolvePages(m: SpaceManifest, root: string, prefix: string): PageInfo[] {
  const pagesDir = join(root, 'src', 'pages')
  const fsRoutes = scanPagesDir(pagesDir)

  // Build a lookup: routePath → filesystem file path
  const fsLookup = new Map<string, string>()
  for (const [filePath, routePath] of fsRoutes) {
    fsLookup.set(routePath, filePath)
  }

  return m.pages.map(p => {
    // 1. Explicit component override in manifest
    if (p.component) {
      const varName = varNameFromFile(p.component, p.path)
      return { varName, importPath: prefix + p.component, path: p.path }
    }

    // 2. Filesystem discovery
    const fsFile = fsLookup.get(p.path)
    if (fsFile) {
      const relPath = relative(join(root, 'src'), fsFile).replace(/\\/g, '/')
      const varName = varNameFromFile(fsFile, p.path)
      return { varName, importPath: prefix + relPath, path: p.path }
    }

    // 3. Legacy fallback: pages/{path}.vue
    const legacyPath = p.path === '' ? 'pages/index.vue' : `pages/${p.path}.vue`
    const legacyFull = join(root, 'src', legacyPath)
    if (existsSync(legacyFull)) {
      const varName = varNameFromFile(legacyFull, p.path)
      return { varName, importPath: prefix + legacyPath, path: p.path }
    }

    // 4. Error — file not found
    console.error(`[entry] ERROR: No component found for page "${p.path}"`)
    console.error(`  Searched: ${join(pagesDir, '...')} (filesystem) and ${legacyFull} (legacy)`)
    console.error(`  Fix: Create the Vue file or add "component" field to manifest`)
    process.exit(1)
  })
}
```

- [ ] Update the `generate` function to pass `root`:

```typescript
export function generate(root: string, m: SpaceManifest): string {
  const pagePrefix = existsSync(join(root, 'src', 'pages')) ? './' : '../'
  const pages = resolvePages(m, root, pagePrefix)
  // ... rest unchanged
```

- [ ] Update the `writeEntry` function (no changes needed — already passes root).

### Step 2: Build the CLI

- [ ] Build and verify:

```bash
cd /Users/flakerim/Construct/packages/construct-cli
bun run build
```

Expected: Clean build, `dist/index.js` updated.

### Step 3: Commit CLI changes

- [ ] Commit:

```bash
cd /Users/flakerim/Construct/packages/construct-cli
git add src/lib/entry.ts
git commit -m "feat: filesystem-based page discovery for entry.ts generation

Scans src/pages/ for Vue files using Nuxt convention:
- [param] in filenames/dirs → :param in routes
- index.vue → empty segment
- Falls back to legacy pages/{path}.vue
- Manifest component field is optional override"
```

---

## Task 2: Host — Add catch-all subPage route for multi-segment paths

**Files:**
- Modify: `/Users/flakerim/Construct/construct-app/frontend/router/routes.ts`

### Step 1: Change `:subPage` to catch-all pattern

- [ ] In `routes.ts`, change all `:subPage` route segments to `:subPage(.*)` so paths like `members/123` reach DynamicSpacePage as a single `subPage` string:

Four locations to change (company-scoped, project-scoped, preview, runner):

**Company-scoped (line 202):**
```typescript
          {
            path: ':subPage(.*)',
            component: () => import('@/space_loader/DynamicSpacePage.vue'),
            props: (route) => ({
              spaceName: route.params.spaceName,
              subPage: route.params.subPage,
            }),
          },
```

**Project-scoped (line 150):**
```typescript
              {
                path: ':subPage(.*)',
                component: () => import('@/space_loader/DynamicSpacePage.vue'),
                props: (route) => ({
                  spaceName: route.params.spaceName,
                  subPage: route.params.subPage,
                  projectId: route.params.projectId,
                }),
              },
```

**Preview (line 231):**
```typescript
  {
    path: '/preview/:spaceName/:subPage(.*)',
    component: () => import('@/pages/SpacePreviewPage.vue'),
    props: (route) => ({
      spaceName: route.params.spaceName,
      subPage: route.params.subPage,
    }),
  },
```

**Runner (line 261):**
```typescript
  {
    path: '/runner/:spaceName/:subPage(.*)',
    component: () => import('@/pages/SpaceRunnerPage.vue'),
    props: (route) => ({
      spaceName: route.params.spaceName,
      subPage: route.params.subPage,
      projectPath: route.query.dir as string | undefined,
      project: route.query.project as string | undefined,
    }),
  },
```

### Step 2: Verify existing routes still work

- [ ] Run frontend typecheck:

```bash
cd /Users/flakerim/Construct/construct-app
bun run typecheck
```

### Step 3: Commit

- [ ] Commit:

```bash
git add frontend/router/routes.ts
git commit -m "feat: catch-all subPage route for multi-segment space paths

Changes :subPage to :subPage(.*) so paths like organization/members/123
reach DynamicSpacePage with subPage='members/123'."
```

---

## Task 3: Host — Upgrade DynamicSpacePage to match nested paths and pass params

**Files:**
- Modify: `/Users/flakerim/Construct/construct-app/frontend/space_loader/DynamicSpacePage.vue`

### Step 1: Replace the `currentPage` computed with nested path matching

- [ ] Replace the existing `currentPage` computed (lines 82-95) with param-aware matching:

```typescript
/** Match a URL path against a route pattern with :param segments.
 *  Returns extracted params or null if no match.
 *  Example: matchRoute("members/123", "members/:id") → { id: "123" }
 */
function matchRoute(urlPath: string, pattern: string): Record<string, string> | null {
  const urlParts = urlPath.split('/').filter(Boolean)
  const patternParts = pattern.split('/').filter(Boolean)
  if (urlParts.length !== patternParts.length) return null

  const params: Record<string, string> = {}
  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i]!
    const up = urlParts[i]!
    if (pp.startsWith(':')) {
      params[pp.slice(1)] = up
    } else if (pp !== up) {
      return null
    }
  }
  return params
}

/** Extracted route params for the current page */
const routeParams = shallowRef<Record<string, string>>({})

/** The Vue component to render for the current page */
const currentPage = computed(() => {
  if (!space.value?.pages) return null

  const path = currentPagePath.value

  // 1. Exact match (static pages)
  if (space.value.pages[path]) {
    routeParams.value = {}
    return space.value.pages[path]
  }

  // 2. Pattern match (parameterized pages like "members/:id")
  for (const key of Object.keys(space.value.pages)) {
    if (!key.includes(':')) continue
    const params = matchRoute(path, key)
    if (params) {
      routeParams.value = params
      return space.value.pages[key]
    }
  }

  return null
})
```

### Step 2: Pass extracted params as props to the space component

- [ ] Update the `<component>` render (line 371-376) to pass params:

```vue
      <component
        v-if="currentPage"
        :is="currentPage"
        :key="`${spaceName}-${currentPagePath}`"
        :project-id="projectId"
        v-bind="routeParams"
      />
```

This passes extracted params as props — e.g. `members/123` on pattern `members/:id` passes `:id="123"` as a prop.

### Step 3: Typecheck and verify

- [ ] Run typecheck:

```bash
bun run typecheck
```

### Step 4: Commit

- [ ] Commit:

```bash
git add frontend/space_loader/DynamicSpacePage.vue
git commit -m "feat: parameterized route matching in DynamicSpacePage

Matches URL paths against :param patterns in space page keys.
Extracts params and passes them as props to space components.
Example: members/123 matches members/:id, passes id='123'."
```

---

## Task 4: Test space — migrate to filesystem convention

**Files:**
- Modify: `/Users/flakerim/ConstructProjects/organization-space/space-organization/space.manifest.json`
- Create: `src/pages/members/[id].vue`
- Create: `src/pages/departments/[id].vue`
- Create: `src/pages/teams/[id].vue`
- Delete: `src/pages/members-detail.vue`
- Delete: `src/pages/departments-detail.vue`
- Delete: `src/pages/teams-detail.vue`

### Step 1: Move detail pages to `[id].vue` convention

- [ ] Move files:

```bash
cd /Users/flakerim/ConstructProjects/organization-space/space-organization
mkdir -p src/pages/members src/pages/departments src/pages/teams
mv src/pages/members-detail.vue src/pages/members/\[id\].vue
mv src/pages/departments-detail.vue src/pages/departments/\[id\].vue
mv src/pages/teams-detail.vue src/pages/teams/\[id\].vue
```

### Step 2: Remove component overrides from manifest

- [ ] Remove the `"component"` fields from the three parameterized pages in `space.manifest.json`:

```json
    {
      "path": "members/:id",
      "label": "Member Detail",
      "hidden": true
    },
    {
      "path": "departments/:id",
      "label": "Department Detail",
      "hidden": true
    },
    {
      "path": "teams/:id",
      "label": "Team Detail",
      "hidden": true
    },
```

### Step 3: Install updated CLI and build

- [ ] Link the updated CLI and build:

```bash
cd /Users/flakerim/ConstructProjects/organization-space/space-organization
bun add ../../../Construct/packages/construct-cli --dev
bun run build
```

Expected: Build succeeds. Generated `entry.ts` should contain:
```typescript
import MembersIdPage from './pages/members/[id].vue'
import DepartmentsIdPage from './pages/departments/[id].vue'
import TeamsIdPage from './pages/teams/[id].vue'
```

### Step 4: Verify generated entry.ts

- [ ] Check the generated entry:

```bash
cat src/entry.ts
```

Expected: All imports resolve to real files, no `:` in import paths, valid JS identifiers for all variable names.

---

## Task 5: Frontend tests

**Files:**
- Modify: `/Users/flakerim/Construct/construct-app/frontend/` (run existing tests)

### Step 1: Run frontend test suite

- [ ] Run tests:

```bash
cd /Users/flakerim/Construct/construct-app
bun run test
```

### Step 2: Run typecheck

- [ ] Typecheck:

```bash
bun run typecheck
```

### Step 3: Run lint

- [ ] Lint:

```bash
bun run lint
```

### Step 4: Commit all host changes

- [ ] Final commit with all changes:

```bash
cd /Users/flakerim/Construct/construct-app
git add frontend/router/routes.ts frontend/space_loader/DynamicSpacePage.vue
git commit -m "feat: file-based routing for dynamic spaces

- Router uses catch-all :subPage(.*) for multi-segment paths
- DynamicSpacePage matches parameterized patterns and extracts params
- Params passed as props to space page components"
```
