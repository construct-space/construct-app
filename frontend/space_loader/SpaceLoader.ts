/**
 * SpaceLoader — Runtime loader for pre-built space IIFE bundles.
 *
 * All spaces are loaded from the active app spaces directory via Tauri FS.
 * In dev mode, if VITE_SPACE_DEV_DIR is set, that directory is also
 * checked (for `construct space dev` linking).
 *
 * Flow:
 *   1. Read manifest.json from space directory via Tauri FS
 *   2. Read the .iife.js bundle
 *   3. Execute via new Function() — IIFE assigns to window.__CONSTRUCT_SPACE_{id}
 *   4. Extract page components from the global
 *   5. Inject CSS via <style data-space="{id}">
 *   6. Cache in memory Map
 */

import type { Component } from 'vue'
import { getSpaceDirPath, IS_DEV_INSTANCE } from '@/lib/appPaths'
import type { SpaceContextMenuConfig } from '@/lib/contextMenuTypes'
import { getCoreSpace, isCoreSpace } from './coreSpaces'
import { registerAutomationProvider } from '@/lib/spaceContextBus'
import type { AutomationProvider, AutomationAction, ActionResult } from '@/types/automation'

export interface LoadedSpace {
  id: string
  manifest: SpaceManifest
  pages: Record<string, Component>
  widgets?: Record<string, Record<string, Component>> // widgetId -> sizeKey -> Component
  components?: Record<string, Component>
  cssInjected: boolean
}

export interface SpaceManifest {
  id: string
  name: string
  version: string
  description: string
  icon: string
  scope: string
  navigation: {
    label: string
    icon: string
    to: string
    order: number
  }
  pages: Array<{
    path: string
    label: string
    icon?: string
    default?: boolean
    requiresContext?: boolean
    toolbar?: Array<{
      id: string
      icon: string
      label: string
      action?: string
      to?: string
    }>
  }>
  toolbar?: Array<{
    id: string
    icon: string
    label: string
    action?: string
    to?: string
  }>
  widgets?: Array<{
    id: string
    name: string
    description?: string
    icon?: string
    defaultSize: string
    sizes: Record<string, string> | string[]
  }>
  contextMenus?: SpaceContextMenuConfig
  theme?: {
    color: string
    bg: string
  }
  recommended?: boolean
  agent?: string
  skills?: string[]
  build?: {
    checksum: string
    size: number
    hostApiVersion: string
    builtAt: string
  }
}

/** In-memory cache of loaded space bundles */
const loadedSpaces = new Map<string, LoadedSpace>()

/**
 * Convert a space ID to the global variable name used by the IIFE bundle.
 * Must match the CLI build: replaces non-alphanumeric chars with underscores
 * and uppercases to produce a valid, deterministic JS identifier.
 */
function toGlobalKey(spaceId: string): string {
  const safeId = spaceId.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()
  return `__CONSTRUCT_SPACE_${safeId}`
}

/** Ensure space host globals are available (initialized eagerly in main.ts) */
async function ensureSpaceHost(): Promise<void> {
  if (!window.__CONSTRUCT__) {
    // Fallback: if somehow called before main.ts initialization
    const { initSpaceHost } = await import('@/lib/spaceHost')
    initSpaceHost()
  }
}

/** Compute SHA-256 hex digest of a string */
async function sha256Hex(content: string): Promise<string> {
  const data = new TextEncoder().encode(content)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')
}

/** Optional dev override directory from env */
const devOverrideDir = import.meta.env.VITE_SPACE_DEV_DIR || ''

/**
 * Load a space by ID. Returns cached version if already loaded.
 */
