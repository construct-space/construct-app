/**
 * Composable for loading and managing spaces.
 *
 * All modes scan the active app spaces directory for installed manifests via Tauri FS.
 * The Go backend (contextService) is NOT used for spaces.
 */

import { registerSpaceTheme } from '@/config/spaces'
import { getSpaceIdFromDirName, getSpacesDirPath } from '@/lib/appPaths'
import { profileStorage } from '@/lib/profileStorage'
import type { SpaceContextMenuConfig } from '@/lib/contextMenuTypes'
import { getCoreSpaceManifests, DEVELOPER_ONLY_SPACES } from '@/space_loader/coreSpaces'
import { isSpaceBundleEntry } from '@/space_loader/spaceBundleResolver'
import { type SpaceSource, createSpaceSource } from '@/space_loader/SpaceSource'
import { normalizeManifestScopes } from '@/space_loader/validation'
import type { SpaceScope } from '@/types/project'
import { useDevMode } from '@/composables/useDevMode'


export interface SpaceToolbarItem {
  id: string
  icon: string
  label: string
  action?: string     // Action name to emit
  to?: string         // Route to navigate to
}

export interface SpacePage {
  path: string        // '' for index, 'editor', 'assets', etc.
  label: string
  icon?: string
  default?: boolean   // Is this the default page for the space?
  requiresContext?: boolean // Only show when an item is selected
  toolbar?: SpaceToolbarItem[] // Page-specific toolbar items
}

export interface SpaceConfig {
  name: string
  displayName: string
  description: string
  icon: string

  // Pages this space provides
  pages: SpacePage[]

  // Toolbar items for this space
  toolbar?: SpaceToolbarItem[]

  // Navigation menu item
  navigation: {
    label: string
    icon: string
    to: string
    order: number
  }

  scopes?: SpaceScope[]
  projectAware?: boolean
  dependencies?: string[]
  permission?: string
  contextMenus?: SpaceContextMenuConfig

  // Marketplace metadata
  isInstalled?: boolean
  version?: string
  author?: string
  recommended?: boolean

  // Theme identity
  theme?: {
    color: string
    bg: string
  }
}

/**
 * Dynamically load all space configurations.
 *
 * Scans the active app spaces directory for manifest.json files.
 */
export function useSpaces() {
  const spaces = ref<SpaceConfig[]>([])
  const loading = ref(false)
  const { isEnrolled } = useDevMode()

  /**
   * `lite` skips icon inlining AND the global theme registration —
   * metadata-only consumers (e.g. the brain `space.directory` bridge
   * handler) must not pay per-icon file reads, and must NOT write
   * un-inlined icon paths into the shared theme registry, which would
   * clobber the sidebar icons the full load registered.
   */
  const loadSpaces = async (opts?: { lite?: boolean }) => {
    loading.value = true
    try {
      await loadFromDisk(opts)
    } catch (err) {
      console.error('[useSpaces] Failed to load spaces:', err)
      spaces.value = []
    } finally {
      loading.value = false
    }
  }

  /**
   * Scan the active app spaces directory for installed manifests.
   * Filters out spaces disabled in marketplace settings.
   */
  const loadFromDisk = async (opts?: { lite?: boolean }) => {
    const lite = opts?.lite === true
    // Always start with core spaces (ship with app, no disk needed)
    // Filter out developer-only spaces when developer mode is inactive
    const allCoreManifests = getCoreSpaceManifests()
    const coreManifests = isEnrolled.value
      ? allCoreManifests
      : allCoreManifests.filter(m => !DEVELOPER_ONLY_SPACES.has(m.id))
    const coreConfigs = coreManifests.map(m => manifestToSpaceConfig(m as unknown as Record<string, unknown>, { registerTheme: !lite }))
    const coreIds = new Set(allCoreManifests.map(m => m.id))

    try {
      const { readDir, exists } = await import('@tauri-apps/plugin-fs')
      const { homeDir } = await import('@tauri-apps/api/path')

      const home = await homeDir()
      const spacesDir = getSpacesDirPath(home)

      if (!(await exists(spacesDir))) {
        spaces.value = coreConfigs
        return
      }

      // Read disabled spaces from marketplace state
      const disabledIds = getDisabledSpaceIds()

      const entries = await readDir(spacesDir)
      const diskSpaces: SpaceConfig[] = []

      for (const entry of entries) {
        if (!isSpaceBundleEntry(entry)) continue
        const id = getSpaceIdFromDirName(entry.name)
        if (!id) continue
        // Skip disk spaces that are already provided as core
        if (coreIds.has(id)) continue

        try {
          const src = await createSpaceSource(id)
          if (!src || !(await src.entryExists('manifest.json'))) continue
          const manifest = JSON.parse(await src.readText('manifest.json'))
          const manifestId = (manifest.id as string) || id
          if (coreIds.has(manifestId)) continue
          if (disabledIds.has(manifestId)) continue
          if (!isEnrolled.value && manifest.requiresDeveloper) continue
          if (!lite) await resolveManifestIcons(manifest, src)
          diskSpaces.push(manifestToSpaceConfig(manifest, { registerTheme: !lite }))
        } catch {
          // Skip spaces with broken manifests
        }
      }

      spaces.value = [...coreConfigs, ...diskSpaces].sort((a, b) => (a.navigation.order || 0) - (b.navigation.order || 0))
    } catch {
      // Disk scan failed — still show core spaces
      spaces.value = coreConfigs
    }
  }

  const hasSpace = (spaceName: string) => {
    return spaces.value.some(space => space.name === spaceName)
  }

  const getSpace = (spaceName: string) => {
    return spaces.value.find(space => space.name === spaceName)
  }

  return {
    spaces,
    loading,
    loadSpaces,
    hasSpace,
    getSpace,
  }
}

