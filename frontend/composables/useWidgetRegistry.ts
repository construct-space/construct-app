/**
 * Widget Registry — discovers and catalogs widgets from installed spaces.
 *
 * Home dashboard has two zones:
 *   - Built-in strip (12×2): Fixed Construct widgets, not user-configurable
 *   - Space grid (12×8): User-customizable space widgets via picker
 *   - Total visible: 12×10
 */

import { ref } from 'vue'
import type { Component } from 'vue'
import { loadHomeLayout, saveHomeLayout } from '@/lib/widgetStorage'
import { BUILTIN_SPACE_IDS } from '@/space_loader/builtin'
import { DEVELOPER_ONLY_SPACES } from '@/space_loader/coreSpaces'
import { useDevMode } from '@/composables/useDevMode'

export function isBuiltinSpace(spaceId: string): boolean {
  return (BUILTIN_SPACE_IDS as readonly string[]).includes(spaceId)
}

interface ManifestWidget {
  id: string
  name: string
  description?: string
  icon?: string
  defaultSize: string
  sizes: string[] | Record<string, unknown>
}

interface WidgetManifest {
  id?: string
  widgets?: ManifestWidget[]
  requiresDeveloper?: boolean
}

export interface WidgetDefinition {
  id: string
  spaceId: string
  name: string
  description?: string
  icon?: string
  defaultSize: string
  sizes: string[] // e.g. ['2x1', '4x1', '4x2']
}

export interface WidgetPlacement {
  instanceId: string
  spaceId: string
  widgetId: string
  sizeKey: string
  x: number // column (0-based)
  y: number // row (0-based)
  w: number // width in columns
  h: number // height in rows
  config?: Record<string, unknown> // widget-specific settings (persisted with layout)
}

export interface HomeLayout {
  version: number
  items: WidgetPlacement[]
}

// Debounce window for save coalescing — drag/resize fires per cell, so a
// quick burst should produce a single trailing-edge write.
const SAVE_DEBOUNCE_MS = 250

// Grid dimensions
export const GRID_COLS = 12
export const BUILTIN_ROWS_BASE = 2  // Core built-in widgets (always shown)
export const BUILTIN_ROWS_DEV = 4   // With developer-only widgets
// SPACE_ROWS_VISIBLE is what the home page shows at rest — keeps the
// default layout from scrolling. In edit mode, the grid grows with its
// content plus an extra headroom so users can keep dropping widgets
// further down. SPACE_ROWS is a sanity bound for findPosition()'s loop
// so we never hunt forever for an empty slot on a wildly sparse layout.
export const SPACE_ROWS = 64
export const SPACE_ROWS_VISIBLE = 4

