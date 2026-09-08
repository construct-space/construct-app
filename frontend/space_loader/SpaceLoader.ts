/**
 * SpaceLoader — unified loader for all space types.
 *
 * Spaces are loaded in priority order:
 *   1. **Host-native** — checked first via `getCoreSpace()` (coreSpaces.ts).
 *      These are compiled into the app and return immediately with no I/O.
 *   2. **Dev override** — if VITE_SPACE_DEV_DIR is set, checked next
 *      (for `construct space dev` linking).
 *   3. **Dynamic (disk)** — pre-built IIFE bundles in the user's app data
 *      directory, loaded via Tauri FS.
 *
 * Dynamic space loading flow:
 *   1. Resolve installed .space file/directory to a readable runtime dir
 *   2. Read app.iife.js
 *   3. Verify SHA-256 checksum against manifest.build.checksum
 *   4. Execute via eval() — IIFE assigns to window.__CONSTRUCT_SPACE_{id}
 *   5. Extract page components from the global
 *   6. Attach CSS via a scoped <link data-space="{id}">
 *   7. Cache in memory Map
 */

import type { Component } from 'vue'
import { getSpaceIdFromDirName } from '@/lib/appPaths'
import type { SpaceContextMenuConfig } from '@/lib/contextMenuTypes'
import { getCoreSpace, isCoreSpace } from './coreSpaces'
import { clearSpaceRuntimeState, listAutomationProviders, registerAutomationProvider } from '@/lib/spaceContextBus'
import type { AutomationProvider, AutomationAction, ActionResult } from '@/types/automation'
import { loadSpaceAssistantTypes } from '@/assistant/loader'
import { unregisterAssistantTypesBySource } from '@/assistant/registry'
import { HOST_API_VERSION } from '@/lib/spaceHostConstants'
import {
  validateSpaceManifest,
  checkVersionCompatibility,
  scanBundleForUnsupportedImports,
  scanBundleForForbiddenNativeAccess,
  buildDoctorReport,
  type SpaceHealthCheck,
  type SpaceDoctorReport,
  type SpaceLoadError,
} from './validation'
import {
  buildVueScopedFallback,
  rewriteRelativeCssUrls,
  scopeSpaceCssForHost,
} from './spaceCss'
import { verifyBundleSignature } from './signature'

/** Spaces we've already logged an "unsigned" warning for — keeps the warning
 *  to once per space instead of once per (re)load. */
const warnedUnsigned = new Set<string>()
import { isSpaceBundleEntry } from './spaceBundleResolver'
import {
  type SpaceSource,
  createSpaceSource,
  resolveJsEntry,
  resolveCssEntries,
} from './SpaceSource'

// Re-export validation types and functions for consumers
export {
  validateSpaceManifest,
  parseSemver,
  checkVersionCompatibility,
  scanBundleForUnsupportedImports,
  scanBundleForForbiddenNativeAccess,
  type ManifestValidationResult,
  type VersionCompatibility,
  type SpaceHealthCheck,
  type SpaceDoctorReport,
  type SpaceLoadError,
} from './validation'

export interface LoadedSpace {
  id: string
  manifest: SpaceManifest
  pages: Record<string, Component>
  widgets?: Record<string, Record<string, Component>> // widgetId -> sizeKey -> Component
  components?: Record<string, Component>
  cssInjected: boolean
  cssText?: string
  /** Host-native spaces with semantic actions expose a store-backed
   *  AutomationProvider factory here. registerCoreSpaceProviders() wires
   *  it at startup so brain can run the space's actions headlessly — the
   *  host-native counterpart to dynamic spaces' lazy manifest providers.
   *  Omit for spaces with no actions (ask, builder, …). */
  createAutomationProvider?: () => AutomationProvider
}

export interface SpaceManifest {
  id: string
  name: string
  version: string
  description: string
  icon: string
  scopes: ('app' | 'org')[]
  projectAware?: boolean
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
  requiresDeveloper?: boolean
  agent?: string
  skills?: string[]
  assistant?: {
    id?: string
    label?: string
    entryAgent?: string
    renderMode?: 'blocks' | 'timeline' | 'custom'
    customRenderer?: string
    finalSchema?: string | null
    sessionScope?: 'global' | 'assistant' | 'project'
    supportsAttachments?: boolean
    requiresProjectPath?: boolean
  }
  build?: {
    checksum: string
    size: number
    hostApiVersion: string
    builtAt: string
    /** Base64 ECDSA P-256 signature over the JS bundle bytes, set by the
     *  publish pipeline. Verified in signature.ts against TRUSTED_SPACE_KEYS. */
    signature?: string
    /** Which pinned key id signed this bundle. */
    signKeyId?: string
  }
  /** Declarative action metadata — registered at startup without loading the bundle. */
  actions?: Record<string, {
    description: string
    params?: Record<string, { type: string; description?: string; required?: boolean }>
  }>
  /**
   * Permission gating. Maps each action to a permission string from the
   * org's permission catalog (e.g. "board:delete"). Roles in the org —
   * defined via the org settings UI / `/org/roles` API — declare which
   * permission strings they grant. SpaceLoader.runAction enforces by
   * calling useOrgRoles().can(perm) before invoking the handler.
   *
   * `catalog` lets the space self-register the permission strings it
   * uses, so the org's admin UI can render them without extra wiring.
   * If an action isn't listed in `actions`, it's treated as unrestricted.
   */
  permissions?: {
    actions?: Record<string, string>
    catalog?: Array<{ id: string; label: string; group?: string; description?: string }>
  }
}

