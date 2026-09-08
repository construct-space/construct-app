# Space Scopes & Project Awareness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace single-value `scope` ('app'|'project'|'org'|'both'|'company') with two orthogonal manifest fields — `scopes: ('app'|'org')[]` (ownership: who can install) and `projectAware: boolean` (capability: does space see projects). Migrate SDK, validators, host, marketplace API, marketplace UI, and 25 existing space manifests.

**Architecture:**
- **Ownership** (`scopes`): array — `["app"]` personal install, `["org"]` org-shared install, `["app","org"]` both. Marketplace filters by array containment.
- **Project awareness** (`projectAware`): boolean — `true` mounts space at `/<space>` (index) AND `/projects/:id/<space>` (per-project); `false` mounts only at `/<space>`. Host injects `host.project` (set/unset) so the same space code handles both routes.
- Legacy `scope` strings auto-map: `'app' → ["app"]`, `'org'/'company' → ["org"]`, `'project' → ["org"], projectAware:true`, `'both' → ["app","org"], projectAware:true`.

**Tech Stack:** TypeScript (SDK + Vue 3 frontend), Go 1.22 (marketplace-api), Postgres 15 (`text[]` + GIN), Vitest, `go test`.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `packages/sdk/src/types/manifest.ts` | Canonical `SpaceManifest` type spaces import | Modify |
| `packages/sdk/package.json` | Bump 0.8.0 → 0.9.0 | Modify |
| `apps/construct-app/frontend/types/space.ts` | Runtime `validateSpaceManifest` (errors) | Modify |
| `apps/construct-app/frontend/space_loader/validation.ts` | Loader-time validation (warnings) + legacy alias | Modify |
| `apps/construct-app/frontend/space_loader/__tests__/spaceContract.test.ts` | Manifest fixture tests | Modify |
| `apps/construct-app/frontend/space_loader/__tests__/spaceStability.test.ts` | Validation rule tests | Modify |
| `apps/construct-app/frontend/lib/spaceHost.ts` | Expose `host.scope` + `scope.changed` event | Modify |
| `apps/construct-app/frontend/lib/__tests__/spaceHost.test.ts` | Host scope event test | Create or modify |
| `apps/construct-app/frontend/router/routes.ts` | Gate project-aware routing (runtime check) | Read-only (no change — existing routes already cover both shapes) |
| `api/marketplace-api/internal/models/space.go` | DB model: `Scopes pq.StringArray` + `ProjectAware bool` | Modify |
| `api/marketplace-api/internal/database/migrations/2026-05-02_scopes_array.sql` | One-time SQL migration | Create |
| `api/marketplace-api/internal/handlers/marketplace.go` | `ListSpaces` array-contains query | Modify |
| `api/marketplace-api/internal/handlers/marketplace_test.go` | Handler test | Create or modify |
| `apps/construct-app/frontend/composables/useSpaceMarketplace.ts` | `MarketplaceSpace` type + filter | Modify |
| `apps/construct-app/frontend/composables/useSpaceMarketplace.test.ts` | Mapper test | Modify |
| `apps/construct-app/frontend/pages/MarketplacePage.vue` | Toolbar select labels | Modify |
| `apps/construct-app/frontend/components/marketplace/MarketplaceCard.vue` | Scope badge | Modify |
| `scripts/migrate-space-manifests.mjs` | One-shot script to rewrite 25 manifests | Create |

---

## Task 1: SDK manifest types

**Files:**
- Modify: `packages/sdk/src/types/manifest.ts:3-16`
- Modify: `packages/sdk/package.json` (version)

- [ ] **Step 1: Add fields to `SpaceManifest`**

In `packages/sdk/src/types/manifest.ts`, replace the `SpaceManifest` interface (lines 3-16) with:

