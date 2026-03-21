/**
 * Space Marketplace composable
 *
 * Fetches the space catalog from the registry (portal API primary, GitHub index fallback).
 *
 * Install state is determined by what's on disk:
 *   - Spaces with manifest.json in the active app spaces dir are "installed"
 *
 * Does NOT use the Go backend (contextService) — that's for AI/auth/storage only.
 */

import { ref, computed } from 'vue'
import { getSpaceDirPath, getSpacesDirPath } from '@/lib/appPaths'
import { appConfig } from '@/utils/config'

export interface RemoteSpace {
  id: string
  name: string
  display_name: string
  description: string
  icon: string
  version: string
  author: string
  category: string
  stars: number
  downloads: number
  updated_at: string
  recommended?: boolean
  permissions?: string[]
}

/** Shape returned by the spaces registry API or GitHub index */
interface RegistrySpace {
  id: string
  name: string
  description: string
  icon: string
  version: string
  scope: string
  author?: string
  recommended?: boolean
  downloads?: number
  hostApiVersion?: string
  repo?: string
  tarball?: string
  released_at?: string
  [key: string]: unknown
}

interface RegistryResponse {
  version: number
  updated?: string
  updated_at?: string
  spaces: RegistrySpace[]
}

function registryToRemote(s: RegistrySpace): RemoteSpace {
  return {
    id: s.id,
    name: s.id,
    display_name: s.name,
    description: s.description,
    icon: s.icon,
    version: s.version,
    author: s.author ?? 'Construct Team',
    category: s.scope,
    stars: 0,
    downloads: typeof s.downloads === 'number' ? s.downloads : 0,
    updated_at: s.released_at ?? '',
    recommended: s.recommended,
  }
}

export interface InstalledSpace {
  id: string
  name: string
  display_name: string
  version: string
  enabled: boolean
  installed_at: string
  has_update: boolean
  latest_version?: string
}

const INSTALLED_STORAGE_KEY = 'construct:installed_spaces'
const FIRST_LAUNCH_KEY = 'construct:first_launch_done'