/**
 * Run health checks on all installed spaces.
 *
 * Checks each space for:
 * - Valid manifest structure
 * - Bundle checksum integrity
 * - Host API version compatibility
 * - Agent asset existence (if declared)
 *
 * This is the `construct doctor` equivalent for the app runtime.
 */
export async function spaceDoctor(): Promise<SpaceDoctorReport> {
  const spaces: SpaceHealthCheck[] = []

  try {
    const { readDir, exists } = await import('@tauri-apps/plugin-fs')
    const { getSpacesDirPath } = await import('@/lib/appPaths')
    const { homeDir } = await import('@tauri-apps/api/path')
    const home = await homeDir()
    const spacesDir = getSpacesDirPath(home)

    if (!spacesDir || !(await exists(spacesDir))) {
      return buildDoctorReport(spaces)
    }

    const entries = await readDir(spacesDir)

    for (const entry of entries) {
      if (!isSpaceBundleEntry(entry)) continue
      const spaceId = getSpaceIdFromDirName(entry.name)
      if (!spaceId) continue
      const check: SpaceHealthCheck = {
        spaceId,
        manifestValid: false,
        manifestErrors: [],
        manifestWarnings: [],
        checksumMatch: null,
        versionCompatibility: 'unknown',
        agentAssetsValid: true,
        agentAssetWarnings: [],
      }

      try {
        const src = await createSpaceSource(spaceId)
        // 1. Read and validate manifest
        if (!src || !(await src.entryExists('manifest.json'))) {
          check.manifestErrors.push('manifest.json not found')
          spaces.push(check)
          continue
        }

        let manifest: Record<string, unknown>
        try {
          manifest = JSON.parse(await src.readText('manifest.json'))
        } catch {
          check.manifestErrors.push('manifest.json is not valid JSON')
          spaces.push(check)
          continue
        }

        const validation = validateSpaceManifest(manifest)
        check.manifestValid = validation.valid
        check.manifestErrors = validation.errors
        check.manifestWarnings = validation.warnings

        // 2. Checksum verification — resolve the JS entry by listing, not by
        // a fixed filename.
        const build = manifest.build as Record<string, unknown> | undefined
        if (build?.checksum && typeof build.checksum === 'string') {
          const jsEntry = await resolveJsEntry(src)
          if (jsEntry) {
            const actual = await sha256Hex(await src.readText(jsEntry))
            check.checksumMatch = actual === build.checksum
          } else {
            check.checksumMatch = false
            check.manifestErrors.push('No JS bundle (*.iife.js) found')
          }
        }
        // CSS is optional — newer bundles inline it. Not an error if absent.

        // 3. Version compatibility
        const hostApiVersion = (build as Record<string, unknown> | undefined)?.hostApiVersion as string | undefined
        check.versionCompatibility = checkVersionCompatibility(hostApiVersion)

        // 4. Agent asset verification
        if (manifest.agent && typeof manifest.agent === 'string') {
          if (!(await src.entryExists(manifest.agent))) {
            check.agentAssetsValid = false
            check.agentAssetWarnings.push(`Agent config not found: ${manifest.agent}`)
          }
        }
        if (Array.isArray(manifest.skills)) {
          for (const skill of manifest.skills) {
            if (typeof skill === 'string') {
              if (!(await src.entryExists(skill))) {
                check.agentAssetsValid = false
                check.agentAssetWarnings.push(`Skill not found: ${skill}`)
              }
            }
          }
        }
      } catch (err) {
        check.manifestErrors.push(`Unexpected error: ${err}`)
      }

      spaces.push(check)
    }
  } catch (err) {
    console.error('[SpaceDoctor] Failed to run health checks:', err)
  }

  return buildDoctorReport(spaces)
}

/** In-memory cache of loaded space bundles */
const loadedSpaces = new Map<string, LoadedSpace>()

/** Per-space reload subscribers. Fire after reloadSpace succeeds so widgets,
 *  dynamic pages, and anything else rendering a space component can pick up
 *  the new bundle without a full app restart. */
const reloadSubscribers = new Map<string, Set<(space: LoadedSpace | null) => void>>()