```ts
export type SpaceScope = 'app' | 'org'

export interface SpaceManifest {
  id: string
  name: string
  version: string
  description?: string
  icon?: string
  /**
   * Ownership scopes the space supports. `app` = personal install,
   * `org` = org-shared install. Default `['app']` for backwards-compat.
   */
  scopes?: SpaceScope[]
  /**
   * If true, the space participates in project context. Host mounts it at
   * both `/<space>` (index/picker) and `/projects/:id/<space>` (per-project).
   * If false, the space mounts only at the top level. Default false.
   */
  projectAware?: boolean
  navigation?: SpaceNavigation
  pages?: SpacePage[]
  toolbar?: SpaceToolbarConfig
  contextMenus?: Record<string, ManifestContextMenuItem[]>
  agent?: string
  skills?: string[]
  widgets?: SpaceWidgetManifest[]
}
```

- [ ] **Step 2: Bump SDK version**

In `packages/sdk/package.json`, change `"version": "0.8.0"` → `"version": "0.9.0"`.

- [ ] **Step 3: Build SDK**

Run: `cd /Users/flakerim/ConstructDev/packages/sdk && bun run build`
Expected: clean build, `dist/types/manifest.d.ts` re-emitted with new fields.

- [ ] **Step 4: Commit**

```bash
cd /Users/flakerim/ConstructDev/packages/sdk
git add src/types/manifest.ts package.json
git commit -m "feat: add scopes[] and projectAware to SpaceManifest"
```

---

## Task 2: App validator — write failing tests

**Files:**
- Modify: `apps/construct-app/frontend/space_loader/__tests__/spaceStability.test.ts`

- [ ] **Step 1: Add failing tests for new scope shape**

Open the file and locate the `validateSpaceManifest` test block. Add these test cases:

```ts
it('accepts scopes:["app"]', () => {
  const r = validateSpaceManifest(validManifest({ scopes: ['app'], scope: undefined }))
  expect(r.errors).toEqual([])
})

it('accepts scopes:["app","org"]', () => {
  const r = validateSpaceManifest(validManifest({ scopes: ['app', 'org'], scope: undefined }))
  expect(r.errors).toEqual([])
})

it('rejects scopes with unknown value', () => {
  const r = validateSpaceManifest(validManifest({ scopes: ['bogus'] as unknown as string[], scope: undefined }))
  expect(r.errors.some(e => /scopes/.test(e))).toBe(true)
})

it('legacy scope:"project" maps to scopes:["org"] and projectAware:true', () => {
  const r = validateSpaceManifest(validManifest({ scope: 'project' as unknown as 'app' }))
  expect(r.errors).toEqual([])
  expect(r.warnings.some(w => /Legacy.*"project"/.test(w))).toBe(true)
})

it('legacy scope:"both" maps to scopes:["app","org"] and projectAware:true', () => {
  const r = validateSpaceManifest(validManifest({ scope: 'both' as unknown as 'app' }))
  expect(r.errors).toEqual([])
  expect(r.warnings.some(w => /Legacy.*"both"/.test(w))).toBe(true)
})
```

