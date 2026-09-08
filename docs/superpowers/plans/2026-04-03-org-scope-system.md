# Organization Scope System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add organization as a built-in space and first-class scope, so org-scoped marketplace spaces can share data across all org members keyed by `org_id`.

**Architecture:** Org is a host-native space (like project), disabled by default, enabled via Settings. Once enabled, `org_id` becomes a host-level context passed to all spaces via the SDK. Marketplace spaces with `scope: "org"` only appear when org is enabled. Data partitioning uses `org_id` instead of `user_id` for org-scoped spaces.

**Tech Stack:** Vue 3, Pinia, TypeScript, `@construct-space/sdk`, `@construct-space/cli`

---

## File Structure

### Type System

| File | Action | Purpose |
|------|--------|---------|
| `frontend/types/project.ts` | **Modify** | Change `SpaceScope` from `'user' \| 'company' \| 'project'` to `'app' \| 'project' \| 'org' \| 'any'` |
| `frontend/types/space.ts` | **Modify** | Update validation — valid scopes list |
| `frontend/types/org.ts` | **Create** | Org types: `Organization`, `OrgMember`, `OrgInvite` |

### Org Store & Composable

| File | Action | Purpose |
|------|--------|---------|
| `frontend/stores/org.ts` | **Create** | Pinia store: org state, members, settings, CRUD |
| `frontend/composables/useOrg.ts` | **Create** | Composable wrapping org store for space consumption |

### Space Filtering

| File | Action | Purpose |
|------|--------|---------|
| `frontend/composables/useSpaces.ts` | **Modify** | Update `getAppSpaces`/`getProjectSpaces` for new scopes + org dependency check |
| `frontend/space_loader/validation.ts` | **Modify** | Accept new scope values |
| `frontend/space_loader/__tests__/spaceContract.test.ts` | **Modify** | Update scope assertions |

### Host-Native Org Space

| File | Action | Purpose |
|------|--------|---------|
| `frontend/spaces/org/manifest.json` | **Create** | Org space manifest |
| `frontend/spaces/org/pages/OrgDashboardPage.vue` | **Create** | Org overview — members, departments, settings |
| `frontend/spaces/org/pages/OrgSettingsPage.vue` | **Create** | Org setup wizard + settings |
| `frontend/spaces/org/composables/useOrgData.ts` | **Create** | Org data management |

### Router

| File | Action | Purpose |
|------|--------|---------|
| `frontend/router/routes.ts` | **Modify** | Add org space routes |

### Settings

| File | Action | Purpose |
|------|--------|---------|
| `frontend/pages/settings/OrgSettingsPanel.vue` | **Create** | Enable/disable org, manage org settings |
| `frontend/router/settingsNavigation.ts` | **Modify** | Add org settings tab |

### SDK

| File | Action | Purpose |
|------|--------|---------|
| `frontend/lib/spaceHost.ts` | **Modify** | Expose `useOrgContext` via `window.__CONSTRUCT__` |

### CLI

| File | Action | Purpose |
|------|--------|---------|
| `packages/construct-cli/src/lib/manifest.ts` | **Modify** | Update scope enum |

### Marketplace

| File | Action | Purpose |
|------|--------|---------|
| `frontend/composables/useSpaceMarketplace.ts` | **Modify** | Show "Requires Organization" badge for org-scoped spaces |

---

## Task 1: Update SpaceScope type and validation

**Files:**
- Modify: `frontend/types/project.ts`
- Modify: `frontend/types/space.ts`
- Modify: `frontend/space_loader/validation.ts`
- Modify: `frontend/space_loader/__tests__/spaceContract.test.ts`

- [ ] **Step 1: Update the SpaceScope type**

In `frontend/types/project.ts`, change:
```typescript
export type SpaceScope = 'app' | 'project' | 'org' | 'any'
```

- [ ] **Step 2: Update manifest validation**

In `frontend/types/space.ts`, change the `validScopes` array:
```typescript
const validScopes = ['app', 'project', 'org', 'any']
```

- [ ] **Step 3: Update SpaceLoader validation**

In `frontend/space_loader/validation.ts`, update:
```typescript
const validScopes = ['app', 'project', 'org', 'any']
```

- [ ] **Step 4: Update test assertions**

In `frontend/space_loader/__tests__/spaceContract.test.ts`, update:
```typescript
expect(['app', 'project', 'org', 'any']).toContain(manifest.scope)
```