/** Subscribe to reload events for a specific space. Returns an unsubscribe fn. */
export function subscribeToSpaceReload(
  spaceId: string,
  cb: (space: LoadedSpace | null) => void,
): () => void {
  let set = reloadSubscribers.get(spaceId)
  if (!set) {
    set = new Set()
    reloadSubscribers.set(spaceId, set)
  }
  set.add(cb)
  return () => {
    const s = reloadSubscribers.get(spaceId)
    if (!s) return
    s.delete(cb)
    if (s.size === 0) reloadSubscribers.delete(spaceId)
  }
}

function notifySpaceReload(spaceId: string, space: LoadedSpace | null): void {
  const subs = reloadSubscribers.get(spaceId)
  if (!subs) return
  for (const cb of subs) {
    try { cb(space) } catch (err) {
      console.warn(`[SpaceLoader] reload subscriber threw for "${spaceId}":`, err)
    }
  }
}

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
  // Always (re)bind window.construct.space.id so cross-space navigation
  // doesn't leave the previous space's id on the global. Graph SDK reads
  // this lazily on every request — a stale id sends X-Space-ID for the
  // wrong space (or 'default' if never set), failing backend validation.
  const w = window as unknown as Record<string, Record<string, unknown> | undefined>
  if (w.construct) {
    w.construct.space = { id: spaceId }
  }

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
      // Register assistant type if the manifest declares one
      if (devSpace.manifest.assistant) {
        loadSpaceAssistantTypes([devSpace])
      }
      return devSpace
    }
  }

  // Load from the installed spaces directory.
  const prodSpace = await loadSpaceFromDisk(spaceId)
  if (prodSpace) {
    loadedSpaces.set(spaceId, prodSpace)
    // Register assistant type if the manifest declares one
    if (prodSpace.manifest.assistant) {
      loadSpaceAssistantTypes([prodSpace])
    }
    return prodSpace
  }

  // Not found is a normal condition (orphan widget references after a
  // space is uninstalled, marketplace previews, dev-mode probes). Keep
  // it at info-level so the console isn't full of WARNs.
  console.info(`[SpaceLoader] "${spaceId}" → not found`)
  return null
}

/**
 * Load pre-built .space bundle from the active app spaces directory.
 */
async function loadSpaceFromDisk(spaceId: string): Promise<LoadedSpace | null> {
  try {
    const src = await createSpaceSource(spaceId)
    if (!src) {
      console.info(`[SpaceLoader] "${spaceId}" → not installed`)
      return null
    }
    // Installed bundles are subject to signature enforcement.
    return await loadSpaceFromSource(spaceId, src, true)
  } catch (err) {
    console.error(`[SpaceLoader] Failed to load space "${spaceId}" from disk:`, err)
    return null
  }
}

/** Module-level last error — read by DynamicSpacePage for detailed error display */
let _lastLoadError: SpaceLoadError | null = null

export function getLastLoadError(): SpaceLoadError | null {
  return _lastLoadError
}

export function clearLastLoadError(): void {
  _lastLoadError = null
}

/**
 * Load a space from an arbitrary directory path.
 *
 * Enhanced with:
 * - Manifest validation (Slice C.2) — validates structure before loading bundle
 * - Version compatibility (Slice B.4) — blocks on major mismatch, warns on minor
 * - Bundle import scanning (Slice C.1) — best-effort detection of unsupported imports
 * - Agent asset validation (Slice C.3) — verifies agent config/skills paths exist
 * - Structured errors — sets _lastLoadError for detailed error UI
 */
export async function loadSpaceFromDir(spaceId: string, baseDir: string): Promise<LoadedSpace | null> {
  _lastLoadError = null
  try {
    const src = await createSpaceSource(spaceId, baseDir)
    if (!src) return null
    // Dev-linked / preview dirs are rebuilt locally and never signed —
    // exempt from signature enforcement.
    return await loadSpaceFromSource(spaceId, src, false)
  } catch (err) {
    if (!_lastLoadError) {
      _lastLoadError = {
        spaceId,
        phase: 'bundle',
        message: `Unexpected error loading space`,
        details: [String(err)],
      }
    }
    console.error(`[SpaceLoader] Failed to load space "${spaceId}" from dir:`, err)
    return null
  }
}

/**
 * Shared load path for both installed (ZIP) and dev/preview (dir) sources.
 * Reads everything through the SpaceSource so the host never hardcodes a
 * filename or a disk path.
 */