(Reuse existing `validManifest()` helper. If it doesn't accept `scopes` yet, widen its parameter type to `Partial<SpaceManifest>`.)

- [ ] **Step 2: Run tests — verify all five fail**

Run: `cd /Users/flakerim/ConstructDev/apps/construct-app && bun run test -- spaceStability`
Expected: 5 new tests fail (validator doesn't yet handle `scopes` array or `'project'`/`'both'` legacy values).

---

## Task 3: App validator — implement

**Files:**
- Modify: `apps/construct-app/frontend/types/space.ts:79, 138-142`
- Modify: `apps/construct-app/frontend/space_loader/validation.ts:24-27, 67-74`

- [ ] **Step 1: Update type in `types/space.ts`**

In `frontend/types/space.ts`, find line 79 (`scope: 'app' | 'project' | 'org'`) and replace with:

```ts
scopes: ('app' | 'org')[]
projectAware?: boolean
```

- [ ] **Step 2: Update validator in `types/space.ts`**

Find the block around lines 138-142 that validates `manifest.scope`. Replace with:

```ts
// scope / scopes / projectAware
const validScopeValues = ['app', 'org']
let normalizedScopes: string[] | null = null
let normalizedProjectAware = false

if (Array.isArray((manifest as { scopes?: unknown }).scopes)) {
  const scopes = (manifest as { scopes: unknown[] }).scopes
  if (!scopes.every(s => typeof s === 'string' && validScopeValues.includes(s))) {
    errors.push(`Invalid "scopes" — each item must be one of: ${validScopeValues.join(', ')}`)
  } else {
    normalizedScopes = scopes as string[]
  }
  if (typeof (manifest as { projectAware?: unknown }).projectAware === 'boolean') {
    normalizedProjectAware = (manifest as { projectAware: boolean }).projectAware
  }
} else if (typeof (manifest as { scope?: unknown }).scope === 'string') {
  // Legacy single-value scope. Map to new shape.
  const legacy = (manifest as { scope: string }).scope
  switch (legacy) {
    case 'app':     normalizedScopes = ['app']; break
    case 'org':
    case 'company': normalizedScopes = ['org']; break
    case 'project': normalizedScopes = ['org']; normalizedProjectAware = true; break
    case 'both':    normalizedScopes = ['app', 'org']; normalizedProjectAware = true; break
    default:
      errors.push(`Invalid legacy "scope" value "${legacy}"`)
  }
} else {
  errors.push('Missing "scopes" (array of "app" | "org")')
}

if (normalizedScopes) {
  ;(manifest as { scopes: string[] }).scopes = normalizedScopes
  ;(manifest as { projectAware: boolean }).projectAware = normalizedProjectAware
}
```

- [ ] **Step 3: Update loader validation**

In `frontend/space_loader/validation.ts`, replace `normalizeManifestScope` (lines 24-27) with:

```ts
export function normalizeManifestScopes(manifest: Record<string, unknown>): { scopes: ('app' | 'org')[]; projectAware: boolean } {
  if (Array.isArray(manifest.scopes) && manifest.scopes.every(s => s === 'app' || s === 'org')) {
    return {
      scopes: manifest.scopes as ('app' | 'org')[],
      projectAware: manifest.projectAware === true,
    }
  }
  switch (manifest.scope) {
    case 'app':                     return { scopes: ['app'], projectAware: false }
    case 'org': case 'company':     return { scopes: ['org'], projectAware: false }
    case 'project':                 return { scopes: ['org'], projectAware: true }
    case 'both':                    return { scopes: ['app', 'org'], projectAware: true }
  }
  return { scopes: ['app'], projectAware: false }
}
```

Then in the same file (around lines 67-74), replace the inline scope validation with:

```ts
// scope / scopes (warn-level, not blocking)
if (manifest.scope !== undefined) {
  if (manifest.scope === 'company') {
    warnings.push('Legacy "scope" value "company" is deprecated; use scopes:["org"]')
  } else if (manifest.scope === 'project') {
    warnings.push('Legacy "scope" value "project" is deprecated; use scopes:["org"], projectAware:true')
  } else if (manifest.scope === 'both') {
    warnings.push('Legacy "scope" value "both" is deprecated; use scopes:["app","org"], projectAware:true')
  } else if (typeof manifest.scope !== 'string' || !['app', 'org'].includes(manifest.scope)) {
    warnings.push('Invalid "scope" value (expected "app" or "org"; prefer scopes array)')
  }
}
if (manifest.scopes !== undefined) {
  if (!Array.isArray(manifest.scopes) || !manifest.scopes.every(s => s === 'app' || s === 'org')) {
    warnings.push('Invalid "scopes" — must be an array of "app" | "org"')
  }
}
```

- [ ] **Step 4: Update any internal callers**

Run: `cd /Users/flakerim/ConstructDev/apps/construct-app && grep -rn "normalizeManifestScope[^s]" frontend`
For each hit, replace `normalizeManifestScope(m.scope)` with `normalizeManifestScopes(m).scopes[0] /* legacy */` or migrate the caller to use the full result. If only the loader uses it, no further changes needed.

- [ ] **Step 5: Run tests — verify they pass**

Run: `cd /Users/flakerim/ConstructDev/apps/construct-app && bun run test -- spaceStability spaceContract`
Expected: previously-failing tests now pass; existing tests still pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/flakerim/ConstructDev/apps/construct-app
git add frontend/types/space.ts frontend/space_loader/validation.ts frontend/space_loader/__tests__/spaceStability.test.ts
git commit -m "feat(space): scopes[] and projectAware fields with legacy alias"
```

---

## Task 4: Host SDK exposes scope

**Files:**
- Modify: `apps/construct-app/frontend/lib/spaceHost.ts`
- Modify: `apps/construct-app/frontend/lib/__tests__/spaceHost.test.ts` (or create)

- [ ] **Step 1: Locate org/scope source**

Run: `grep -n "useOrg\|isOrg\|currentOrg" frontend/lib/spaceHost.ts frontend/composables/useOrg.ts | head -20`
Identify the active-org signal that determines whether the user is in personal vs org mode.

- [ ] **Step 2: Add `host.scope` accessor + emitter**

In `frontend/lib/spaceHost.ts`, inside `initSpaceHost()` (or wherever the host object is built — search for the existing `currentProject` accessor at line 50), add a `scope` field:

```ts
// Active ownership scope. 'org' when the user is in an organization,
// 'app' otherwise. Spaces query this to decide which project list to show.
get scope(): 'app' | 'org' {
  // Reuse whichever store/composable already drives the org switcher.
  return useOrg().isOrg.value ? 'org' : 'app'
},
```

If the host already has an event bus (`bus.emit(...)`), watch the org signal and emit `'scope.changed'`:

```ts
watch(() => useOrg().isOrg.value, (isOrg) => {
  bus.emit('scope.changed', { scope: isOrg ? 'org' : 'app' })
})
```

If no bus exists, use the existing pattern (mitt instance, EventTarget — copy whichever the project uses).

- [ ] **Step 3: Test the event**

In `frontend/lib/__tests__/spaceHost.test.ts` (create if missing — copy fixture from a sibling `lib/__tests__/*.test.ts`), add:

```ts
it('emits scope.changed when org context flips', async () => {
  const host = initSpaceHost()
  const events: Array<{ scope: string }> = []
  host.on?.('scope.changed', (e: { scope: string }) => events.push(e))
  // Toggle org store value (refer to existing useOrg test pattern)
  const org = useOrg()
  org.isOrg.value = true
  await flushPromises()
  expect(events).toEqual([{ scope: 'org' }])
})
```

- [ ] **Step 4: Run tests**

Run: `bun run test -- spaceHost`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/spaceHost.ts frontend/lib/__tests__/spaceHost.test.ts
git commit -m "feat(host): expose host.scope and emit scope.changed"
```

---

## Task 5: Marketplace backend — model + migration

**Files:**
- Modify: `api/marketplace-api/internal/models/space.go:21-49`
- Create: `api/marketplace-api/internal/database/migrations/2026-05-02_scopes_array.sql`
- Modify: `api/marketplace-api/internal/database/database.go` (auto-migrate registration)

- [ ] **Step 1: Update Space model**

In `internal/models/space.go`, replace the `Scope string` line (around line 30) with:

```go
Scopes        pq.StringArray `gorm:"type:text[];index:,type:gin"      json:"scopes"`
ProjectAware  bool           `gorm:"default:false"                    json:"project_aware"`
```

(Drop the original `Scope` field entirely. Imports already include `github.com/lib/pq`.)

- [ ] **Step 2: Write SQL migration**

Create `internal/database/migrations/2026-05-02_scopes_array.sql`:

```sql
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS scopes text[] DEFAULT ARRAY['app']::text[];
ALTER TABLE spaces ADD COLUMN IF NOT EXISTS project_aware boolean DEFAULT false;

UPDATE spaces SET
  scopes = CASE scope
    WHEN 'app'     THEN ARRAY['app']
    WHEN 'org'     THEN ARRAY['org']
    WHEN 'company' THEN ARRAY['org']
    WHEN 'project' THEN ARRAY['org']
    WHEN 'both'    THEN ARRAY['app','org']
    ELSE ARRAY['app']
  END,
  project_aware = (scope IN ('project','both'))
WHERE scope IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_spaces_scopes_gin ON spaces USING GIN (scopes);
ALTER TABLE spaces DROP COLUMN IF EXISTS scope;
```

- [ ] **Step 3: Wire migration runner**

In `internal/database/database.go`, find where migrations are loaded (likely a `runMigrations` or auto-migrate call). Add the new file to the migration list (mirror the existing pattern). If the project uses GORM `AutoMigrate` instead of explicit SQL, the model-level change in Step 1 suffices and Step 2's SQL becomes a one-shot `psql` command run during deploy — note in `README.md`.

- [ ] **Step 4: Build the service**

Run: `cd /Users/flakerim/ConstructDev/api/marketplace-api && go build ./...`
Expected: clean build.

- [ ] **Step 5: Commit**

```bash
cd /Users/flakerim/ConstructDev/api/marketplace-api
git add internal/models/space.go internal/database/migrations/2026-05-02_scopes_array.sql internal/database/database.go
git commit -m "feat(marketplace): scopes text[] + project_aware columns"
```

---

## Task 6: Marketplace backend — query + handler test

**Files:**
- Modify: `api/marketplace-api/internal/handlers/marketplace.go:21, 36-39`
- Create or modify: `api/marketplace-api/internal/handlers/marketplace_test.go`

- [ ] **Step 1: Add failing test**

Create `internal/handlers/marketplace_test.go` (or append to existing). Use the existing test scaffolding pattern from `internal/handlers/health_test.go` if present; otherwise stub a SQLite-backed gorm DB:

```go
func TestListSpaces_FiltersByScope(t *testing.T) {
    setupTestDB(t)
    seed(&models.Space{Name: "a", Scopes: pq.StringArray{"app"}, PromotedAt: time.Now()})
    seed(&models.Space{Name: "b", Scopes: pq.StringArray{"org"}, PromotedAt: time.Now()})
    seed(&models.Space{Name: "c", Scopes: pq.StringArray{"app","org"}, PromotedAt: time.Now()})

    req := httptest.NewRequest("GET", "/api/marketplace/spaces?scope=org", nil)
    w := httptest.NewRecorder()
    ListSpaces(w, req)

    var resp struct{ Spaces []models.Space }
    json.NewDecoder(w.Body).Decode(&resp)
    names := []string{}
    for _, s := range resp.Spaces { names = append(names, s.Name) }
    sort.Strings(names)
    if !reflect.DeepEqual(names, []string{"b","c"}) {
        t.Fatalf("expected [b c], got %v", names)
    }
}
```

(If the project has no test setup helper, stub one in `internal/handlers/testing_test.go` that opens an in-memory Postgres via `dockertest` — or skip this task and rely on integration tests.)

- [ ] **Step 2: Run test — verify it fails**

Run: `cd /Users/flakerim/ConstructDev/api/marketplace-api && go test ./internal/handlers/ -run TestListSpaces_FiltersByScope -v`
Expected: fails (no `scope` query param handling yet).

- [ ] **Step 3: Update `ListSpaces` to accept `scope` filter**

In `internal/handlers/marketplace.go`, after the `tag` filter block (around line 39), add:

```go
scope := strings.TrimSpace(r.URL.Query().Get("scope"))
if scope != "" {
    tx = tx.Where("scopes @> ARRAY[?]::text[]", scope)
}
```

- [ ] **Step 4: Run test — verify it passes**

Run: `go test ./internal/handlers/ -run TestListSpaces_FiltersByScope -v`
Expected: pass.

- [ ] **Step 5: Run full Go test suite**

Run: `go test ./...`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add internal/handlers/marketplace.go internal/handlers/marketplace_test.go
git commit -m "feat(marketplace): scope filter on /spaces (array contains)"
```

---

## Task 7: Frontend marketplace composable

**Files:**
- Modify: `apps/construct-app/frontend/composables/useSpaceMarketplace.ts`
- Modify: `apps/construct-app/frontend/composables/useSpaceMarketplace.test.ts`

- [ ] **Step 1: Update test fixtures and add scope filter test**

In `useSpaceMarketplace.test.ts`, change the `fixture()` helper:

```ts
function fixture(overrides: Partial<MarketplaceSpace> = {}): MarketplaceSpace {
  return {
    id: 'kanban-board',
    name: 'Kanban Board',
    description: 'Drag-and-drop tasks',
    icon: 'lucide:kanban',
    version: '1.2.3',
    tarball_url: 'https://my.construct.space/api/marketplace/downloads/kanban-board-1.2.3.tar.gz',
    scopes: ['org'],            // was: scope: 'project'
    project_aware: true,        // new
    publisher_slug: 'acme',
    publisher_name: 'Acme Inc',
    category: 'productivity',
    tags: ['tasks', 'agile'],
    downloads: 42,
    installs_7d: 5,
    installs_30d: 12,
    promoted_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-15T00:00:00Z',
    ...overrides,
  }
}

it('falls back to first scope when category is null', () => {
  const r = marketplaceSpaceToRemote(fixture({ category: null, scopes: ['app'] }))
  expect(r.category).toBe('app')
})
```

Remove the old `'falls back to scope when category is null'` test (the `scope` field no longer exists on `MarketplaceSpace`).

- [ ] **Step 2: Run tests — verify failures**

Run: `bun run test -- useSpaceMarketplace`
Expected: type errors and one assertion fail.

- [ ] **Step 3: Update `MarketplaceSpace` type**

In `useSpaceMarketplace.ts`, replace the `scope: string` field with:

```ts
scopes: ('app' | 'org')[]
project_aware: boolean
```

(Drop `scope`. The interface should now match the backend Go model.)

- [ ] **Step 4: Update mapper**

In `marketplaceSpaceToRemote()`, replace `category: s.category || s.scope` with:

```ts
category: s.category || s.scopes?.[0] || 'app',
```

- [ ] **Step 5: Update `filteredRemote` scope filter**

Replace the existing `filteredRemote` computed:

```ts
const filteredRemote = computed(() => {
  let list = remote.value
  if (activeScope.value !== 'all') {
    // RemoteSpace stores scopes derivatively in `category` for legacy callers,
    // but we keep the source on the raw remote map. Filter against the cached
    // raw spaces map by id.
    list = list.filter(s => rawScopesById.value[s.id]?.includes(activeScope.value))
  }
  if (!isOrg.value) {
    list = list.filter(s => !rawScopesById.value[s.id]?.includes('org')
      || rawScopesById.value[s.id]?.includes('app'))
  }
  return list
})
```

Add `rawScopesById` ref above `filteredRemote`:

```ts
const rawScopesById = ref<Record<string, string[]>>({})
```

In `fetchRemote`, after `remote.value = data.spaces.map(marketplaceSpaceToRemote)`, populate it:

```ts
rawScopesById.value = Object.fromEntries(data.spaces.map(s => [s.id, s.scopes]))
```

- [ ] **Step 6: Send scope to backend when set**

In `fetchRemote`, after the `category` param block, add:

```ts
if (activeScope.value !== 'all') params.set('scope', activeScope.value)
```

(This narrows results server-side; the client filter is a safety net.)

- [ ] **Step 7: Run tests**

Run: `bun run test -- useSpaceMarketplace`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add frontend/composables/useSpaceMarketplace.ts frontend/composables/useSpaceMarketplace.test.ts
git commit -m "feat(marketplace): client uses scopes[] and project_aware"
```

---

## Task 8: Marketplace UI — labels + badge

**Files:**
- Modify: `apps/construct-app/frontend/pages/MarketplacePage.vue:21-25, 51-60`
- Modify: `apps/construct-app/frontend/components/marketplace/MarketplaceCard.vue`

- [ ] **Step 1: Update toolbar scope select**

In `MarketplacePage.vue`, replace the `scopeLabels` map (lines 21-25):

```ts
const scopeLabels: Record<string, string> = {
  app: 'Personal',
  org: 'Organization',
}
```

And in `fetchFilters`, replace the `SCOPES` array (around line 53):

```ts
const SCOPES = ['app', 'org']
```

- [ ] **Step 2: Show scope badge on card**

In `MarketplaceCard.vue`, accept the new fields via the `space` prop (no change needed — `RemoteSpace` extends but the card uses `space.category`). To show the actual badge, extend the card props:

```ts
defineProps<{
  space: RemoteSpace
  scopes?: ('app' | 'org')[]
  projectAware?: boolean
  icon: string
  installed: boolean
  hasUpdate: boolean
  installing: boolean
}>()
```

In the template, after the meta line, add:

```vue
<div class="flex gap-1 mt-1">
  <span v-if="scopes?.includes('app')" class="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)] text-[var(--app-muted)]">Personal</span>
  <span v-if="scopes?.includes('org')" class="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-[color-mix(in_srgb,var(--app-accent)_12%,transparent)] text-[var(--app-accent)]">Org</span>
  <span v-if="projectAware" class="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)] text-[var(--app-muted)]">Project</span>
</div>
```

- [ ] **Step 3: Pass props from `MarketplacePage.vue`**

For each `<MarketplaceCard ...>` usage (two: collection strip + grid), add:

```vue
:scopes="rawScopesById[space.id]"
:project-aware="rawProjectAwareById[space.id]"
```

Add `rawProjectAwareById` to `useSpaceMarketplace.ts` symmetric to `rawScopesById`, and expose it.

- [ ] **Step 4: Run tests + manual smoke**

```bash
bun run test
bun run dev:frontend
```

Open http://localhost:60200/app/marketplace, verify Personal/Organization options in toolbar, badges visible on cards.

- [ ] **Step 5: Commit**

```bash
git add frontend/pages/MarketplacePage.vue frontend/components/marketplace/MarketplaceCard.vue frontend/composables/useSpaceMarketplace.ts
git commit -m "feat(marketplace): Personal/Org labels and scope badges on cards"
```

---

## Task 9: Migrate 25 space manifests

**Files:**
- Create: `scripts/migrate-space-manifests.mjs`

- [ ] **Step 1: Write the migration script**

Create `/Users/flakerim/ConstructDev/scripts/migrate-space-manifests.mjs`:

```js
#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SPACES_DIR = process.argv[2] || `${process.env.HOME}/Spaces`

function migrate(manifest) {
  if (Array.isArray(manifest.scopes)) return null // already migrated
  const legacy = manifest.scope
  let scopes, projectAware
  switch (legacy) {
    case 'app':                 scopes = ['app']; projectAware = false; break
    case 'org': case 'company': scopes = ['org']; projectAware = false; break
    case 'project':             scopes = ['org']; projectAware = true; break
    case 'both':                scopes = ['app', 'org']; projectAware = true; break
    default:                    scopes = ['app']; projectAware = false
  }
  delete manifest.scope
  manifest.scopes = scopes
  manifest.projectAware = projectAware
  return manifest
}

let migrated = 0
for (const dir of readdirSync(SPACES_DIR)) {
  if (!dir.startsWith('space-')) continue
  const path = join(SPACES_DIR, dir, 'space.manifest.json')
  try {
    if (!statSync(path).isFile()) continue
  } catch { continue }
  const raw = readFileSync(path, 'utf8')
  const manifest = JSON.parse(raw)
  const updated = migrate(manifest)
  if (updated) {
    writeFileSync(path, JSON.stringify(updated, null, 2) + '\n')
    console.log(`migrated: ${dir} → scopes=${JSON.stringify(updated.scopes)} projectAware=${updated.projectAware}`)
    migrated++
  }
}
console.log(`\nDone. Migrated ${migrated} manifest(s).`)
```

- [ ] **Step 2: Run the script**

Run: `node /Users/flakerim/ConstructDev/scripts/migrate-space-manifests.mjs`
Expected: prints 25 lines (one per migrated manifest), final summary `Migrated 25 manifest(s).`

- [ ] **Step 3: Spot-check three manifests**

Run: `cat ~/Spaces/space-board/space.manifest.json | head -10`
Expected: contains `"scopes": ["org"]` and `"projectAware": true` (board was previously `scope:"org"`, but per the design table it should become `projectAware:true`).

**Adjustment needed:** the script as written sets `projectAware:false` for legacy `scope:"org"`. That's correct migration semantics (no behavior change), but the design wants 17 spaces flagged `projectAware:true`. Add a manual second pass:

```bash
for s in board kanban calendar notes pages drive time mail messenger helpdesk expenses analytics invoicing payroll timeoff people crm inventory; do
  node -e "const fs=require('fs');const p='${HOME}/Spaces/space-$s/space.manifest.json';const m=JSON.parse(fs.readFileSync(p,'utf8'));m.projectAware=true;fs.writeFileSync(p,JSON.stringify(m,null,2)+'\n')"
done
```

(This explicitly opts in spaces that need projects. Remaining spaces — weather, nba, bookmarks, habits, journal, subscriptions, finance, library — keep `projectAware:false`.)

- [ ] **Step 4: Verify all manifests parse and validate**

Run from inside the construct-app worktree:

```bash
cd /Users/flakerim/ConstructDev/apps/construct-app
node -e "
const { validateSpaceManifest } = require('./frontend/types/space.ts')
const fs = require('fs'); const path = require('path')
for (const dir of fs.readdirSync(\`\${process.env.HOME}/Spaces\`)) {
  if (!dir.startsWith('space-')) continue
  const p = \`\${process.env.HOME}/Spaces/\${dir}/space.manifest.json\`
  if (!fs.existsSync(p)) continue
  const m = JSON.parse(fs.readFileSync(p,'utf8'))
  const r = validateSpaceManifest(m)
  if (r.errors.length) console.error(dir, r.errors)
}
"
```

(If `node` can't load `.ts` directly, run via `bun -e` instead.)

Expected: zero error output.

- [ ] **Step 5: Commit (in the Spaces repo, not ConstructDev)**

```bash
cd ~/Spaces
git add space-*/space.manifest.json
git commit -m "migrate manifests to scopes[] and projectAware"
```

---

## Task 10: Final verification

- [ ] **Step 1: Run app-side type/test**

```bash
cd /Users/flakerim/ConstructDev/apps/construct-app
bun run typecheck
bun run test
```

Expected: zero type errors (or only the preexisting `vite.config.ts` ESBuildOptions issue), 527+ tests pass.

- [ ] **Step 2: Run marketplace-api tests**

```bash
cd /Users/flakerim/ConstructDev/api/marketplace-api
go test ./...
```

Expected: all green.

- [ ] **Step 3: Smoke test marketplace UI**

```bash
cd /Users/flakerim/ConstructDev/apps/construct-app
bun run dev
```

In the running app:
1. Open Marketplace page — collection strips render on top
2. Toolbar right shows scope select with "All / Personal / Organization"
3. Switch to "Personal" — only `app`-scoped spaces appear
4. Switch to "Organization" — only `org`-scoped spaces appear
5. Cards show Personal/Org/Project badges where applicable

- [ ] **Step 4: Tag SDK release**

```bash
cd /Users/flakerim/ConstructDev/packages/sdk
git tag v0.9.0
# Optional: git push origin v0.9.0 if publishing to npm
```