/**
 * Authoritative set of *installed* space ids: core spaces (ship with the app)
 * plus every `<id>.space` on disk — WITHOUT dev-mode or disabled filtering, so
 * a hidden-but-installed space still counts as installed. Returns null when the
 * disk scan can't run (non-Tauri / error), so callers can skip destructive
 * pruning rather than treat "unknown" as "nothing installed".
 */
export async function listInstalledSpaceIds(): Promise<Set<string> | null> {
  const ids = new Set<string>()
  for (const m of getCoreSpaceManifests()) ids.add((m as { id: string }).id)
  try {
    const { exists, readDir } = await import('@tauri-apps/plugin-fs')
    const { homeDir } = await import('@tauri-apps/api/path')
    const spacesDir = getSpacesDirPath(await homeDir())
    // A missing spaces dir during a profile switch / logout teardown is an
    // unsettled state, not "no marketplace spaces installed". Return null
    // ("can't determine") so the only caller — pruneMissingSpaces — skips
    // rather than wiping every marketplace space pin.
    if (!(await exists(spacesDir))) return null
    for (const entry of await readDir(spacesDir)) {
      if (!isSpaceBundleEntry(entry)) continue
      const id = getSpaceIdFromDirName(entry.name)
      if (id) ids.add(id)
    }
    return ids
  } catch {
    return null
  }
}

/** Read disabled space IDs from marketplace profile-scoped state */
function getDisabledSpaceIds(): Set<string> {
  try {
    const raw = profileStorage.getItem('construct:installed_spaces')
    if (!raw) return new Set()
    const items = JSON.parse(raw) as { id: string; enabled: boolean }[]
    return new Set(items.filter(s => s.enabled === false).map(s => s.id))
  } catch {
    return new Set()
  }
}

/** Get spaces that participate in project context (projectAware === true).
 *
 * `projectSpaceIds` semantics:
 *   - `undefined` → no per-project manifest exists; fall back to showing every
 *     projectAware space (legacy behaviour for projects without `.construct/project.json`).
 *   - `[]` → explicit opt-out: this project uses NO spaces. Return nothing,
 *     even projectAware ones. Without this, plain code projects (Builder
 *     scaffolds, marketing sites) mount Notes/etc. and trigger per-project
 *     Postgres schema lookups against tables that don't exist.
 *   - `[…ids]` → allow-list, only the named spaces are active.
 */
export function getProjectSpaces(allSpaces: SpaceConfig[], projectSpaceIds?: string[]): SpaceConfig[] {
  return allSpaces.filter(s => {
    if (!s.projectAware) return false
    if (projectSpaceIds !== undefined) return projectSpaceIds.includes(s.name)
    return true
  })
}