async function loadSpaceFromSource(spaceId: string, src: SpaceSource, trusted: boolean): Promise<LoadedSpace | null> {
  _lastLoadError = null
  try {
    // --- Phase: manifest ---
    if (!(await src.entryExists('manifest.json'))) {
      return null
    }
    let manifest: SpaceManifest
    try {
      manifest = JSON.parse(await src.readText('manifest.json'))
    } catch (err) {
      _lastLoadError = {
        spaceId,
        phase: 'manifest',
        message: `Failed to read or parse manifest.json`,
        details: [String(err)],
      }
      console.error(`[SpaceLoader] ${_lastLoadError.message} for "${spaceId}":`, err)
      return null
    }

    // --- Phase: validation (Slice C.2) ---
    const validation = validateSpaceManifest(manifest as unknown as Record<string, unknown>)
    if (!validation.valid) {
      _lastLoadError = {
        spaceId,
        phase: 'validation',
        message: `Manifest validation failed`,
        details: validation.errors,
      }
      console.error(`[SpaceLoader] Manifest validation failed for "${spaceId}":`, validation.errors)
      return null
    }
    if (validation.warnings.length > 0) {
      console.warn(`[SpaceLoader] Manifest warnings for "${spaceId}":`, validation.warnings)
    }

    // --- Phase: version compatibility (Slice B.4) ---
    const compat = checkVersionCompatibility(manifest.build?.hostApiVersion)
    if (compat === 'incompatible') {
      _lastLoadError = {
        spaceId,
        phase: 'version',
        message: `Incompatible host API version`,
        details: [
          `Space was built for host API v${manifest.build?.hostApiVersion}`,
          `Current host API is v${HOST_API_VERSION}`,
          `Major version mismatch — this space needs to be rebuilt`,
        ],
      }
      console.error(`[SpaceLoader] ${_lastLoadError.message} for "${spaceId}": space=${manifest.build?.hostApiVersion}, host=${HOST_API_VERSION}`)
      return null
    }
    if (compat === 'minor-mismatch') {
      console.warn(`[SpaceLoader] Minor host API version mismatch for "${spaceId}": space=${manifest.build?.hostApiVersion}, host=${HOST_API_VERSION}. Some features may not be available.`)
    }

    // --- Phase: bundle read ---
    // Resolve the JS entry by listing the bundle (app.iife.js →
    // space-<id>.iife.js → *.iife.js) rather than assuming a fixed name.
    const jsEntry = await resolveJsEntry(src)
    if (!jsEntry) {
      _lastLoadError = {
        spaceId,
        phase: 'bundle',
        message: `No JS bundle (*.iife.js) found`,
        details: ['Expected app.iife.js, space-<id>.iife.js, or another top-level *.iife.js entry'],
      }
      return null
    }
    const jsContent = await src.readText(jsEntry)

    // --- Phase: checksum ---
    if (manifest.build?.checksum) {
      const actual = await sha256Hex(jsContent)
      if (actual !== manifest.build.checksum) {
        _lastLoadError = {
          spaceId,
          // NOTE: this is an INTEGRITY check, not an authenticity one. The
          // checksum lives in the same manifest that ships with the bundle,
          // so anyone who can replace the bundle can also replace the
          // checksum — a mismatch means corruption, not a defeated attacker.
          // Tamper resistance needs publisher signature verification, which
          // this code does not yet do.
          phase: 'checksum',
          message: `Bundle checksum mismatch — file is corrupted or was modified after build`,
          details: [
            `Expected: ${manifest.build.checksum}`,
            `Actual: ${actual}`,
          ],
        }
        console.error(`[SpaceLoader] Checksum mismatch for "${spaceId}": expected ${manifest.build.checksum}, got ${actual}`)
        return null
      }
    }

    // --- Phase: signature ---
    // Authenticity (vs. the checksum's integrity). Verifies an ECDSA
    // signature over the bundle bytes against a pinned publisher key.
    // Non-breaking by default: unsigned spaces warn (policy "warn"); a
    // present-but-invalid signature always fails. Dev-linked spaces
    // (trusted=false) are exempt. See signature.ts.
    const sigResult = await verifyBundleSignature(jsContent, manifest.build, { trusted })
    if (!sigResult.ok) {
      _lastLoadError = {
        spaceId,
        phase: 'signature',
        message: `Bundle signature verification failed`,
        details: [sigResult.reason || sigResult.state],
      }
      console.error(`[SpaceLoader] Signature check failed for "${spaceId}": ${sigResult.reason}`)
      return null
    }
    if (sigResult.state === 'unsigned' && trusted && !warnedUnsigned.has(spaceId)) {
      // Warn once per space — this fires on every (re)load otherwise. Expected
      // while no marketplace signing key is provisioned (policy defaults to warn).
      warnedUnsigned.add(spaceId)
      console.warn(`[SpaceLoader] "${spaceId}" is unsigned — ${sigResult.reason}`)
    }

    // --- Phase: bundle import scanning (Slice C.1) ---
    const unsupported = scanBundleForUnsupportedImports(jsContent)
    if (unsupported.length > 0) {
      console.warn(`[SpaceLoader] Space "${spaceId}" references non-host packages: ${unsupported.join(', ')}. These may fail at runtime.`)
    }
    const forbiddenNative = scanBundleForForbiddenNativeAccess(jsContent)
    if (forbiddenNative.length > 0) {
      _lastLoadError = {
        spaceId,
        phase: 'validation',
        message: `Bundle requests native app APIs that are not allowed for public spaces`,
        details: forbiddenNative,
      }
      console.error(`[SpaceLoader] Blocking "${spaceId}" due to forbidden native access: ${forbiddenNative.join(', ')}`)
      return null
    }

    // --- Phase: eval ---
    await ensureSpaceHost()

    if ((window as unknown as Record<string, unknown>).construct) {
      (window as unknown as Record<string, Record<string, unknown>>).construct.space = { id: spaceId }
    }

    try {
      ;(0, eval)(jsContent)
    } catch (err) {
      _lastLoadError = {
        spaceId,
        phase: 'eval',
        message: `Bundle execution failed`,
        details: [String(err)],
      }
      console.error(`[SpaceLoader] eval() failed for "${spaceId}":`, err)
      return null
    }

    // --- Phase: export ---
    const globalKey = toGlobalKey(spaceId)
    const spaceExport = (window as unknown as Record<string, unknown>)[globalKey] as Record<string, unknown> | undefined
    if (!spaceExport?.pages) {
      _lastLoadError = {
        spaceId,
        phase: 'export',
        message: `Bundle did not export pages`,
        details: [`Expected window.${globalKey}.pages to be defined`],
      }
      console.warn(`[SpaceLoader] Space "${spaceId}" bundle did not export pages`)
      return null
    }

    // Call space init hook if provided
    if (typeof spaceExport.init === 'function') {
      try { (spaceExport.init as () => void)() } catch (e) {
        console.warn(`[SpaceLoader] Space "${spaceId}" init error:`, e)
      }
    }

    // Auto-register actions as automation provider
    if (spaceExport.actions && typeof spaceExport.actions === 'object') {
      registerSpaceActions(
        spaceId,
        spaceExport.actions as Record<string, SpaceAction>,
        manifest.permissions,
      )
    }

    if (manifest.agent && typeof manifest.agent === 'string') {
      if (!(await src.entryExists(manifest.agent))) {
        console.warn(`[SpaceLoader] Space "${spaceId}" declares agent config "${manifest.agent}" but file not found`)
      }
    }
    if (manifest.skills && Array.isArray(manifest.skills)) {
      for (const skill of manifest.skills) {
        if (typeof skill === 'string') {
          if (!(await src.entryExists(skill))) {
            console.warn(`[SpaceLoader] Space "${spaceId}" declares skill "${skill}" but file not found`)
          }
        }
      }
    }

    // Inject bundled CSS. Release loads the IIFE from disk, so CSS imports are
    // not applied by Vite's dev runtime and must be read + injected here.
    // CSS may be inlined into the bundle (no separate file) — that's fine.
    let cssInjected = false
    let cssText = ''
    const cssEntries = await resolveCssEntries(src)
    if (cssEntries.length > 0) {
      cssText = await injectCSS(spaceId, src, cssEntries)
      cssInjected = true
      console.debug(`[SpaceLoader] Injected CSS for "${spaceId}"`, {
        files: cssEntries,
        bytes: cssText.length,
      })
    } else {
      console.debug(`[SpaceLoader] No separate CSS for "${spaceId}" (inlined or none)`)
    }

    const widgets = spaceExport.widgets as Record<string, Record<string, Component>> | undefined

    return {
      id: spaceId,
      manifest,
      pages: spaceExport.pages as Record<string, Component>,
      widgets,
      components: spaceExport.components as Record<string, Component> | undefined,
      cssInjected,
      cssText,
    }
  } catch (err) {
    if (!_lastLoadError) {
      _lastLoadError = {
        spaceId,
        phase: 'bundle',
        message: `Unexpected error loading space`,
        details: [String(err)],
      }
    }
    console.error(`[SpaceLoader] Failed to load space "${spaceId}" from source:`, err)
    return null
  }
}