export function useWidgetRegistry() {
  const catalog = ref<WidgetDefinition[]>([])
  const layout = ref<HomeLayout>({ version: 1, items: [] })
  const loading = ref(false)
  const { isEnrolled } = useDevMode()

  // Load widget catalog from all installed spaces (for the space grid)
  async function loadCatalog() {
    loading.value = true
    const widgetsByKey = new Map<string, WidgetDefinition>()
    // Authoritative set of *installed* space ids (incl. dev-only ones hidden
    // from the catalog), used to prune home widgets for spaces that are gone.
    // Only trusted when the disk scan actually ran (installedSetKnown).
    const knownSpaceIds = new Set<string>()
    let installedSetKnown = false

    const addManifestWidgets = (spaceId: string, manifest: WidgetManifest) => {
      if (!Array.isArray(manifest.widgets)) return

      for (const w of manifest.widgets) {
        widgetsByKey.set(`${spaceId}:${w.id}`, {
          id: w.id,
          spaceId,
          name: w.name,
          description: w.description,
          icon: w.icon,
          defaultSize: w.defaultSize,
          sizes: typeof w.sizes === 'object' && !Array.isArray(w.sizes)
            ? Object.keys(w.sizes)
            : (w.sizes || []),
        })
      }
    }

    try {
      const { getLoadedSpaces } = await import('@/space_loader/SpaceLoader')
      const { getCoreSpaceManifests } = await import('@/space_loader/coreSpaces')
      const loaded = getLoadedSpaces()

      // Include core spaces that may not be loaded yet
      for (const coreManifest of getCoreSpaceManifests()) {
        knownSpaceIds.add(coreManifest.id)
        // Skip developer-only spaces when developer mode is inactive
        if (!isEnrolled.value && DEVELOPER_ONLY_SPACES.has(coreManifest.id)) continue
        if (!loaded.has(coreManifest.id)) addManifestWidgets(coreManifest.id, coreManifest as WidgetManifest)
      }

      for (const [spaceId, space] of loaded) {
        knownSpaceIds.add(spaceId)
        // Skip developer-only spaces when developer mode is inactive
        if (!isEnrolled.value && DEVELOPER_ONLY_SPACES.has(spaceId)) continue
        addManifestWidgets(spaceId, space.manifest as WidgetManifest)
      }

      // Also scan disk. Even when a space is already loaded, its in-memory
      // manifest can be stale after an external rebuild; the installed
      // manifest is the picker source of truth.
      try {
        const { homeDir } = await import('@tauri-apps/api/path')
        const { exists, readDir } = await import('@tauri-apps/plugin-fs')
        const home = await homeDir()
        const { getSpacesDirPath, getSpaceIdFromDirName } = await import('@/lib/appPaths')
        const { isSpaceBundleEntry } = await import('@/space_loader/spaceBundleResolver')
        const { createSpaceSource } = await import('@/space_loader/SpaceSource')
        const spacesDir = getSpacesDirPath(home)

        if (await exists(spacesDir)) {
          const entries = await readDir(spacesDir)
          for (const entry of entries) {
            if (!isSpaceBundleEntry(entry)) continue
            const spaceId = getSpaceIdFromDirName(entry.name)
            if (!spaceId) continue
            // Installed on disk — record before any dev-mode/manifest skip so
            // the prune step doesn't treat a hidden-but-installed space as gone.
            knownSpaceIds.add(spaceId)

            try {
              const src = await createSpaceSource(spaceId)
              if (!src || !(await src.entryExists('manifest.json'))) continue
              const raw = JSON.parse(await src.readText('manifest.json')) as WidgetManifest
              if (raw.id) knownSpaceIds.add(raw.id)
              // Skip developer-only spaces from disk when developer mode is inactive
              if (!isEnrolled.value && raw.requiresDeveloper) continue
              addManifestWidgets(raw.id || spaceId, raw)
            } catch { /* skip invalid manifests */ }
          }
        }
        // Reached here → the disk scan ran; the installed set is authoritative
        // (an empty spacesDir legitimately means "nothing installed").
        installedSetKnown = true
      } catch { /* not in Tauri — installed set stays untrusted */ }
    } catch (err) {
      console.warn('[WidgetRegistry] Failed to load catalog:', err)
    }

    catalog.value = [...widgetsByKey.values()]
    reconcileLayout(installedSetKnown ? knownSpaceIds : null)
    loading.value = false
  }

  // Rename map for spaces that changed id. Applied to persisted layouts
  // and pinned references so users who had the old space id on their home
  // grid don't see noisy "space not found" warnings after an upgrade.
  const SPACE_ID_RENAMES: Record<string, string> = {
    brainstorm: 'ask',
  }

  // Load saved layout from profile-scoped JSON file (Tauri) or
  // localStorage fallback (web dev). One-shot migration from the legacy
  // localStorage key happens inside loadHomeLayout().
  async function loadLayout() {
    layout.value = { version: 1, items: [] }
    try {
      const parsed = await loadHomeLayout()
      if (parsed && Array.isArray(parsed.items)) {
        let migrated = false
        for (const item of parsed.items) {
          const renamed = SPACE_ID_RENAMES[item.spaceId]
          if (renamed) {
            item.spaceId = renamed
            migrated = true
          }
        }
        layout.value = parsed
        if (migrated) saveLayout()
      }
    } catch {
      layout.value = { version: 1, items: [] }
    }
  }

  // Debounced save — coalesces drag/resize bursts into one trailing-edge
  // write. The in-memory layout is the source of truth for the session;
  // a write failure is logged but doesn't roll back.
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let saveInflight: Promise<void> = Promise.resolve()

  function saveLayout() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      const snapshot = JSON.parse(JSON.stringify(layout.value)) as HomeLayout
      // Serialize writes so a fast sequence can't race the file.
      saveInflight = saveInflight.then(() => saveHomeLayout(snapshot))
    }, SAVE_DEBOUNCE_MS)
  }

  // Reconcile size-key drift against the catalog. Placements whose
  // widget def isn't in the catalog yet are left **dormant** — they stay
  // in layout.items so we don't clobber persistence when a space's
  // catalog entry is temporarily missing (async manifest scan, dev-mode
  // toggle, transient load failure). The render path skips dormant
  // placements via getWidgetComponent → null.
  function reconcileLayout(knownSpaceIds?: Set<string> | null) {
    let changed = false

    // Prune placements whose space is genuinely uninstalled. Only when the
    // disk scan gave us an authoritative installed set — otherwise a transient
    // or non-Tauri scan miss would wrongly wipe the user's layout. Spaces that
    // are installed-but-hidden (dev-only, dev mode off) are in knownSpaceIds,
    // so they survive as dormant rather than being pruned.
    let working = layout.value.items
    if (knownSpaceIds) {
      const kept = working.filter(
        item => knownSpaceIds.has(item.spaceId) || isBuiltinSpace(item.spaceId),
      )
      if (kept.length !== working.length) {
        changed = true
        working = kept
      }
    }

    const items = working.map((item) => {
      const def = catalog.value.find(w => w.spaceId === item.spaceId && w.id === item.widgetId)
      if (!def) {
        // Keep as-is. Do NOT drop, do NOT mark changed.
        return item
      }

      const sizeKey = def.sizes.includes(item.sizeKey)
        ? item.sizeKey
        : (def.defaultSize || def.sizes[0])
      if (!sizeKey) {
        // Catalog entry exists but has no usable size — also dormant.
        return item
      }

      const { w, h } = parseSize(sizeKey)
      if (item.sizeKey !== sizeKey || item.w !== w || item.h !== h) {
        changed = true
      }

      return { ...item, sizeKey, w, h }
    })

    if (changed) {
      layout.value = { ...layout.value, items }
      saveLayout()
    }
  }

  // Parse size key like "4x2" into { w: 4, h: 2 }
  function parseSize(sizeKey: string): { w: number; h: number } {
    const [w, h] = sizeKey.split('x').map(Number)
    return { w: w || 1, h: h || 1 }
  }

  // Check if placement fits within the space grid (12×8) and doesn't overlap
  function canPlace(x: number, y: number, w: number, h: number, excludeId?: string): boolean {
    if (x < 0 || y < 0 || x + w > GRID_COLS || y + h > SPACE_ROWS) return false

    for (const item of layout.value.items) {
      if (excludeId && item.instanceId === excludeId) continue
      if (x < item.x + item.w && x + w > item.x &&
        y < item.y + item.h && y + h > item.y) {
        return false
      }
    }
    return true
  }

  // Find first available position for a widget in the space grid
  function findPosition(w: number, h: number): { x: number; y: number } | null {
    for (let y = 0; y <= SPACE_ROWS - h; y++) {
      for (let x = 0; x <= GRID_COLS - w; x++) {
        if (canPlace(x, y, w, h)) return { x, y }
      }
    }
    return null
  }

  // Add a widget to the space grid layout
  function addWidget(spaceId: string, widgetId: string, sizeKey: string): boolean {
    const { w, h } = parseSize(sizeKey)
    const pos = findPosition(w, h)
    if (!pos) return false

    layout.value.items.push({
      instanceId: `widget-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      spaceId,
      widgetId,
      sizeKey,
      x: pos.x,
      y: pos.y,
      w,
      h,
    })
    saveLayout()
    return true
  }

  // Remove a widget from the layout
  function removeWidget(instanceId: string) {
    layout.value.items = layout.value.items.filter(i => i.instanceId !== instanceId)
    saveLayout()
  }

  // Move a widget
  function moveWidget(instanceId: string, x: number, y: number): boolean {
    const item = layout.value.items.find(i => i.instanceId === instanceId)
    if (!item) return false
    if (!canPlace(x, y, item.w, item.h, instanceId)) return false
    item.x = x
    item.y = y
    saveLayout()
    return true
  }

  // Move and resize a widget in one operation
  function moveAndResize(instanceId: string, x: number, y: number, newSizeKey: string): boolean {
    const item = layout.value.items.find(i => i.instanceId === instanceId)
    if (!item) return false
    const { w, h } = parseSize(newSizeKey)
    if (!canPlace(x, y, w, h, instanceId)) return false
    item.x = x
    item.y = y
    item.w = w
    item.h = h
    item.sizeKey = newSizeKey
    saveLayout()
    return true
  }

  // Resize a widget to a different size variant
  function resizeWidget(instanceId: string, newSizeKey: string): boolean {
    const item = layout.value.items.find(i => i.instanceId === instanceId)
    if (!item) return false
    const { w, h } = parseSize(newSizeKey)
    // Check if the new size fits at the current position
    if (canPlace(item.x, item.y, w, h, instanceId)) {
      item.sizeKey = newSizeKey
      item.w = w
      item.h = h
      saveLayout()
      return true
    }
    // Try to find a new position
    const pos = findPosition(w, h)
    if (!pos) return false
    item.sizeKey = newSizeKey
    item.w = w
    item.h = h
    item.x = pos.x
    item.y = pos.y
    saveLayout()
    return true
  }

  // Swap two widgets' grid positions (checks both fit before swapping)
  function swapWidgets(idA: string, idB: string) {
    const a = layout.value.items.find(i => i.instanceId === idA)
    const b = layout.value.items.find(i => i.instanceId === idB)
    if (!a || !b) return

    // Check both fit at each other's positions (exclude both from collision)
    const excludeIds = new Set([idA, idB])
    const fitsAatB = a.x === b.x && a.y === b.y || (() => {
      if (b.x + a.w > GRID_COLS || b.y + a.h > SPACE_ROWS) return false
      for (const item of layout.value.items) {
        if (excludeIds.has(item.instanceId)) continue
        if (b.x < item.x + item.w && b.x + a.w > item.x &&
          b.y < item.y + item.h && b.y + a.h > item.y) return false
      }
      return true
    })()
    const fitsBatA = a.x === b.x && a.y === b.y || (() => {
      if (a.x + b.w > GRID_COLS || a.y + b.h > SPACE_ROWS) return false
      for (const item of layout.value.items) {
        if (excludeIds.has(item.instanceId)) continue
        if (a.x < item.x + item.w && a.x + b.w > item.x &&
          a.y < item.y + item.h && a.y + b.h > item.y) return false
      }
      return true
    })()

    if (!fitsAatB || !fitsBatA) return // can't swap, would overlap

    const [ax, ay] = [a.x, a.y]
    a.x = b.x; a.y = b.y
    b.x = ax; b.y = ay
    saveLayout()
  }

  // Get available sizes for a widget from the catalog
  function getWidgetSizes(spaceId: string, widgetId: string): string[] {
    const def = catalog.value.find(w => w.spaceId === spaceId && w.id === widgetId)
    return def?.sizes || []
  }

  // Get widget component from loaded space
  async function getWidgetComponent(spaceId: string, widgetId: string, sizeKey: string): Promise<Component | null> {
    try {
      const { loadSpace } = await import('@/space_loader/SpaceLoader')
      const space = await loadSpace(spaceId)
      if (!space) return null

      // Check loaded space widgets first (covers core spaces)
      if (space.widgets?.[widgetId]?.[sizeKey]) {
        return space.widgets[widgetId][sizeKey]
      }

      // Fallback: check window global (IIFE-loaded spaces)
      const spaceExport = (window as unknown as Record<string, Record<string, Record<string, Record<string, Component>>>>)[`__CONSTRUCT_SPACE_${spaceId.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}`]
      if (spaceExport?.widgets?.[widgetId]?.[sizeKey]) {
        return spaceExport.widgets[widgetId][sizeKey]
      }
      return null
    } catch {
      return null
    }
  }

  function updateWidgetConfig(instanceId: string, config: Record<string, unknown>) {
    const item = layout.value.items.find(i => i.instanceId === instanceId)
    if (item) {
      item.config = { ...item.config, ...config }
      saveLayout()
    }
  }

  function getWidgetConfig(instanceId: string): Record<string, unknown> {
    return layout.value.items.find(i => i.instanceId === instanceId)?.config || {}
  }

  return {
    catalog,
    layout,
    loading,
    loadCatalog,
    loadLayout,
    saveLayout,
    parseSize,
    canPlace,
    findPosition,
    addWidget,
    removeWidget,
    moveWidget,
    moveAndResize,
    resizeWidget,
    swapWidgets,
    getWidgetSizes,
    getWidgetComponent,
    updateWidgetConfig,
    getWidgetConfig,
    GRID_COLS,
    SPACE_ROWS,
    SPACE_ROWS_VISIBLE,
  }
}