- [ ] **Step 5: Run typecheck**

```bash
bun run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add frontend/types/project.ts frontend/types/space.ts frontend/space_loader/validation.ts frontend/space_loader/__tests__/spaceContract.test.ts
git commit -m "feat: update SpaceScope to app|project|org|any"
```

---

## Task 2: Update space filtering for new scopes

**Files:**
- Modify: `frontend/composables/useSpaces.ts`

- [ ] **Step 1: Update SCOPE_DEFAULTS**

Replace old scope values with new ones:
```typescript
const SCOPE_DEFAULTS: Record<string, SpaceScope> = {
  brainstorm: 'app',
  project: 'app',
  architect: 'project',
  coder: 'project',
  editor: 'project',
}
```

- [ ] **Step 2: Update getProjectSpaces**

```typescript
export function getProjectSpaces(allSpaces: SpaceConfig[], projectSpaceIds?: string[]): SpaceConfig[] {
  return allSpaces.filter(s => {
    const scope = s.scope || SCOPE_DEFAULTS[s.name] || 'project'
    if (scope !== 'project' && scope !== 'any') return false
    if (projectSpaceIds?.length) return projectSpaceIds.includes(s.name)
    return true
  })
}
```

- [ ] **Step 3: Update getAppSpaces with org dependency check**

```typescript
export function getAppSpaces(allSpaces: SpaceConfig[], orgEnabled = false): SpaceConfig[] {
  return allSpaces.filter(s => {
    const scope = s.scope || SCOPE_DEFAULTS[s.name] || 'app'
    if (scope === 'project') return false
    if (scope === 'org' && !orgEnabled) return false
    return true // app, any, and org (when enabled)
  })
}
```

- [ ] **Step 4: Update manifestToSpaceConfig fallback**

```typescript
scope: (manifest.scope as SpaceScope) || SCOPE_DEFAULTS[id] || 'any',
```

- [ ] **Step 5: Run typecheck**

```bash
bun run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add frontend/composables/useSpaces.ts
git commit -m "feat: space filtering for app/project/org/any scopes"
```

---

## Task 3: Update builtin space manifests

**Files:**
- Modify: `frontend/spaces/brainstorm/manifest.json`
- Modify: `frontend/spaces/project/manifest.json`
- Modify: `frontend/spaces/architect/manifest.json`
- Modify: `frontend/spaces/coder/manifest.json`
- Modify: `frontend/spaces/editor/manifest.json`

- [ ] **Step 1: Update each manifest scope**

| Space | Old scope | New scope |
|-------|-----------|-----------|
| brainstorm | `user` | `app` |
| project | `user` | `app` |
| architect | `project` | `project` |
| coder | `project` | `project` |
| editor | `project` | `project` |

- [ ] **Step 2: Commit**

```bash
git add frontend/spaces/*/manifest.json
git commit -m "feat: update builtin space scopes to app/project"
```

---

## Task 4: Create org types

**Files:**
- Create: `frontend/types/org.ts`

- [ ] **Step 1: Define org types**

```typescript
export interface Organization {
  id: string
  name: string
  slug: string
  icon?: string
  createdAt: string
  ownerId: string
}

export interface OrgMember {
  id: string
  userId: string
  orgId: string
  name: string
  email: string
  role: 'owner' | 'admin' | 'member'
  status: 'active' | 'invited' | 'deactivated'
  joinedAt: string
  avatarUrl?: string
}

export interface OrgInvite {
  id: string
  orgId: string
  email: string
  role: 'admin' | 'member'
  invitedBy: string
  createdAt: string
  expiresAt: string
  status: 'pending' | 'accepted' | 'expired'
}

export interface OrgSettings {
  enabled: boolean
  orgId: string | null
  orgName: string | null
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/types/org.ts
git commit -m "feat: org types — Organization, OrgMember, OrgInvite, OrgSettings"
```

---

## Task 5: Create org store

**Files:**
- Create: `frontend/stores/org.ts`

- [ ] **Step 1: Create Pinia org store**