/**
 * Inject CSS into the document for a space.
 */
const cssObjectUrls = new Map<string, string[]>()
const injectedSpaceCss = new Map<string, string>()

export function getInjectedSpaceCss(spaceId: string): string {
  return injectedSpaceCss.get(spaceId) ?? ''
}

/**
 * Read + scope + inject a space's CSS entries. Relative `url(...)` references
 * are rewritten through the source's asset URL (`space://` for installed ZIPs,
 * `asset://` for dev dirs). Returns the combined raw CSS for `cssText`.
 */
async function injectCSS(spaceId: string, src: SpaceSource, cssEntries: string[]): Promise<string> {
  removeInjectedCSS(spaceId)

  const rawTexts = await Promise.all(cssEntries.map(entry => src.readText(entry)))
  const css = rawTexts.join('\n\n')

  const fallback = buildVueScopedFallback(css)
  const shadowCss = fallback ? `${css}\n\n${fallback}` : css
  const hostCss = cssEntries
    .map((entry, i) => {
      // Rewrite relative url() against the entry's path so the asset URL is
      // resolved relative to where the CSS lives inside the bundle.
      const rewritten = rewriteRelativeCssUrls(rawTexts[i], entry, (path) => src.assetUrl(path))
      return scopeSpaceCssForHost(spaceId, rewritten)
    })
    .join('\n\n')
  const scopedFallback = fallback ? `\n\n${scopeSpaceCssForHost(spaceId, fallback)}` : ''
  const url = URL.createObjectURL(new Blob([`${hostCss}${scopedFallback}`], { type: 'text/css' }))
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.setAttribute('data-space', spaceId)
  link.setAttribute('data-space-scoped', 'true')
  link.href = url
  document.head.appendChild(link)
  cssObjectUrls.set(spaceId, [url])

  // Wait for the stylesheet to actually apply before returning. Without
  // this, loadSpace() resolves immediately and the caller mounts the
  // space's Vue components in the next tick — components render their
  // first paint BEFORE the browser has parsed the blob CSS, so users see
  // widgets at default browser sizing (e.g. text-xs ignored, grids
  // unspaced) until something forces a reflow. Reload "fixed" it because
  // the second render happened after the stylesheet was already applied;
  // the first paint was actually unstyled both times. 5 s safety cap so
  // a broken stylesheet doesn't hang space loading forever.
  await new Promise<void>((resolve) => {
    const done = () => resolve()
    link.addEventListener('load', done, { once: true })
    link.addEventListener('error', done, { once: true })
    setTimeout(done, 5000)
  })

  injectedSpaceCss.set(spaceId, shadowCss)
  return css
}

