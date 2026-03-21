/**
 * Composable for loading and managing spaces.
 *
 * All modes scan the active app spaces directory for installed manifests via Tauri FS.
 * The Go backend (contextService) is NOT used for spaces.
 */

import { registerSpaceTheme } from '@/config/spaces'
import { getSpacesDirPath } from '@/lib/appPaths'
import type { SpaceContextMenuConfig } from '@/lib/contextMenuTypes'
import { getCoreSpaceManifests } from '@/space_loader/coreSpaces'
import type { SpaceScope } from '@/types/project'

/** Default scope for known space IDs when manifest doesn't specify one */
const SCOPE_DEFAULTS: Record<string, SpaceScope> = {
  code: 'project',
  design: 'project',
  git: 'project',
  kanban: 'project',
  docs: 'project',
  notes: 'project',
  terminal: 'project',
  calendar: 'project',
  projects: 'app',
  chat: 'app',
  ai: 'app',
  settings: 'app',
  marketplace: 'app',
  architect: 'both',
}

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

  scope?: SpaceScope
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

  const loadSpaces = async () => {
    loading.value = true
    try {
      await loadFromDisk()
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
  const loadFromDisk = async () => {
    // Always start with core spaces (ship with app, no disk needed)
    const coreManifests = getCoreSpaceManifests()
    const coreConfigs = coreManifests.map(m => manifestToSpaceConfig(m as unknown as Record<string, unknown>))
    const coreIds = new Set(coreManifests.map(m => m.id))

    try {
      const { readTextFile, readDir, exists } = await import('@tauri-apps/plugin-fs')
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
        if (!entry.isDirectory) continue
        const id = entry.name
        // Skip disk spaces that are already provided as core
        if (coreIds.has(id)) continue
        const manifestPath = `${spacesDir}/${id}/manifest.json`
        if (!(await exists(manifestPath))) continue

        try {
          const manifestJson = await readTextFile(manifestPath)
          const manifest = JSON.parse(manifestJson)
          const manifestId = (manifest.id as string) || id
          if (coreIds.has(manifestId)) continue
          if (disabledIds.has(manifestId)) continue
          diskSpaces.push(manifestToSpaceConfig(manifest))
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

/** Read disabled space IDs from marketplace localStorage state */
function getDisabledSpaceIds(): Set<string> {
  try {
    const raw = localStorage.getItem('construct:installed_spaces')
    if (!raw) return new Set()
    const items = JSON.parse(raw) as { id: string; enabled: boolean }[]
    return new Set(items.filter(s => s.enabled === false).map(s => s.id))
  } catch {
    return new Set()
  }
}

/** Get spaces that belong inside a project (scope = 'project' or 'both') */
export function getProjectSpaces(allSpaces: SpaceConfig[], projectSpaceIds?: string[]): SpaceConfig[] {
  return allSpaces.filter(s => {
    const scope = s.scope || SCOPE_DEFAULTS[s.name] || 'both'
    if (scope !== 'project' && scope !== 'both') return false
    // If project declares specific space IDs, filter to those
    if (projectSpaceIds?.length) return projectSpaceIds.includes(s.name)
    return true
  })
}

/** Get spaces that belong at the app/global level (scope = 'app' or 'both') */
export function getAppSpaces(allSpaces: SpaceConfig[]): SpaceConfig[] {
  return allSpaces.filter(s => {
    const scope = s.scope || SCOPE_DEFAULTS[s.name] || 'both'
    return scope === 'app' || scope === 'both'
  })
}

/** Convert a manifest from disk to SpaceConfig and register its theme */
function manifestToSpaceConfig(manifest: Record<string, unknown>): SpaceConfig {
  const id = (manifest.id as string) || (manifest.name as string)
  const nav = manifest.navigation as Record<string, unknown> | undefined
  const theme = manifest.theme as { color?: string; bg?: string } | undefined

  // Register theme for config/spaces.ts consumers (getSpace(), getRegisteredSpaceIds())
  registerSpaceTheme(id, {
    icon: (manifest.icon as string) || 'i-lucide-box',
    label: (manifest.name as string) || id,
    description: (manifest.description as string) || '',
    color: theme?.color || undefined,
    bg: theme?.bg || undefined,
  })

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
    scope: (manifest.scope as SpaceScope) || SCOPE_DEFAULTS[id] || 'both',
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