export async function loadSpace(spaceId: string): Promise<LoadedSpace | null> {
  // Return from cache
  if (loadedSpaces.has(spaceId)) {
    return loadedSpaces.get(spaceId)!
  }

  // Core spaces ship with the app — no disk/IIFE needed
  const coreSpace = getCoreSpace(spaceId)
  if (coreSpace) {
    loadedSpaces.set(spaceId, coreSpace)
    return coreSpace
  }

  // If dev override dir is set, try that first
  if (devOverrideDir) {
    const devSpace = await loadSpaceFromDir(spaceId, devOverrideDir)
    if (devSpace) {
      loadedSpaces.set(spaceId, devSpace)
      return devSpace
    }
  }

  // Load from the installed spaces directory.
  const prodSpace = await loadSpaceFromDisk(spaceId)
  if (prodSpace) {
    loadedSpaces.set(spaceId, prodSpace)
    return prodSpace
  }

  console.warn(`[SpaceLoader] "${spaceId}" → not found`)
  return null
}

/**
 * Load pre-built IIFE bundle from the active app spaces directory.
 */
async function loadSpaceFromDisk(spaceId: string): Promise<LoadedSpace | null> {
  try {
    const { homeDir } = await import('@tauri-apps/api/path')
    const home = await homeDir()
    const spaceDir = getSpaceDirPath(home, spaceId)
    return await loadSpaceFromDir(spaceId, spaceDir)
  } catch (err) {
    console.error(`[SpaceLoader] Failed to load space "${spaceId}" from disk:`, err)
    return null
  }
}

/**
 * Load a space from an arbitrary directory path.
 */
async function loadSpaceFromDir(spaceId: string, baseDir: string): Promise<LoadedSpace | null> {
  try {
    const { readTextFile, exists } = await import('@tauri-apps/plugin-fs')

    const spaceDir = baseDir.endsWith(`/${spaceId}`) ? baseDir : `${baseDir}/${spaceId}`

    // Read manifest
    const manifestPath = `${spaceDir}/manifest.json`
    if (!(await exists(manifestPath))) {
      return null
    }
    const manifestJson = await readTextFile(manifestPath)
    const manifest: SpaceManifest = JSON.parse(manifestJson)

    // Read JS bundle
    const bundlePath = `${spaceDir}/space-${spaceId}.iife.js`
    if (!(await exists(bundlePath))) {
      return null
    }
    const jsContent = await readTextFile(bundlePath)

    // Verify bundle integrity against manifest checksum
    if (manifest.build?.checksum) {
      const actual = await sha256Hex(jsContent)
      if (actual !== manifest.build.checksum) {
        console.error(`[SpaceLoader] Checksum mismatch for "${spaceId}": expected ${manifest.build.checksum}, got ${actual}`)
        return null
      }
    }

    // Ensure host globals are ready before executing space code
    await ensureSpaceHost()

    // Set current space context for SDK composables
    if ((window as any).construct) {
      (window as any).construct.space = { id: spaceId }
    }

    // Execute IIFE — sets window.__CONSTRUCT_SPACE_{id}
    // Indirect eval runs in global scope so `var` creates a window property
    ;(0, eval)(jsContent)

    // Extract the space export
    const globalKey = toGlobalKey(spaceId)
    const spaceExport = (window as any)[globalKey]
    if (!spaceExport?.pages) {
      console.warn(`[SpaceLoader] Space "${spaceId}" bundle did not export pages`)
      return null
    }

    // Call space init hook if provided
    if (typeof spaceExport.init === 'function') {
      try { spaceExport.init() } catch (e) {
        console.warn(`[SpaceLoader] Space "${spaceId}" init error:`, e)
      }
    }

    // Auto-register actions as automation provider
    if (spaceExport.actions && typeof spaceExport.actions === 'object') {
      registerSpaceActions(spaceId, spaceExport.actions)
    }

    // Inject CSS if present
    let cssInjected = false
    const cssPath = `${spaceDir}/space-${spaceId}.css`
    if (await exists(cssPath)) {
      const cssContent = await readTextFile(cssPath)
      injectCSS(spaceId, cssContent)
      cssInjected = true
    }

    const widgets = spaceExport.widgets as Record<string, Record<string, Component>> | undefined

    return {
      id: spaceId,
      manifest,
      pages: spaceExport.pages as Record<string, Component>,
      widgets,
      components: spaceExport.components as Record<string, Component> | undefined,
      cssInjected,
    }
  } catch (err) {
    console.error(`[SpaceLoader] Failed to load space "${spaceId}" from dir:`, err)
    return null
  }
}