function removeInjectedCSS(spaceId: string): void {
  document
    .querySelectorAll(`style[data-space="${spaceId}"], link[data-space="${spaceId}"]`)
    .forEach(node => node.remove())

  for (const url of cssObjectUrls.get(spaceId) ?? []) {
    URL.revokeObjectURL(url)
  }
  cssObjectUrls.delete(spaceId)
  injectedSpaceCss.delete(spaceId)
}

/**
 * Unload a space — remove CSS, clean up globals, clear cache.
 */
export function unloadSpace(spaceId: string): void {
  removeInjectedCSS(spaceId)

  // Clean up global (core spaces have no window global)
  if (!isCoreSpace(spaceId)) {
    const globalKey = toGlobalKey(spaceId)
    delete (window as unknown as Record<string, unknown>)[globalKey]
    unregisterAssistantTypesBySource(`space:${spaceId}`)
    clearSpaceRuntimeState(spaceId)
  }

  // Clear cache
  loadedSpaces.delete(spaceId)
}

/**
 * Clear profile-scoped dynamic space runtime state.
 *
 * Installed spaces live under the active profile's data dir, so keeping a
 * previously-loaded bundle in memory after profile switch can expose spaces
 * that are not installed for the new profile.
 */
export function resetDynamicSpacesForProfileSwitch(): void {
  for (const spaceId of Array.from(loadedSpaces.keys())) {
    if (isCoreSpace(spaceId)) continue
    unloadSpace(spaceId)
    notifySpaceReload(spaceId, null)
  }
  // Lazy action providers (registered from manifests at startup, space
  // never opened) aren't in loadedSpaces — clear them too, or the old
  // profile's spaces keep answering space_run_action after the switch.
  for (const spaceId of listAutomationProviders()) {
    if (isCoreSpace(spaceId)) continue
    clearSpaceRuntimeState(spaceId)
  }
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
  const reloaded = await loadSpace(spaceId)
  notifySpaceReload(spaceId, reloaded)
  return reloaded
}

/**
 * Watch a space's bundle for changes and hot-reload when rebuilt.
 * Polls the manifest's build.builtAt timestamp to detect rebuilds.
 *
 * Dynamic spaces can be rebuilt by the external `construct install` CLI while
 * the app is already running. Watching the active route in production keeps the
 * loaded bundle/CSS in sync without requiring a manual app restart.
 *
 * Returns an unwatch function, or null if watching isn't needed.
 */
export async function watchSpace(
  spaceId: string,
  onReload: (space: LoadedSpace | null) => void
): Promise<(() => void) | null> {
  if (isCoreSpace(spaceId)) return null

  try {
    const { pollManifestChangesVia } = await import('@/utils/spacePolling')
    const src = await createSpaceSource(spaceId)
    if (!src) return null

    // Read the manifest through the source so this works whether the space is
    // an installed ZIP (read via IPC; the archive byte cache refreshes when the
    // .space file's mtime changes) or a dev-linked dir (read from disk).
    return await pollManifestChangesVia(
      () => src.readText('manifest.json'),
      async () => {
        const reloaded = await reloadSpace(spaceId)
        onReload(reloaded)
      },
      {
        interval: 2000,
      },
    )
  } catch (err) {
    console.warn('[SpaceLoader] Could not set up file watcher:', err)
    return null
  }
}

/**
 * Preload space actions from manifests only — no bundle eval at startup.
 *
 * Reads each installed space's manifest.json and registers a lazy AutomationProvider
 * from the `actions` field. The full bundle is only loaded when an action is invoked.
 *
 * This replaces the old preloadSpaceActions() which eval'd every bundle at startup.
 */
