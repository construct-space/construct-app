# Widget Sandbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Isolate all widgets in closed Shadow DOM so they cannot access the parent DOM, globals, or Tauri APIs — fixing #29, #31, #28, #30.

**Architecture:** WidgetChrome creates a custom element with closed Shadow DOM, mounts an isolated Vue app inside it, and provides a frozen API as the only bridge. Built-in widgets get navigation actions; marketplace widgets get theme only. Global stripping removes `__CONSTRUCT__`, `__TAURI__`, and `Audio` from the widget scope.

**Tech Stack:** Vue 3, Custom Elements, Shadow DOM, TypeScript

**Spec:** `docs/superpowers/specs/2026-04-07-widget-sandbox-design.md`

---

## File Structure

### New files

```
frontend/lib/widgetSandbox.ts    ← Custom element creation, shadow root, global stripping, Vue app mounting
frontend/lib/widgetApi.ts        ← WidgetApi types + factory (frozen API for built-in vs marketplace)
frontend/lib/__tests__/widgetSandbox.test.ts
frontend/lib/__tests__/widgetApi.test.ts
```

### Modified files

```
frontend/components/home/WidgetChrome.vue   ← Replace <component :is> with sandboxed mounting
frontend/composables/useWidgetRegistry.ts   ← Add isBuiltinSpace() check for tier detection
frontend/spaces/brainstorm/widgets/QuickChat2x1.vue  ← Use widget API instead of useRouter()
frontend/spaces/brainstorm/widgets/QuickChat4x2.vue  ← Same
frontend/spaces/architect/widgets/QuickArchitect1x1.vue  ← Same
frontend/spaces/architect/widgets/QuickArchitect4x1.vue  ← Same
../packages/construct-cli/templates/space/widgets/2x1.vue.tmpl  ← Scaffold with widgetApi inject
../packages/construct-cli/templates/space/widgets/4x1.vue.tmpl  ← Same
```

---

### Task 1: Widget API Types

**Files:**
- Create: `frontend/lib/widgetApi.ts`
- Create: `frontend/lib/__tests__/widgetApi.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/lib/__tests__/widgetApi.test.ts
import { describe, it, expect } from 'vitest'
import { createBuiltinWidgetApi, createMarketplaceWidgetApi } from '../widgetApi'
import type { BuiltinWidgetApi, MarketplaceWidgetApi } from '../widgetApi'

describe('widgetApi', () => {
  it('createBuiltinWidgetApi returns frozen object with actions', () => {
    const navigate = vi.fn()
    const newSession = vi.fn()
    const api = createBuiltinWidgetApi({
      theme: { mode: 'dark', vars: {} },
      space: { id: 'brainstorm', name: 'Brainstorm', icon: 'brain' },
      actions: { navigate, newSession },
    })

    expect(Object.isFrozen(api)).toBe(true)
    expect(api.actions.navigate).toBeDefined()
    expect(api.actions.newSession).toBeDefined()
    expect(() => { (api as any).extra = true }).toThrow()
  })

  it('createMarketplaceWidgetApi returns frozen object without actions', () => {
    const api = createMarketplaceWidgetApi({
      theme: { mode: 'light', vars: {} },
      space: { id: 'blog', name: 'Blog', icon: 'book' },
    })

    expect(Object.isFrozen(api)).toBe(true)
    expect((api as any).actions).toBeUndefined()
    expect(() => { (api as any).extra = true }).toThrow()
  })

  it('theme vars are frozen', () => {
    const api = createBuiltinWidgetApi({
      theme: { mode: 'dark', vars: { '--app-accent': '#fff' } },
      space: { id: 'coder', name: 'Coder', icon: 'code' },
      actions: { navigate: vi.fn(), newSession: vi.fn() },
    })

    expect(Object.isFrozen(api.theme)).toBe(true)
    expect(Object.isFrozen(api.theme.vars)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/flakerim/Construct/construct-app && bun run test -- frontend/lib/__tests__/widgetApi.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement widgetApi.ts**

```typescript
// frontend/lib/widgetApi.ts