/**
 * Inject CSS into the document for a space.
 */
function injectCSS(spaceId: string, css: string): void {
  // Remove existing style if re-loading
  const existing = document.querySelector(`style[data-space="${spaceId}"]`)
  if (existing) {
    existing.remove()
  }

  const style = document.createElement('style')
  style.setAttribute('data-space', spaceId)
  style.textContent = css
  document.head.appendChild(style)
}

/**
 * Unload a space — remove CSS, clean up globals, clear cache.
 */
export function unloadSpace(spaceId: string): void {
  // Remove CSS
  const style = document.querySelector(`style[data-space="${spaceId}"]`)
  if (style) {
    style.remove()
  }

  // Clean up global (core spaces have no window global)
  if (!isCoreSpace(spaceId)) {
    const globalKey = toGlobalKey(spaceId)
    delete (window as any)[globalKey]
  }

  // Clear cache
  loadedSpaces.delete(spaceId)
}

/**
 * Get all currently loaded spaces.
 */
export function getLoadedSpaces(): Map<string, LoadedSpace> {
  return loadedSpaces
}

/**
 * Check if a space is loaded.
 */
export function isSpaceLoaded(spaceId: string): boolean {
  return loadedSpaces.has(spaceId)
}

/**
 * Reload a space — clears cache, re-reads bundle from disk, re-executes.
 * Used by dev mode HMR when the bundle file changes.
 */
export async function reloadSpace(spaceId: string): Promise<LoadedSpace | null> {
  unloadSpace(spaceId)
  return loadSpace(spaceId)
}

/**
 * Watch a space's bundle for changes and hot-reload when rebuilt.
 * Polls the manifest's build.builtAt timestamp to detect rebuilds.
 *
 * Works in both dev and production:
 * - Dev mode (VITE_SPACE_DEV_DIR set): always watches
 * - Production: watches if the space's `.dev` marker exists
 *   (created by `construct dev`, signals active development)
 *
 * Returns an unwatch function, or null if watching isn't needed.
 */
export async function watchSpace(
  spaceId: string,
  onReload: (space: LoadedSpace | null) => void
): Promise<(() => void) | null> {
  try {
    const { readTextFile, exists } = await import('@tauri-apps/plugin-fs')
    const { homeDir } = await import('@tauri-apps/api/path')
    const home = await homeDir()
    const spaceDir = getSpaceDirPath(home, spaceId)
    const manifestPath = `${spaceDir}/manifest.json`
    const devMarkerPath = `${spaceDir}/.dev`

    // In production, only watch if .dev marker exists (construct dev is running)
    if (!devOverrideDir && !IS_DEV_INSTANCE.value && !import.meta.env.DEV) {
      if (!(await exists(devMarkerPath))) return null
    }

    // Read initial builtAt timestamp
    let lastBuiltAt = ''
    try {
      const json = JSON.parse(await readTextFile(manifestPath))
      lastBuiltAt = json.build?.builtAt || ''
    } catch { /* ignore */ }

    let stopped = false
    const poll = async () => {
      if (stopped) return
      try {
        // Stop polling if .dev marker is removed (construct dev stopped)
        if (!devOverrideDir && !IS_DEV_INSTANCE.value && !import.meta.env.DEV) {
          if (!(await exists(devMarkerPath))) {
            stopped = true
            return
          }
        }

        const json = JSON.parse(await readTextFile(manifestPath))
        const builtAt = json.build?.builtAt || ''
        if (builtAt && builtAt !== lastBuiltAt) {
          lastBuiltAt = builtAt
          const reloaded = await reloadSpace(spaceId)
          onReload(reloaded)
        }
      } catch { /* file may be mid-write */ }
      if (!stopped) setTimeout(poll, 2000)
    }

    // Start polling
    setTimeout(poll, 2000)
    return () => { stopped = true }
  } catch (err) {
    console.warn('[SpaceLoader] Could not set up file watcher:', err)
    return null
  }
}