export async function preloadSpaceActions(): Promise<void> {
  try {
    const { readDir, exists } = await import('@tauri-apps/plugin-fs')
    const { getSpacesDirPath } = await import('@/lib/appPaths')
    const { homeDir } = await import('@tauri-apps/api/path')
    const home = await homeDir()
    const spacesDir = getSpacesDirPath(home)
    if (!spacesDir || !(await exists(spacesDir))) return

    const entries = await readDir(spacesDir)
    let registered = 0

    for (const entry of entries) {
      if (!isSpaceBundleEntry(entry)) continue
      const spaceId = getSpaceIdFromDirName(entry.name)
      if (!spaceId) continue

      // Skip if already fully loaded (has a real provider with run functions)
      if (loadedSpaces.has(spaceId)) continue

      try {
        const src = await createSpaceSource(spaceId)
        if (!src || !(await src.entryExists('manifest.json'))) continue

        const manifest: SpaceManifest = JSON.parse(await src.readText('manifest.json'))

        // Register lazy provider from manifest actions metadata
        if (manifest.actions && Object.keys(manifest.actions).length > 0) {
          registerLazySpaceActions(spaceId, manifest.actions, manifest.permissions)
          registered++
        }
      } catch (e) {
        console.warn(`[SpaceLoader] manifest preload failed "${spaceId}":`, e)
      }
    }

    if (registered > 0) {
      console.debug(`[SpaceLoader] preloadSpaceActions: ${registered} spaces registered from manifests (lazy)`)
    }
  } catch (e) {
    console.warn('[SpaceLoader] preloadSpaceActions error:', e)
  }
}

/**
 * Register a lazy AutomationProvider from manifest action metadata.
 * The provider serves action listings immediately (from manifest),
 * but loads the full bundle on first runAction() call.
 */
function registerLazySpaceActions(
  spaceId: string,
  actionDefs: NonNullable<SpaceManifest['actions']>,
  permissions?: SpaceManifest['permissions'],
): void {
  let realActions: Record<string, SpaceAction> | null = null

  const provider: AutomationProvider = {
    snapshot() {
      return {
        space_id: spaceId,
        title: spaceId,
        state: {},
        actions: Object.keys(actionDefs),
      }
    },

    listActions(): AutomationAction[] {
      return Object.entries(actionDefs).map(([id, def]) => {
        const properties: Record<string, unknown> = {}
        const required: string[] = []
        if (def.params) {
          for (const [name, param] of Object.entries(def.params)) {
            properties[name] = { type: param.type, description: param.description || '' }
            if (param.required) required.push(name)
          }
        }
        return {
          id,
          description: def.description,
          params: { type: 'object', properties, ...(required.length ? { required } : {}) },
          ...((def as unknown as { tier?: 'small' | 'medium' | 'large' }).tier
            ? { tier: (def as unknown as { tier: 'small' | 'medium' | 'large' }).tier }
            : {}),
        }
      })
    },

    async runAction(actionId: string, payload?: Record<string, unknown>): Promise<ActionResult> {
      // Lazy-load the full bundle on first invocation
      if (!realActions) {
        try {
          const loaded = await loadSpace(spaceId)
          if (!loaded) {
            return { success: false, error: `Failed to load space "${spaceId}" bundle` }
          }
          const globalKey = toGlobalKey(spaceId)
          const spaceExport = (window as unknown as Record<string, Record<string, unknown>>)[globalKey]
          if (spaceExport?.actions) {
            realActions = spaceExport.actions as Record<string, SpaceAction>
            // Upgrade to full provider now that we have run functions
            registerSpaceActions(spaceId, realActions, permissions)
          }
        } catch (e) {
          return { success: false, error: `Bundle load failed: ${e}` }
        }
      }

      if (!realActions?.[actionId]) {
        return { success: false, error: `Unknown action: ${actionId}` }
      }

      const denied = await checkPermission(actionId, permissions)
      if (denied) return { success: false, error: denied }

      const missing = missingRequiredParams(realActions[actionId], payload)
      if (missing.length) {
        return {
          success: false,
          error: `Missing required parameter(s) for "${actionId}": ${missing.join(', ')}`,
        }
      }

      try {
        const enriched = await injectIdentity(payload)
        // Pin window.construct.space.id to THIS space for the duration
        // of the action. The Graph SDK reads it on every request to
        // build the X-Space-ID header that selects the user's per-space
        // schema (`s_<space_id>_p_<project>`). Without this, an action
        // invoked while the user is navigated elsewhere queries the
        // wrong schema and Postgres returns "relation … does not exist".
        // This is the path General's spawn_agent takes when delegating
        // to a space agent — the user might be on Tetris and ask Board
        // for tasks, and Board's queries must hit Board's schema, not
        // Tetris's.
        const w = window as unknown as Record<string, Record<string, unknown> | undefined>
        const prevSpace = w.construct?.space
        if (w.construct) w.construct.space = { id: spaceId }
        let result: unknown
        try {
          result = await realActions[actionId].run(enriched)
        } finally {
          if (w.construct) w.construct.space = prevSpace
        }
        emitActionCompleted(spaceId, actionId, payload, result)
        return { success: true, data: result as Record<string, unknown> }
      } catch (e: unknown) {
        return { success: false, error: (e instanceof Error ? e.message : null) || String(e) }
      }
    },
  }

  registerAutomationProvider(spaceId, provider)
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

function registerSpaceActions(
  spaceId: string,
  actions: Record<string, SpaceAction>,
  permissions?: SpaceManifest['permissions'],
): void {
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
          ...((action as unknown as { tier?: 'small' | 'medium' | 'large' }).tier
            ? { tier: (action as unknown as { tier: 'small' | 'medium' | 'large' }).tier }
            : {}),
        }
      })
    },

    async runAction(actionId: string, payload?: Record<string, unknown>): Promise<ActionResult> {
      const action = actions[actionId]
      if (!action) {
        return { success: false, error: `Unknown action: ${actionId}` }
      }
      const denied = await checkPermission(actionId, permissions)
      if (denied) return { success: false, error: denied }
      const missing = missingRequiredParams(action, payload)
      if (missing.length) {
        return {
          success: false,
          error: `Missing required parameter(s) for "${actionId}": ${missing.join(', ')}`,
        }
      }
      try {
        const enriched = await injectIdentity(payload)
        // Same space.id pinning as the shell-provider runAction —
        // ensures actions run against THEIR OWN space's schema even
        // when the user is navigated elsewhere (General → spawn_agent
        // calling calendar.listEvents while user is on Finance, etc).
        const w = window as unknown as Record<string, Record<string, unknown> | undefined>
        const prevSpace = w.construct?.space
        if (w.construct) w.construct.space = { id: spaceId }
        let result: unknown
        try {
          result = await action.run(enriched)
        } finally {
          if (w.construct) w.construct.space = prevSpace
        }
        emitActionCompleted(spaceId, actionId, payload, result)
        return { success: true, data: result as Record<string, unknown> }
      } catch (e: unknown) {
        return { success: false, error: (e instanceof Error ? e.message : null) || String(e) }
      }
    },
  }

  registerAutomationProvider(spaceId, provider)
}

