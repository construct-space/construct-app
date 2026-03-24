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
}

export interface HomeLayout {
  version: number
  items: WidgetPlacement[]
}

const LAYOUT_KEY = 'construct:home_layout'

// Grid dimensions
export const GRID_COLS = 12
export const BUILTIN_ROWS_BASE = 2  // Core built-in widgets (always shown)
export const BUILTIN_ROWS_DEV = 4   // With developer-only widgets
export const SPACE_ROWS = 8         // Customizable area for space widgets

export function useWidgetRegistry() {
  const catalog = ref<WidgetDefinition[]>([])
  const layout = ref<HomeLayout>({ version: 1, items: [] })
  const loading = ref(false)

  // Load widget catalog from all installed spaces (for the space grid)
  async function loadCatalog() {
    loading.value = true
    const widgets: WidgetDefinition[] = []

    try {
      const { getLoadedSpaces } = await import('@/space_loader/SpaceLoader')
      const { getCoreSpaceManifests } = await import('@/space_loader/coreSpaces')
      const loaded = getLoadedSpaces()

      // Include core spaces that may not be loaded yet
      for (const coreManifest of getCoreSpaceManifests()) {
        if (!loaded.has(coreManifest.id) && coreManifest.widgets) {
          for (const w of coreManifest.widgets as any[]) {
            widgets.push({
              id: w.id,
              spaceId: coreManifest.id,
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
      }

      for (const [spaceId, space] of loaded) {
        if (space.manifest.widgets) {
          for (const w of space.manifest.widgets as any[]) {
            widgets.push({
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
      }

      // Also scan disk for spaces not yet loaded
      try {
        const { homeDir } = await import('@tauri-apps/api/path')
        const { readTextFile, exists, readDir } = await import('@tauri-apps/plugin-fs')
        const home = await homeDir()
        const { getSpacesDirPath } = await import('@/lib/appPaths')
        const spacesDir = getSpacesDirPath(home)

        if (await exists(spacesDir)) {
          const entries = await readDir(spacesDir)
          for (const entry of entries) {
            if (!entry.isDirectory) continue
            const spaceId = entry.name
            if (loaded.has(spaceId)) continue

            const manifestPath = `${spacesDir}/${spaceId}/manifest.json`
            if (!(await exists(manifestPath))) continue

            try {
              const raw = JSON.parse(await readTextFile(manifestPath))
              if (raw.widgets && Array.isArray(raw.widgets)) {
                for (const w of raw.widgets) {
                  widgets.push({
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
            } catch { /* skip invalid manifests */ }
          }
        }
      } catch { /* not in Tauri */ }
    } catch (err) {
      console.warn('[WidgetRegistry] Failed to load catalog:', err)
    }

    catalog.value = widgets
    loading.value = false
  }

  // Load saved layout from localStorage
  function loadLayout() {
    try {
      const stored = localStorage.getItem(LAYOUT_KEY)
      if (stored) {
        layout.value = JSON.parse(stored)
      }
    } catch {
      layout.value = { version: 1, items: [] }
    }
  }

  // Save layout to localStorage
  function saveLayout() {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout.value))
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
      const spaceExport = (window as any)[`__CONSTRUCT_SPACE_${spaceId.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}`]
      if (spaceExport?.widgets?.[widgetId]?.[sizeKey]) {
        return spaceExport.widgets[widgetId][sizeKey]
      }
      return null
    } catch {
      return null
    }
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
    resizeWidget,
    swapWidgets,
    getWidgetSizes,
    getWidgetComponent,
    GRID_COLS,
    SPACE_ROWS,
  }
}