/**
 * Preload all installed spaces to register their actions.
 * Called at app startup so agent tools are available immediately.
 */
export async function preloadSpaceActions(): Promise<void> {
  console.log('[SpaceLoader] preloadSpaceActions: starting')
  try {
    const { readDir, exists } = await import('@tauri-apps/plugin-fs')
    const { getSpacesDirPath } = await import('@/lib/appPaths')
    const { homeDir } = await import('@tauri-apps/api/path')
    const home = await homeDir()
    const spacesDir = getSpacesDirPath(home)
    console.log('[SpaceLoader] preloadSpaceActions: spacesDir =', spacesDir)
    if (!spacesDir || !(await exists(spacesDir))) {
      console.log('[SpaceLoader] preloadSpaceActions: spacesDir not found')
      return
    }

    const entries = await readDir(spacesDir)
    console.log('[SpaceLoader] preloadSpaceActions: found', entries.length, 'entries')
    // Save current space context
    const savedSpaceId = (window as any).construct?.space?.id || ''

    for (const entry of entries) {
      if (!entry.isDirectory) continue
      const spaceId = entry.name
      if (loadedSpaces.has(spaceId)) continue
      try {
        console.log(`[SpaceLoader] preloadSpaceActions: loading "${spaceId}"`)
        await loadSpace(spaceId)
        console.log(`[SpaceLoader] preloadSpaceActions: loaded "${spaceId}"`)
      } catch (e) {
        console.warn(`[SpaceLoader] preloadSpaceActions: failed "${spaceId}":`, e)
      }
    }

    // Restore space context to whatever was active before preload
    if ((window as any).construct) {
      (window as any).construct.space = { id: savedSpaceId }
    }
    console.log('[SpaceLoader] preloadSpaceActions: done')
  } catch (e) {
    console.warn('[SpaceLoader] preloadSpaceActions error:', e)
  }
}

/**
 * Auto-register a space's actions as an automation provider.
 * Developers just export `actions` from entry.ts — no boilerplate needed.
 *
 * Action format:
 *   {
 *     action_id: {
 *       description: string,
 *       params?: { paramName: { type, description, required? } },
 *       run: (payload) => Promise<result>,
 *     }
 *   }
 */
interface SpaceAction {
  description: string
  params?: Record<string, { type: string; description?: string; required?: boolean }>
  run: (payload: Record<string, unknown>) => Promise<unknown> | unknown
}

function registerSpaceActions(spaceId: string, actions: Record<string, SpaceAction>): void {
  const provider: AutomationProvider = {
    snapshot() {
      return {
        space_id: spaceId,
        title: spaceId,
        state: {},
        actions: Object.keys(actions),
      }
    },

    listActions(): AutomationAction[] {
      return Object.entries(actions).map(([id, action]) => {
        const properties: Record<string, unknown> = {}
        const required: string[] = []

        if (action.params) {
          for (const [name, param] of Object.entries(action.params)) {
            properties[name] = { type: param.type, description: param.description || '' }
            if (param.required) required.push(name)
          }
        }

        return {
          id,
          description: action.description,
          params: {
            type: 'object',
            properties,
            ...(required.length ? { required } : {}),
          },
        }
      })
    },

    async runAction(actionId: string, payload?: Record<string, unknown>): Promise<ActionResult> {
      const action = actions[actionId]
      if (!action) {
        return { success: false, error: `Unknown action: ${actionId}` }
      }
      try {
        const result = await action.run(payload || {})
        return { success: true, data: result as Record<string, unknown> }
      } catch (e: any) {
        return { success: false, error: e.message || String(e) }
      }
    },
  }

  registerAutomationProvider(spaceId, provider)
  console.log(`[SpaceLoader] Registered ${Object.keys(actions).length} actions for "${spaceId}"`)
}