function emitActionCompleted(
  spaceId: string,
  action: string,
  payload: Record<string, unknown> | undefined,
  result: unknown,
): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('construct:action', {
    detail: { spaceId, action, payload, result },
  }))
}

/**
 * Inject identity sentinels (`_user_id`, `_actor_id`) into the action
 * payload as non-enumerable properties so handlers can read them
 * (`p._user_id`) for ABAC checks but `{ ...p }` (the common pattern when
 * forwarding to graph) does not pick them up — preventing leaks like
 * `column "_user_id" does not exist`. Underscore prefix marks them as
 * host-injected; spaces should never receive these from a user payload.
 */
async function injectIdentity(
  payload?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const out = { ...(payload || {}) }
  try {
    const { useAuthStore } = await import('@/stores/auth')
    const auth = useAuthStore()
    const uid = auth.user?.id
    if (uid) {
      Object.defineProperty(out, '_user_id', { value: uid, enumerable: false, writable: false, configurable: true })
      Object.defineProperty(out, '_actor_id', { value: uid, enumerable: false, writable: false, configurable: true })
    }
  } catch { /* ignore — handler will see undefined */ }
  return out
}

/**
 * Returns an error string if the user lacks the permission required for
 * `actionId` per the manifest's permissions.actions map; null when allowed.
 *
 * Permission strings are looked up against the active org's role bundle
 * (useOrgRoles().can). If the manifest declares no permission for the
 * action, the action is treated as unrestricted and we return null.
 *
 * If org context is missing entirely, we let the action through — single
 * personal users have no role infrastructure to check against.
 */
async function checkPermission(
  actionId: string,
  permissions: SpaceManifest['permissions'] | undefined,
): Promise<string | null> {
  const required = permissions?.actions?.[actionId]
  if (!required) return null
  try {
    const { useOrgStore } = await import('@/stores/org')
    const { useAuthStore } = await import('@/stores/auth')
    const { useOrgRoles } = await import('@/composables/useOrgRoles')
    const org = useOrgStore()
    if (!org.isEnabled) return null
    // Owner bypasses every gate — the role exists precisely so someone
    // can always do everything, even before any per-permission catalog
    // wiring lands. Admin gets the same blanket bypass for symmetry.
    const auth = useAuthStore()
    const roleNames = auth.roles || []
    if (roleNames.includes('owner') || roleNames.includes('admin')) return null
    const { can } = useOrgRoles()
    if (can(required)) return null
    return `Permission denied for "${actionId}" — requires "${required}". Ask an org admin to grant you a role with this permission.`
  } catch {
    return null
  }
}

function missingRequiredParams(
  action: SpaceAction,
  payload?: Record<string, unknown>,
): string[] {
  if (!action.params) return []
  const out: string[] = []
  for (const [name, param] of Object.entries(action.params)) {
    if (!param.required) continue
    const v = payload?.[name]
    if (v === undefined || v === null || v === '') out.push(name)
  }
  return out
}