/** Get spaces accessible from the sidebar (non-project-aware, matching active ownership). */
export function getAppSpaces(allSpaces: SpaceConfig[], orgEnabled = false): SpaceConfig[] {
  return allSpaces.filter(s => {
    if (s.projectAware) return false
    const scopes = s.scopes ?? ['app']
    if (scopes.includes('app')) return true
    if (scopes.includes('org') && orgEnabled) return true
    return false
  })
}

const MIME_BY_EXT: Record<string, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  ico: 'image/x-icon',
}

function isInlineableIconRef(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false
  if (value.startsWith('i-') || value.startsWith('lucide:')) return false
  if (value.startsWith('data:')) return false
  if (/^https?:\/\//.test(value)) return false
  return /\.(svg|png|webp|jpe?g|gif|ico)(\?|#|$)/i.test(value)
}

async function inlineIconAsDataUri(src: SpaceSource, ref: string): Promise<string | null> {
  try {
    const rel = ref.replace(/^\.?\//, '')
    if (!(await src.entryExists(rel))) return null
    const bytes = await src.readBytes(rel)
    const ext = (rel.split('.').pop() || '').toLowerCase().split(/[?#]/)[0]
    const mime = MIME_BY_EXT[ext] || 'application/octet-stream'
    let bin = ''
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
    return `data:${mime};base64,${btoa(bin)}`
  } catch {
    return null
  }
}

/** Inline relative icon paths (icon, navigation.icon, pages[].icon) as data URIs. */
async function resolveManifestIcons(manifest: Record<string, unknown>, src: SpaceSource): Promise<void> {
  if (isInlineableIconRef(manifest.icon)) {
    const data = await inlineIconAsDataUri(src, manifest.icon)
    if (data) manifest.icon = data
  }
  const nav = manifest.navigation as Record<string, unknown> | undefined
  if (nav && isInlineableIconRef(nav.icon)) {
    const data = await inlineIconAsDataUri(src, nav.icon as string)
    if (data) nav.icon = data
  }
  const pages = manifest.pages as Array<Record<string, unknown>> | undefined
  if (Array.isArray(pages)) {
    for (const p of pages) {
      if (isInlineableIconRef(p.icon)) {
        const data = await inlineIconAsDataUri(src, p.icon as string)
        if (data) p.icon = data
      }
    }
  }
}

/** Convert a manifest from disk to SpaceConfig and register its theme */
function manifestToSpaceConfig(manifest: Record<string, unknown>, opts?: { registerTheme?: boolean }): SpaceConfig {
  const id = (manifest.id as string) || (manifest.name as string)
  const nav = manifest.navigation as Record<string, unknown> | undefined
  const theme = manifest.theme as { color?: string; bg?: string } | undefined
  const normalized = normalizeManifestScopes(manifest)

  // Register theme for config/spaces.ts consumers (getSpace(), getRegisteredSpaceIds()).
  // Skipped on lite loads — their manifests carry un-inlined icon paths
  // that would overwrite the data-URI icons a full load registered.
  if (opts?.registerTheme !== false) {
    registerSpaceTheme(id, {
      icon: (manifest.icon as string) || 'i-lucide-box',
      label: (manifest.name as string) || id,
      description: (manifest.description as string) || '',
      color: theme?.color || undefined,
      bg: theme?.bg || undefined,
    })
  }

  return {
    name: id,
    displayName: (manifest.name as string) || id,
    description: (manifest.description as string) || '',
    icon: (manifest.icon as string) || 'i-lucide-box',
    pages: ((manifest.pages as SpacePage[]) || [{ path: '', label: 'Overview', default: true }]),
    toolbar: manifest.toolbar as SpaceToolbarItem[] | undefined,
    navigation: {
      label: (nav?.label as string) || (manifest.name as string) || id,
      icon: (nav?.icon as string) || (manifest.icon as string) || 'i-lucide-box',
      to: (nav?.to as string) || id,
      order: (nav?.order as number) || 100,
    },
    scopes: normalized.scopes,
    projectAware: normalized.projectAware,
    dependencies: Array.isArray(manifest.dependencies) ? manifest.dependencies as string[] : undefined,
    contextMenus: isRecord(manifest.contextMenus) ? manifest.contextMenus as SpaceContextMenuConfig : undefined,
    isInstalled: true,
    version: manifest.version as string,
    author: typeof manifest.author === 'object'
      ? (manifest.author as Record<string, string>)?.name
      : manifest.author as string,
    recommended: manifest.recommended as boolean,
    theme: manifest.theme as SpaceConfig['theme'],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