```typescript
import { defineStore } from 'pinia'
import type { Organization, OrgMember, OrgSettings } from '@/types/org'

const ORG_STORAGE_KEY = 'construct:org_settings'

export const useOrgStore = defineStore('org', () => {
  const settings = ref<OrgSettings>(loadSettings())
  const members = ref<OrgMember[]>([])
  const currentOrg = ref<Organization | null>(null)

  const isEnabled = computed(() => settings.value.enabled)
  const orgId = computed(() => settings.value.orgId)
  const orgName = computed(() => settings.value.orgName)

  function loadSettings(): OrgSettings {
    try {
      const raw = localStorage.getItem(ORG_STORAGE_KEY)
      if (raw) return JSON.parse(raw)
    } catch {}
    return { enabled: false, orgId: null, orgName: null }
  }

  function saveSettings() {
    localStorage.setItem(ORG_STORAGE_KEY, JSON.stringify(settings.value))
  }

  function enable(org: { id: string; name: string }) {
    settings.value = { enabled: true, orgId: org.id, orgName: org.name }
    saveSettings()
  }

  function disable() {
    settings.value = { enabled: false, orgId: null, orgName: null }
    members.value = []
    currentOrg.value = null
    saveSettings()
  }

  return {
    settings, members, currentOrg,
    isEnabled, orgId, orgName,
    enable, disable,
  }
})
```

- [ ] **Step 2: Commit**

```bash
git add frontend/stores/org.ts
git commit -m "feat: org Pinia store with enable/disable and localStorage persistence"
```

---

## Task 6: Wire org into space host context

**Files:**
- Modify: `frontend/lib/spaceHost.ts`

- [ ] **Step 1: Expose org context via SDK globals**

Add `useOrgContext` to the `window.__CONSTRUCT__` exports so spaces can access `orgId`:

```typescript
// In the space host init, add:
import { useOrgStore } from '@/stores/org'

// In the globals setup:
'@construct-space/sdk': {
  // ...existing exports...
  useOrgContext: () => {
    const org = useOrgStore()
    return {
      orgId: computed(() => org.orgId),
      orgName: computed(() => org.orgName),
      isOrgEnabled: computed(() => org.isEnabled),
    }
  },
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/lib/spaceHost.ts
git commit -m "feat: expose useOrgContext to spaces via SDK globals"
```

---

## Task 7: Update CLI scope enum

**Files:**
- Modify: `/Users/flakerim/Construct/packages/construct-cli/src/lib/manifest.ts`

- [ ] **Step 1: Update scope validation**

```typescript
export interface SpaceManifest {
  // ...
  scope: 'app' | 'project' | 'org' | 'any'
  // ...
}
```

Update the `validate` function:
```typescript
if (!['app', 'project', 'org', 'any'].includes(m.scope)) errors.push('scope: must be "app", "project", "org", or "any"')
```

- [ ] **Step 2: Build CLI**

```bash
cd /Users/flakerim/Construct/packages/construct-cli && bun run build
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/manifest.ts
git commit -m "feat: update CLI scope enum to app|project|org|any"
```

---

## Task 8: Add org settings panel

**Files:**
- Create: `frontend/pages/settings/OrgSettingsPanel.vue`
- Modify: `frontend/router/settingsNavigation.ts`

- [ ] **Step 1: Create OrgSettingsPanel.vue**

Simple panel with:
- Toggle to enable/disable org
- When enabling: input for org name, generates org_id
- When enabled: shows org name, member count, manage link
- Disable button with confirmation

- [ ] **Step 2: Add to settings navigation**

Add "Organization" tab to settings nav items.

- [ ] **Step 3: Commit**

```bash
git add frontend/pages/settings/OrgSettingsPanel.vue frontend/router/settingsNavigation.ts
git commit -m "feat: org settings panel — enable/disable organization"
```

---

## Task 9: Marketplace org badge

**Files:**
- Modify: `frontend/composables/useSpaceMarketplace.ts`

- [ ] **Step 1: Add org requirement detection**

When listing marketplace spaces, check if `scope === 'org'` and org is not enabled → show "Requires Organization" badge and disable install button.

- [ ] **Step 2: Commit**

```bash
git add frontend/composables/useSpaceMarketplace.ts
git commit -m "feat: marketplace shows 'Requires Organization' badge for org-scoped spaces"
```

---

## Task 10: Verification

- [ ] **Step 1: Run full test suite**

```bash
bun run test
```

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
```

- [ ] **Step 3: Run lint**

```bash
bun run lint
```

- [ ] **Step 4: Build operator** (verify no breakage)

```bash
bun run operator:build && bun run operator:test
```