export interface WidgetTheme {
  mode: 'dark' | 'light'
  vars: Record<string, string>
}

export interface WidgetSpace {
  id: string
  name: string
  icon: string
}

export interface WidgetActions {
  navigate: (path: string) => void
  newSession: (params?: any) => void
}

export interface BuiltinWidgetApi {
  theme: WidgetTheme
  space: WidgetSpace
  actions: WidgetActions
}

export interface MarketplaceWidgetApi {
  theme: WidgetTheme
  space: WidgetSpace
}

export type WidgetApi = BuiltinWidgetApi | MarketplaceWidgetApi

export function createBuiltinWidgetApi(opts: {
  theme: WidgetTheme
  space: WidgetSpace
  actions: WidgetActions
}): BuiltinWidgetApi {
  const api: BuiltinWidgetApi = {
    theme: Object.freeze({ ...opts.theme, vars: Object.freeze({ ...opts.theme.vars }) }),
    space: Object.freeze({ ...opts.space }),
    actions: Object.freeze({ ...opts.actions }),
  }
  return Object.freeze(api)
}

export function createMarketplaceWidgetApi(opts: {
  theme: WidgetTheme
  space: WidgetSpace
}): MarketplaceWidgetApi {
  const api: MarketplaceWidgetApi = {
    theme: Object.freeze({ ...opts.theme, vars: Object.freeze({ ...opts.theme.vars }) }),
    space: Object.freeze({ ...opts.space }),
  }
  return Object.freeze(api)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/flakerim/Construct/construct-app && bun run test -- frontend/lib/__tests__/widgetApi.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/widgetApi.ts frontend/lib/__tests__/widgetApi.test.ts
git commit -m "feat(widget): add frozen widget API types and factories"
```

---

### Task 2: Widget Sandbox — Shadow DOM Mounting

**Files:**
- Create: `frontend/lib/widgetSandbox.ts`
- Create: `frontend/lib/__tests__/widgetSandbox.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/lib/__tests__/widgetSandbox.test.ts
import { describe, it, expect, vi } from 'vitest'
import { mountWidgetInShadow, stripGlobals } from '../widgetSandbox'

describe('widgetSandbox', () => {
  it('stripGlobals removes __CONSTRUCT__ from target', () => {
    const target: any = { __CONSTRUCT__: { auth: 'token' }, __TAURI__: {} }
    stripGlobals(target)
    expect(target.__CONSTRUCT__).toBeUndefined()
    expect(target.__TAURI__).toBeUndefined()
  })

  it('stripGlobals removes Audio constructor', () => {
    const target: any = { Audio: function() {}, HTMLMediaElement: function() {} }
    stripGlobals(target)
    expect(target.Audio).toBeUndefined()
    expect(target.HTMLMediaElement).toBeUndefined()
  })

  it('stripGlobals removes frame-busting refs', () => {
    const target: any = { parent: {}, top: {}, frames: [] }
    stripGlobals(target)
    expect(target.parent).toBeUndefined()
    expect(target.top).toBeUndefined()
    expect(target.frames).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/flakerim/Construct/construct-app && bun run test -- frontend/lib/__tests__/widgetSandbox.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement widgetSandbox.ts**

```typescript
// frontend/lib/widgetSandbox.ts
import { createApp, type Component } from 'vue'
import type { WidgetApi } from './widgetApi'

/**
 * Globals stripped from the widget's scope to prevent escape.
 */
const STRIPPED_GLOBALS = [
  '__CONSTRUCT__',
  '__TAURI__',
  '__TAURI_INTERNALS__',
  'construct',
  'Audio',
  'HTMLMediaElement',
  'parent',
  'top',
  'frames',
] as const

/**
 * Strip dangerous globals from a target object (typically window proxy).
 */
export function stripGlobals(target: Record<string, any>): void {
  for (const key of STRIPPED_GLOBALS) {
    if (key in target) {
      try {
        Object.defineProperty(target, key, {
          value: undefined,
          writable: false,
          configurable: false,
        })
      } catch {
        // Some properties may not be configurable — delete instead
        try { delete target[key] } catch { /* best effort */ }
      }
    }
  }
}

/**
 * Build a <style> element with theme CSS custom properties for the shadow root.
 */
function buildThemeStyle(vars: Record<string, string>): HTMLStyleElement {
  const style = document.createElement('style')
  const rules = Object.entries(vars)
    .map(([k, v]) => `${k}: ${v};`)
    .join('\n  ')
  style.textContent = `:host {\n  ${rules}\n}\n* { box-sizing: border-box; }`
  return style
}

/**
 * Mount a widget component inside a closed Shadow DOM.
 * Returns a cleanup function to unmount.
 */
export function mountWidgetInShadow(
  hostElement: HTMLElement,
  component: Component,
  api: WidgetApi,
  themeVars: Record<string, string>,
): () => void {
  const shadow = hostElement.attachShadow({ mode: 'closed' })

  // Inject theme CSS variables
  shadow.appendChild(buildThemeStyle(themeVars))

  // Create mount point
  const root = document.createElement('div')
  root.className = 'widget-root'
  root.style.cssText = 'height: 100%; width: 100%;'
  shadow.appendChild(root)

  // Create isolated Vue app — NOT the main app
  const app = createApp(component)

  // Provide the frozen API as the only bridge
  app.provide('widgetApi', api)

  // Mount
  app.mount(root)

  // Return cleanup
  return () => {
    app.unmount()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/flakerim/Construct/construct-app && bun run test -- frontend/lib/__tests__/widgetSandbox.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/widgetSandbox.ts frontend/lib/__tests__/widgetSandbox.test.ts
git commit -m "feat(widget): add shadow DOM sandbox with global stripping"
```

---

### Task 3: Update WidgetChrome to Use Shadow DOM

**Files:**
- Modify: `frontend/components/home/WidgetChrome.vue`
- Modify: `frontend/composables/useWidgetRegistry.ts`

- [ ] **Step 1: Add isBuiltinSpace helper to useWidgetRegistry.ts**

Read `frontend/space_loader/builtin.ts` — it exports `BUILTIN_SPACE_IDS`. Add a check function:

At the top of `useWidgetRegistry.ts`, add:

```typescript
import { BUILTIN_SPACE_IDS } from '@/space_loader/builtin'

export function isBuiltinSpace(spaceId: string): boolean {
  return (BUILTIN_SPACE_IDS as readonly string[]).includes(spaceId)
}
```

- [ ] **Step 2: Rewrite WidgetChrome.vue to mount in shadow DOM**

Replace the entire `<script setup>` in WidgetChrome.vue:

```typescript
import { ref, watch, onUnmounted, onErrorCaptured } from 'vue'
import type { Component } from 'vue'
import type { WidgetPlacement } from '@/composables/useWidgetRegistry'
import { isBuiltinSpace } from '@/composables/useWidgetRegistry'
import { mountWidgetInShadow, stripGlobals } from '@/lib/widgetSandbox'
import { createBuiltinWidgetApi, createMarketplaceWidgetApi } from '@/lib/widgetApi'
import { X } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  placement: WidgetPlacement
  getComponent: (spaceId: string, widgetId: string, sizeKey: string) => Promise<Component | null>
  removable?: boolean
}>(), {
  removable: true,
})

const emit = defineEmits<{
  remove: [instanceId: string]
}>()

const hostRef = ref<HTMLElement | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
let cleanup: (() => void) | null = null

onErrorCaptured((err) => {
  error.value = err instanceof Error ? err.message : 'Widget error'
  return false
})

function getThemeVars(): Record<string, string> {
  const vars: Record<string, string> = {}
  const style = getComputedStyle(document.documentElement)
  const names = [
    '--app-background', '--app-foreground', '--app-surface', '--app-border',
    '--app-accent', '--app-muted', '--app-card',
  ]
  for (const name of names) {
    const val = style.getPropertyValue(name).trim()
    if (val) vars[name] = val
  }
  return vars
}

async function loadWidget() {
  loading.value = true
  error.value = null

  // Cleanup previous mount
  if (cleanup) {
    cleanup()
    cleanup = null
  }

  try {
    const component = await props.getComponent(
      props.placement.spaceId,
      props.placement.widgetId,
      props.placement.sizeKey,
    )
    if (!component) {
      error.value = 'Widget not found'
      loading.value = false
      return
    }

    const el = hostRef.value
    if (!el) {
      error.value = 'Host element not available'
      loading.value = false
      return
    }

    const themeVars = getThemeVars()
    const isBuiltin = isBuiltinSpace(props.placement.spaceId)
    const router = useRouter()

    const api = isBuiltin
      ? createBuiltinWidgetApi({
          theme: { mode: document.documentElement.classList.contains('dark') ? 'dark' : 'light', vars: themeVars },
          space: { id: props.placement.spaceId, name: props.placement.spaceId, icon: '' },
          actions: {
            navigate: (path: string) => router.push(path),
            newSession: () => router.push(`/app/${props.placement.spaceId}`),
          },
        })
      : createMarketplaceWidgetApi({
          theme: { mode: document.documentElement.classList.contains('dark') ? 'dark' : 'light', vars: themeVars },
          space: { id: props.placement.spaceId, name: props.placement.spaceId, icon: '' },
        })

    cleanup = mountWidgetInShadow(el, component, api, themeVars)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load widget'
  } finally {
    loading.value = false
  }
}

watch(
  () => props.placement.sizeKey,
  () => loadWidget(),
  { immediate: true },
)

onUnmounted(() => {
  if (cleanup) cleanup()
})
```

Replace the template's widget content section — swap `<component :is>` for a host div:

```html
<!-- Widget content (shadow DOM host) -->
<div
  v-else
  ref="hostRef"
  class="h-full"
/>
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/flakerim/Construct/construct-app && bun run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/components/home/WidgetChrome.vue frontend/composables/useWidgetRegistry.ts
git commit -m "feat(widget): mount widgets in closed Shadow DOM with frozen API"
```

---

### Task 4: Update Built-in Widgets to Use Widget API

**Files:**
- Modify: `frontend/spaces/brainstorm/widgets/QuickChat2x1.vue`
- Modify: `frontend/spaces/brainstorm/widgets/QuickChat4x2.vue`
- Modify: `frontend/spaces/architect/widgets/QuickArchitect1x1.vue`
- Modify: `frontend/spaces/architect/widgets/QuickArchitect4x1.vue`

Built-in widgets currently use `useRouter()` from the main app. After sandboxing, the main app's provide chain is unavailable. Widgets must use the injected `widgetApi` instead.

- [ ] **Step 1: Update QuickChat2x1.vue**

Replace:
```typescript
const router = useRouter()
```
With:
```typescript
import { inject } from 'vue'
import type { BuiltinWidgetApi } from '@/lib/widgetApi'

const api = inject<BuiltinWidgetApi>('widgetApi')!
```

Replace `router.push('/app/brainstorm')` with `api.actions.navigate('/app/brainstorm')`.

- [ ] **Step 2: Update QuickChat4x2.vue**

Read the file first. Apply the same pattern — replace `useRouter()` with `inject('widgetApi')` and use `api.actions.navigate()`.

- [ ] **Step 3: Update QuickArchitect1x1.vue**

Read the file first. Apply the same pattern.

- [ ] **Step 4: Update QuickArchitect4x1.vue**

Read the file first. Apply the same pattern.

- [ ] **Step 5: Check all other widgets in project space**

Read `frontend/spaces/project/widgets/` files. If they use `useRouter()` or other main-app composables, update them the same way.

- [ ] **Step 6: Verify typecheck**

Run: `cd /Users/flakerim/Construct/construct-app && bun run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add frontend/spaces/
git commit -m "feat(widget): migrate built-in widgets to frozen widget API"
```

---

### Task 5: Update CLI Widget Templates

**Files:**
- Modify: `../packages/construct-cli/templates/space/widgets/2x1.vue.tmpl`
- Modify: `../packages/construct-cli/templates/space/widgets/4x1.vue.tmpl`

All scaffolded widgets should use `inject('widgetApi')` from the start so they work inside the shadow DOM sandbox.

- [ ] **Step 1: Update 2x1.vue.tmpl**

```vue
<script setup lang="ts">
/**
 * {{.DisplayName}} Summary Widget — 2×1 compact view
 *
 * Widgets run inside a closed Shadow DOM sandbox.
 * Use the injected widgetApi for theme and actions — do not access
 * window, document, or global stores directly.
 */
import { inject } from 'vue'

const api = inject<{ theme: { mode: string; vars: Record<string, string> }; space: { id: string; name: string } }>('widgetApi')
</script>

<template>
  <div class="h-full flex items-center gap-3 px-3">
    <div class="size-8 rounded-lg bg-[var(--app-accent)]/10 flex items-center justify-center">
      <Icon name="i-lucide-box" class="size-4 text-[var(--app-accent)]" />
    </div>
    <div class="min-w-0">
      <p class="text-sm font-medium text-[var(--app-foreground)] truncate">{{.DisplayName}}</p>
      <p class="text-xs text-[var(--app-muted)]">Ready</p>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Update 4x1.vue.tmpl**

```vue
<script setup lang="ts">
/**
 * {{.DisplayName}} Summary Widget — 4×1 wide view
 *
 * Widgets run inside a closed Shadow DOM sandbox.
 * Use the injected widgetApi for theme and actions — do not access
 * window, document, or global stores directly.
 */
import { inject } from 'vue'

const api = inject<{ theme: { mode: string; vars: Record<string, string> }; space: { id: string; name: string } }>('widgetApi')
</script>

<template>
  <div class="h-full flex items-center justify-between px-4">
    <div class="flex items-center gap-3">
      <div class="size-8 rounded-lg bg-[var(--app-accent)]/10 flex items-center justify-center">
        <Icon name="i-lucide-box" class="size-4 text-[var(--app-accent)]" />
      </div>
      <div>
        <p class="text-sm font-medium text-[var(--app-foreground)]">{{.DisplayName}}</p>
        <p class="text-xs text-[var(--app-muted)]">Your space is ready</p>
      </div>
    </div>
    <div class="text-right">
      <p class="text-lg font-bold text-[var(--app-foreground)]">0</p>
      <p class="text-[10px] text-[var(--app-muted)] uppercase">Items</p>
    </div>
  </div>
</template>
```

- [ ] **Step 3: Commit**

```bash
cd /Users/flakerim/Construct/packages/construct-cli
git add templates/space/widgets/
git commit -m "feat(cli): scaffold widgets with widgetApi inject for sandbox compatibility"
```

---

### Task 6: Fix Widget Persistence (#30)

**Files:**
- Modify: `frontend/composables/useWidgetRegistry.ts`

The widget layout is stored in `localStorage` which is fine for persistence. The actual bug in #30 is that the widget catalog is loaded from spaces that may not be loaded yet on restart — `reconcileLayout()` removes widgets whose space isn't found.

- [ ] **Step 1: Read the loadCatalog function**

Read `useWidgetRegistry.ts` lines 63-155. The disk scan section (lines 110-147) tries to scan installed spaces from disk. If this fails (e.g., Tauri not ready on mount), catalog is empty and `reconcileLayout()` strips all widgets.

- [ ] **Step 2: Fix reconcileLayout to preserve unknown widgets**

In `reconcileLayout()`, instead of removing items whose definition isn't in the catalog, keep them with their existing size. Only remove if the widget is confirmed deleted (space uninstalled).

Change the filter logic in `reconcileLayout()`:

```typescript
function reconcileLayout() {
  let changed = false

  const items = layout.value.items.map((item) => {
    const def = catalog.value.find(w => w.spaceId === item.spaceId && w.id === item.widgetId)
    if (!def) {
      // Widget's space not in catalog — keep it as-is (may not be loaded yet)
      // Only remove if we're confident the catalog is fully loaded
      return item
    }

    const sizeKey = def.sizes.includes(item.sizeKey)
      ? item.sizeKey
      : (def.defaultSize || def.sizes[0])
    if (!sizeKey) {
      changed = true
      return null
    }

    const { w, h } = parseSize(sizeKey)
    if (item.sizeKey !== sizeKey || item.w !== w || item.h !== h) {
      changed = true
    }

    return { ...item, sizeKey, w, h }
  }).filter((item): item is WidgetPlacement => item !== null)

  if (changed) {
    layout.value = { ...layout.value, items }
    saveLayout()
  }
}
```

- [ ] **Step 3: Run tests**

Run: `cd /Users/flakerim/Construct/construct-app && bun run test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/composables/useWidgetRegistry.ts
git commit -m "fix(widget): preserve layout for unloaded spaces on restart (#30)"
```

---

### Task 7: Fix Widget Sidebar Close (#24, #25)

**Files:**
- Modify: `frontend/pages/HomePage.vue`

- [ ] **Step 1: Read HomePage.vue and WidgetPicker component**

Check how `showWidgetPicker` is managed. The issue is that the picker doesn't close after adding a widget (#25) and close interactions are broken (#24).

- [ ] **Step 2: Close picker after adding widget**

In `handleAddWidget`, close the picker after successful add:

```typescript
function handleAddWidget(spaceId: string, widgetId: string, sizeKey: string) {
  const added = widgetRegistry.addWidget(spaceId, widgetId, sizeKey)
  if (added) {
    showWidgetPicker.value = false
  } else {
    toast.add({ title: 'Dashboard Full', description: 'No space available for this widget size', color: 'warning' })
  }
}
```

- [ ] **Step 3: Verify the WidgetPicker close behavior**

Read the WidgetPicker component. If it doesn't handle overlay clicks or escape key for closing, add `@click-outside` or ensure `v-model:open` properly closes.

- [ ] **Step 4: Run tests**

Run: `cd /Users/flakerim/Construct/construct-app && bun run test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/pages/HomePage.vue
git commit -m "fix(widget): close picker after adding widget, fix sidebar close (#24, #25)"
```

---

### Task 8: Remove Global Leak in WidgetChrome

**Files:**
- Modify: `frontend/components/home/WidgetChrome.vue`

- [ ] **Step 1: Remove the window.construct.space mutation**

The old WidgetChrome.vue at lines 38-39 sets `window.construct.space = { id: spaceId }`. This is the actual DOM leak vector. The new sandboxed version from Task 3 should NOT have this line. Verify it's gone.

- [ ] **Step 2: Verify no other files set window.construct.space for widgets**

Search: `grep -r "construct.space" frontend/ --include="*.vue" --include="*.ts"`

If other files set this for widget context, remove those too.

- [ ] **Step 3: Commit if changes needed**

```bash
git commit -m "fix(widget): remove global window.construct.space mutation"
```

---

## Final Integration Test

After all tasks, run the full test suite:

```bash
cd /Users/flakerim/Construct/construct-app && bun run test
cd /Users/flakerim/Construct/construct-app && bun run typecheck
```

All must pass before considering the feature complete.