/** Read installed state from localStorage */
function readInstalledFromStorage(): InstalledSpace[] {
  try {
    const raw = localStorage.getItem(INSTALLED_STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return []
}

/** Save installed state to localStorage */
function saveInstalledToStorage(spaces: InstalledSpace[]): void {
  try {
    localStorage.setItem(INSTALLED_STORAGE_KEY, JSON.stringify(spaces))
  } catch { /* ignore */ }
}

export function useSpaceMarketplace() {
  const installed = ref<InstalledSpace[]>([])
  const remote = ref<RemoteSpace[]>([])
  const isLoading = ref(false)
  const isCheckingUpdates = ref(false)
  const searchQuery = ref('')
  const activeCategory = ref('all')
  const error = ref<string | null>(null)

  // Filtered remote spaces based on search + category
  const filteredRemote = computed(() => {
    let results = remote.value
    if (activeCategory.value !== 'all') {
      results = results.filter(s => s.category === activeCategory.value)
    }
    if (searchQuery.value.trim()) {
      const q = searchQuery.value.toLowerCase()
      results = results.filter(s =>
        s.display_name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.author.toLowerCase().includes(q)
      )
    }
    return results
  })

  // Check if a remote space is already installed
  const isInstalled = (spaceId: string): boolean => {
    return installed.value.some(s => s.id === spaceId || s.name === spaceId)
  }

  // Check if an installed space has an update
  const hasUpdate = (spaceId: string): boolean => {
    return installed.value.some(s => (s.id === spaceId || s.name === spaceId) && s.has_update)
  }

  async function fetchRemote(): Promise<void> {
    isLoading.value = true
    error.value = null
    try {
      const data = await fetchJson<RegistryResponse>(`${appConfig.spacesRegistryUrl}/registry`)
      if (data?.spaces?.length) {
        remote.value = data.spaces.map(registryToRemote)
      } else {
        remote.value = []
      }
    } catch {
      error.value = 'Failed to load spaces from registry'
      remote.value = []
    } finally {
      isLoading.value = false
    }
  }

  async function searchRemote(query: string, category?: string): Promise<void> {
    if (remote.value.length === 0) {
      await fetchRemote()
    }
    if (query) searchQuery.value = query
    if (category) activeCategory.value = category
  }

  /**
 * Load installed spaces by scanning the active app spaces directory on disk,
 * then merging any marketplace metadata from localStorage.
 */
  async function fetchInstalled(): Promise<void> {
    try {
      const { readTextFile, readDir, exists } = await import('@tauri-apps/plugin-fs')
      const { homeDir } = await import('@tauri-apps/api/path')

      const home = await homeDir()
      const spacesDir = getSpacesDirPath(home)

      if (!(await exists(spacesDir))) {
        installed.value = []
        return
      }

      const entries = await readDir(spacesDir)
      const storedMeta = readInstalledFromStorage()
      const metaMap = new Map(storedMeta.map(s => [s.id, s]))
      const diskSpaces: InstalledSpace[] = []

      for (const entry of entries) {
        if (!entry.isDirectory || !entry.name) continue
        const manifestPath = `${spacesDir}/${entry.name}/manifest.json`
        if (!(await exists(manifestPath))) continue

        try {
          const raw = await readTextFile(manifestPath)
          const manifest = JSON.parse(raw)
          const id = manifest.id || entry.name
          const existing = metaMap.get(id)
          const diskVersion = manifest.version || '0.0.0'

          // Validate stored update flag against current disk version —
          // if the stored latest_version isn't actually newer, clear the flag
          let hasStoredUpdate = existing?.has_update ?? false
          let storedLatest = existing?.latest_version
          if (hasStoredUpdate && storedLatest && !isNewerVersion(storedLatest, diskVersion)) {
            hasStoredUpdate = false
            storedLatest = undefined
          }

          diskSpaces.push({
            id,
            name: id,
            display_name: manifest.name || id,
            version: diskVersion,
            enabled: existing?.enabled ?? true,
            installed_at: existing?.installed_at || '',
            has_update: hasStoredUpdate,
            latest_version: storedLatest,
          })
        } catch {
          // Skip spaces with broken manifests
        }
      }

      installed.value = diskSpaces
      saveInstalledToStorage(diskSpaces)
    } catch {
      // Fallback to localStorage if disk scan fails
      installed.value = readInstalledFromStorage()
    }
  }

  /**
   * Install a space — downloads tarball from registry and extracts to the active app spaces dir.
   */
  async function install(spaceId: string): Promise<boolean> {
    if (NATIVE_SPACE_IDS.has(spaceId)) {
      console.log(`[Marketplace] Skipping install of native space: ${spaceId}`)
      return true
    }
    error.value = null

    try {
      console.log(`[Marketplace] Installing space: ${spaceId}`)

      // Find the space in the registry to get the tarball URL
      const registrySpace = await findRegistrySpace(spaceId)
      if (!registrySpace?.tarball) {
        error.value = `Space "${spaceId}" not found in registry`
        return false
      }

      // Download and extract via Tauri FS
      // tarball field is a full URL (GitHub Release asset)
      const tarballUrl = registrySpace.tarball.startsWith('http')
        ? registrySpace.tarball
        : `https://raw.githubusercontent.com/construct-space/space-releases/main/${registrySpace.tarball}`
      await downloadAndExtract(spaceId, tarballUrl)

      // Add to installed list
      const now = new Date().toISOString()
      const newSpace: InstalledSpace = {
        id: spaceId,
        name: spaceId,
        display_name: registrySpace.name,
        version: registrySpace.version,
        enabled: true,
        installed_at: now,
        has_update: false,
      }

      const current = installed.value.filter(s => s.id !== spaceId)
      current.push(newSpace)
      installed.value = current
      saveInstalledToStorage(current)

      console.log(`[Marketplace] Installed ${spaceId} v${registrySpace.version}`)

      // Notify sidebar to refresh
      window.dispatchEvent(new CustomEvent('construct:spaces-changed'))

      return true
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[Marketplace] Install failed for ${spaceId}:`, e)
      error.value = `Failed to install ${spaceId}: ${msg}`
      return false
    }
  }

  async function uninstall(spaceId: string): Promise<boolean> {
    error.value = null

    try {
      // Remove from disk
      const { remove, exists } = await import('@tauri-apps/plugin-fs')
      const { homeDir } = await import('@tauri-apps/api/path')
      const home = await homeDir()
      const spaceDir = getSpaceDirPath(home, spaceId)

      if (await exists(spaceDir)) {
        await remove(spaceDir, { recursive: true })
      }

      // Remove from installed list
      const current = installed.value.filter(s => s.id !== spaceId)
      installed.value = current
      saveInstalledToStorage(current)

      // Remove from pinned sidebar
      try {
        const { usePinnedStore } = await import('@/stores/pinned')
        const pinnedStore = usePinnedStore()
        if (pinnedStore.isPinned(spaceId)) {
          await pinnedStore.removePin(spaceId)
        }
      } catch { /* ignore */ }

      // Notify sidebar to refresh
      window.dispatchEvent(new CustomEvent('construct:spaces-changed'))

      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to uninstall space'
      return false
    }
  }

  async function update(spaceId: string): Promise<boolean> {
    // Uninstall then re-install to get latest version
    await uninstall(spaceId)
    return install(spaceId)
  }

  async function enable(spaceId: string): Promise<boolean> {
    const space = installed.value.find(s => s.id === spaceId)
    if (space) {
      space.enabled = true
      saveInstalledToStorage(installed.value)
      window.dispatchEvent(new CustomEvent('construct:spaces-changed'))
    }
    return true
  }

  async function disable(spaceId: string): Promise<boolean> {
    const space = installed.value.find(s => s.id === spaceId)
    if (space) {
      space.enabled = false
      saveInstalledToStorage(installed.value)

      // Remove from pinned sidebar when disabled
      try {
        const { usePinnedStore } = await import('@/stores/pinned')
        const pinnedStore = usePinnedStore()
        // Remove all pins for this space (global and project-scoped)
        const spacePins = pinnedStore.items.filter(
          p => p.type === 'space' && p.metadata?.spaceId === spaceId
        )
        for (const pin of spacePins) {
          await pinnedStore.removePin(pin.id)
        }
      } catch { /* ignore */ }

      window.dispatchEvent(new CustomEvent('construct:spaces-changed'))
    }
    return true
  }

  async function checkUpdates(): Promise<number> {
    isCheckingUpdates.value = true
    try {
      if (remote.value.length === 0) await fetchRemote()

      let updates = 0
      const updated = installed.value.map(space => {
        const remoteVer = remote.value.find(r => r.id === space.id)
        if (remoteVer && isNewerVersion(remoteVer.version, space.version)) {
          updates++
          return { ...space, has_update: true, latest_version: remoteVer.version }
        }
        return { ...space, has_update: false, latest_version: undefined }
      })
      installed.value = updated
      saveInstalledToStorage(updated)
      return updates
    } finally {
      isCheckingUpdates.value = false
    }
  }

  return {
    // State
    installed,
    remote,
    isLoading,
    isCheckingUpdates,
    searchQuery,
    activeCategory,
    error,

    // Computed
    filteredRemote,

    // Methods
    fetchRemote,
    searchRemote,
    fetchInstalled,
    install,
    uninstall,
    update,
    enable,
    disable,
    checkUpdates,
    isInstalled,
    hasUpdate,
  }
}

/**
 * Auto-install recommended spaces on first launch.
 *
 * 1. Check if the active app spaces dir is empty or doesn't exist
 * 2. If empty, fetch registry
 * 3. Filter spaces where recommended === true
 * 4. Install each recommended space
 * 5. Mark first-launch complete in localStorage
 */
export async function autoInstallRecommended(): Promise<void> {
  // Skip if already done
  if (localStorage.getItem(FIRST_LAUNCH_KEY)) {
    return
  }

  try {
    // Check if spaces dir is empty
    const { readDir, exists } = await import('@tauri-apps/plugin-fs')
    const { homeDir } = await import('@tauri-apps/api/path')

    const home = await homeDir()
    const spacesDir = getSpacesDirPath(home)

    let isEmpty = true
    if (await exists(spacesDir)) {
      const entries = await readDir(spacesDir)
      isEmpty = entries.filter(e => e.isDirectory).length === 0
    }

    if (!isEmpty) {
      // Spaces already exist — mark as done and skip
      localStorage.setItem(FIRST_LAUNCH_KEY, 'true')
      return
    }

    console.log('[Marketplace] First launch detected — auto-installing recommended spaces...')

    // Fetch registry
    const portalData = await fetchJson<RegistryResponse>(`${appConfig.spacesRegistryUrl}/registry`)
    const registrySpaces = portalData?.spaces || []

    // Filter recommended and install (skip native host pages)
    const recommended = registrySpaces.filter(s => s.recommended && !NATIVE_SPACE_IDS.has(s.id))
    if (recommended.length === 0) {
      console.log('[Marketplace] No recommended spaces found in registry')
      localStorage.setItem(FIRST_LAUNCH_KEY, 'true')
      return
    }

    const marketplace = useSpaceMarketplace()
    for (const space of recommended) {
      try {
        await marketplace.install(space.id)
        console.log(`[Marketplace] Auto-installed: ${space.id}`)
      } catch (err) {
        console.warn(`[Marketplace] Failed to auto-install ${space.id}:`, err)
      }
    }

    localStorage.setItem(FIRST_LAUNCH_KEY, 'true')
    console.log(`[Marketplace] First launch complete — installed ${recommended.length} recommended spaces`)
  } catch (err) {
    console.error('[Marketplace] Auto-install failed:', err)
    // Don't mark as done so it retries next launch
  }
}

/** Spaces that are now native host pages — never install as dynamic spaces */
export const NATIVE_SPACE_IDS = new Set(['vibe', 'architect', 'projects'])

/**
 * Ensure essential spaces are always installed.
 * Currently no essential spaces remain (architect + projects are native).
 */
export const ESSENTIAL_SPACE_IDS: string[] = []

export async function ensureEssentialSpaces(): Promise<void> {
  // No essential spaces to ensure — architect + projects are native host pages
}

/** Compare semver strings — returns true if `remote` is newer than `local` */
function isNewerVersion(remote: string, local: string): boolean {
  const r = remote.replace(/^v/, '').split('.').map(Number)
  const l = local.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const rv = r[i] || 0
    const lv = l[i] || 0
    if (rv > lv) return true
    if (rv < lv) return false
  }
  return false
}

/** Fetch JSON via standard fetch (Tauri webview supports HTTPS via http:allow-fetch) */
async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return await res.json() as T
  } catch {
    return null
  }
}

/** Find a space entry in the registry (must include tarball for install) */
async function findRegistrySpace(spaceId: string): Promise<RegistrySpace | null> {
  const data = await fetchJson<RegistryResponse>(`${appConfig.spacesRegistryUrl}/registry`)
  if (!data) return null
  const found = data.spaces?.find(s => s.id === spaceId)
  return found?.tarball ? found : null
}

/** Download a tarball and extract it to the active app spaces dir. */
async function downloadAndExtract(spaceId: string, tarballUrl: string): Promise<void> {
  const { mkdir, exists, writeFile } = await import('@tauri-apps/plugin-fs')
  const { homeDir } = await import('@tauri-apps/api/path')
  const { Command } = await import('@tauri-apps/plugin-shell')

  const home = await homeDir()
  const spacesDir = getSpacesDirPath(home)
  const spaceDir = getSpaceDirPath(home, spaceId)

  // Ensure directory exists
  if (!(await exists(spacesDir))) {
    await mkdir(spacesDir, { recursive: true })
  }
  if (!(await exists(spaceDir))) {
    await mkdir(spaceDir, { recursive: true })
  }

  // Download tarball via fetch + write to disk
  const tarballPath = `${spaceDir}/space.tar.gz`
  const res = await fetch(tarballUrl)
  if (!res.ok) {
    throw new Error(`Failed to download: HTTP ${res.status}`)
  }
  const arrayBuf = await res.arrayBuffer()
  await writeFile(tarballPath, new Uint8Array(arrayBuf))

  // Extract using tar command
  const cmd = Command.create('tar', ['-xzf', tarballPath, '-C', spaceDir])
  const output = await cmd.execute()
  if (output.code !== 0) {
    throw new Error(`tar extract failed: ${output.stderr}`)
  }

  // Tarballs contain files in dist/ subdirectory — flatten to space root
  const { readDir, rename, remove } = await import('@tauri-apps/plugin-fs')
  const distDir = `${spaceDir}/dist`
  if (await exists(distDir)) {
    const entries = await readDir(distDir)
    for (const entry of entries) {
      if (!entry.name) continue
      await rename(`${distDir}/${entry.name}`, `${spaceDir}/${entry.name}`)
    }
    await remove(distDir, { recursive: true })
  }
}
