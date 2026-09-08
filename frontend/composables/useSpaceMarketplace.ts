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
import { getSpaceDirPath, getSpaceIdFromDirName, getSpacesDirPath } from '@/lib/appPaths'
import { profileStorage } from '@/lib/profileStorage'
import { appConfig } from '@/utils/config'
import { HOST_NATIVE_SPACE_IDS } from '@/types/space'
import { useOrg } from '@/composables/useOrg'
import { useAuthStore } from '@/stores/auth'
import { isSpaceBundleEntry } from '@/space_loader/spaceBundleResolver'
import { type SpaceSource, createSpaceSource } from '@/space_loader/SpaceSource'

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

/** Shape returned by marketplace-api: GET /api/marketplace/spaces/{name} */
export interface MarketplaceSpace {
  id: string                // slug
  name: string              // display title
  description: string
  icon: string
  version: string
  host_api_version?: string
  manifest?: unknown
  tarball_url: string
  scopes: ('app' | 'org')[]
  project_aware: boolean
  publisher_slug: string
  publisher_name: string
  category: string | null
  tags: string[]
  downloads: number
  installs_7d: number
  installs_30d: number
  promoted_at: string
  updated_at: string
  demoted_at?: string | null
}

export function marketplaceSpaceToRemote(s: MarketplaceSpace): RemoteSpace {
  return {
    id: s.id,
    name: s.id,
    display_name: s.name,
    description: s.description,
    icon: s.icon,
    version: s.version,
    author: s.publisher_name || 'Construct Team',
    category: s.category || s.scopes?.[0] || 'app',
    stars: 0,
    downloads: s.downloads ?? 0,
    updated_at: s.updated_at || s.promoted_at || '',
  }
}

export interface InstalledSpace {
  id: string
  name: string
  display_name: string
  icon?: string
  version: string
  enabled: boolean
  installed_at: string
  has_update: boolean
  latest_version?: string
}

// Installed spaces default to alphabetical order by display name
// (case-insensitive, locale-aware) so the list is stable regardless of
// filesystem scan / install order.
const byDisplayName = (a: InstalledSpace, b: InstalledSpace): number =>
  a.display_name.localeCompare(b.display_name, undefined, { sensitivity: 'base' })

const INSTALLED_STORAGE_KEY = 'construct:installed_spaces'
const _FIRST_LAUNCH_KEY = 'construct:first_launch_done'

/** Read installed state from profile-scoped storage */
function readInstalledFromStorage(): InstalledSpace[] {
  try {
    const raw = profileStorage.getItem(INSTALLED_STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return []
}

/** Save installed state to profile-scoped storage */
function saveInstalledToStorage(spaces: InstalledSpace[]): void {
  try {
    const persisted = spaces.map(space => ({
      id: space.id,
      name: space.name,
      display_name: space.display_name,
      version: space.version,
      enabled: space.enabled,
      installed_at: space.installed_at,
      has_update: space.has_update,
      latest_version: space.latest_version,
    }))
    profileStorage.setItem(INSTALLED_STORAGE_KEY, JSON.stringify(persisted))
  } catch { /* ignore */ }
}

interface PaginatedResponse {
  spaces: MarketplaceSpace[]
  total: number
  page: number
  pageSize: number
}

export function useSpaceMarketplace() {
  const installed = ref<InstalledSpace[]>([])
  const remote = ref<RemoteSpace[]>([])
  const rawScopesById = ref<Record<string, string[]>>({})
  const rawProjectAwareById = ref<Record<string, boolean>>({})
  const isLoading = ref(false)
  const isCheckingUpdates = ref(false)
  const searchQuery = ref('')
  const activeCategory = ref('all')
  const activeScope = ref('all')
  const error = ref<string | null>(null)

  // Pagination state
  const currentPage = ref(1)
  const totalPages = ref(1)
  const totalSpaces = ref(0)
  const pageSize = ref(24)

  const { isOrg } = useOrg()

  // Server handles search/category filters. Scope is filtered client-side
  // because marketplace-api doesn't expose a scope query param. Also hide
  // org-scoped spaces from personal users (no org context).
  const filteredRemote = computed(() => {
    let list = remote.value
    if (activeScope.value !== 'all') {
      list = list.filter(s => rawScopesById.value[s.id]?.includes(activeScope.value))
    }
    if (!isOrg.value) {
      // hide org-only spaces from personal-mode users
      list = list.filter(s => {
        const scopes = rawScopesById.value[s.id]
        return !scopes || scopes.includes('app')
      })
    }
    return list
  })

  // Check if a remote space is already installed
  const isInstalled = (spaceId: string): boolean => {
    return installed.value.some(s => s.id === spaceId || s.name === spaceId)
  }

  // Check if an installed space has an update
  const hasUpdate = (spaceId: string): boolean => {
    return installed.value.some(s => (s.id === spaceId || s.name === spaceId) && s.has_update)
  }

  async function fetchRemote(page = 1): Promise<void> {
    isLoading.value = true
    error.value = null
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize.value),
      })
      if (searchQuery.value.trim()) params.set('q', searchQuery.value.trim())
      if (activeCategory.value !== 'all') params.set('category', activeCategory.value)
      if (activeScope.value !== 'all') params.set('scope', activeScope.value)

      const data = await fetchJson<PaginatedResponse>(
        `${appConfig.marketplaceUrl}/spaces?${params}`,
      )
      if (data?.spaces?.length) {
        remote.value = data.spaces.map(marketplaceSpaceToRemote)
        rawScopesById.value = Object.fromEntries(data.spaces.map(s => [s.id, s.scopes]))
        rawProjectAwareById.value = Object.fromEntries(data.spaces.map(s => [s.id, s.project_aware]))
      } else {
        remote.value = []
        rawScopesById.value = {}
        rawProjectAwareById.value = {}
      }
      currentPage.value = data?.page ?? 1
      totalSpaces.value = data?.total ?? 0
      const ps = data?.pageSize || pageSize.value
      totalPages.value = ps > 0 ? Math.max(1, Math.ceil((data?.total ?? 0) / ps)) : 1
    } catch {
      error.value = 'Failed to load spaces from registry'
      remote.value = []
    } finally {
      isLoading.value = false
    }
  }

  async function goToPage(page: number): Promise<void> {
    if (page < 1 || page > totalPages.value) return
    await fetchRemote(page)
  }

  async function searchRemote(query: string, category?: string): Promise<void> {
    if (query) searchQuery.value = query
    if (category) activeCategory.value = category
    currentPage.value = 1
    await fetchRemote(1)
  }

  /**
 * Load installed spaces by scanning the active app spaces directory on disk,
 * then merging any marketplace metadata from localStorage.
 */
  async function fetchInstalled(): Promise<void> {
    try {
      const { readDir, exists } = await import('@tauri-apps/plugin-fs')
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
        if (!isSpaceBundleEntry(entry)) continue
        const entryId = getSpaceIdFromDirName(entry.name)
        if (!entryId) continue

        try {
          const src = await createSpaceSource(entryId)
          if (!src || !(await src.entryExists('manifest.json'))) continue
          const manifest = JSON.parse(await src.readText('manifest.json'))
          const id = manifest.id || entryId
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
            icon: await resolveInstalledIcon(manifest, src),
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

      diskSpaces.sort(byDisplayName)
      installed.value = diskSpaces
      saveInstalledToStorage(diskSpaces)
    } catch {
      // Fallback to localStorage if disk scan fails
      installed.value = readInstalledFromStorage().sort(byDisplayName)
    }
  }

  /**
   * Install a space — downloads the marketplace bundle and installs it as
   * a single <id>.space file in the active app spaces dir.
   */
  async function install(spaceId: string): Promise<boolean> {
    if (NATIVE_SPACE_IDS.has(spaceId)) {
      console.log(`[Marketplace] Skipping install of native space: ${spaceId}`)
      return true
    }
    error.value = null

    try {
      console.log(`[Marketplace] Installing space: ${spaceId}`)

      // Look up the space in the marketplace to get the downloadable bundle URL.
      const mpSpace = await getMarketplaceSpace(spaceId)
      if (!mpSpace?.tarball_url) {
        error.value = `Space "${spaceId}" not found in marketplace`
        return false
      }

      await downloadAndExtract(spaceId, mpSpace.tarball_url)

      // Add to installed list
      const now = new Date().toISOString()
      const newSpace: InstalledSpace = {
        id: spaceId,
        name: spaceId,
        display_name: mpSpace.name,
        version: mpSpace.version,
        enabled: true,
        installed_at: now,
        has_update: false,
      }

      // Best-effort install ping. Marketplace endpoint requires gateway
      // secret, so fire via gateway and ignore failures.
      void recordInstall(spaceId, mpSpace.version)

      const current = installed.value.filter(s => s.id !== spaceId)
      current.push(newSpace)
      installed.value = current
      saveInstalledToStorage(current)
      await fetchInstalled()

      console.log(`[Marketplace] Installed ${spaceId} v${mpSpace.version}`)

      // Register the new space's lazy action provider so the assistant can
      // run its actions immediately — without this, the space shows up in
      // brain's directory with no actions until the app restarts or the
      // space is opened.
      try {
        const { preloadSpaceActions } = await import('@/space_loader/SpaceLoader')
        await preloadSpaceActions()
      } catch (e) {
        console.warn('[Marketplace] action preload after install failed:', e)
      }

      // Notify sidebar to refresh
      window.dispatchEvent(new CustomEvent('construct:spaces-changed'))

      // Ask the operator to rescan spaceDirs so the new space's tools,
      // hooks, skills, plugins, and agent become live without a restart.
      // Best-effort: failure means the user just has to restart for the
      // operator-side bits, which still leaves the UI install working.
      try {
        const { useBrain } = await import('@/brain')
        const brain = useBrain()
        await brain.request('spaces.reload')
      } catch (e) {
        console.warn('[Marketplace] spaces.reload failed (operator may need restart):', e)
      }

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

      // Drop the space's runtime + automation provider and tell brain to
      // rebuild its installed-spaces directory — otherwise the assistant
      // keeps advertising (and trying to run) the uninstalled space's
      // actions until the cache TTL expires.
      try {
        const { unloadSpace } = await import('@/space_loader/SpaceLoader')
        unloadSpace(spaceId)
      } catch { /* ignore */ }
      try {
        const { useBrain } = await import('@/brain')
        await useBrain().request('spaces.reload')
      } catch (e) {
        console.warn('[Marketplace] spaces.reload after uninstall failed:', e)
      }

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
    activeScope,
    error,

    // Pagination
    currentPage,
    totalPages,
    totalSpaces,
    pageSize,

    // Computed
    filteredRemote,
    rawScopesById,
    rawProjectAwareById,

    // Methods
    fetchRemote,
    searchRemote,
    goToPage,
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
  // Auto-install disabled — spaces are installed manually from the marketplace.
  // Built-in spaces (architect, ask, coder, editor, project) are host-native
  // and don't need installation.
  return
}

/**
 * Spaces that are host-native pages — never install as dynamic spaces.
 * Derived from the canonical list in types/space.ts.
 */
export const NATIVE_SPACE_IDS: Set<string> = new Set(HOST_NATIVE_SPACE_IDS)

/**
 * Ensure essential spaces are always installed.
 * Currently no essential spaces remain — all 4 built-in spaces are host-native.
 */
export const ESSENTIAL_SPACE_IDS: string[] = []

export async function ensureEssentialSpaces(): Promise<void> {
  // No essential spaces to ensure — architect, ask, coder, project are host-native
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

/**
 * Fetch a single space record from marketplace-api. Returns the full record
 * (description, manifest, stats, tarball, etc.) — null when the API has no
 * matching slug or the record is missing a tarball (treated as unpublished).
 * Used by the install path and by the marketplace detail page.
 */
export async function fetchMarketplaceSpace(spaceId: string): Promise<MarketplaceSpace | null> {
  const data = await fetchJson<MarketplaceSpace>(`${appConfig.marketplaceUrl}/spaces/${encodeURIComponent(spaceId)}`)
  return data?.tarball_url ? data : null
}

// Backwards-compat alias for the in-file install path. New callers should
// import fetchMarketplaceSpace.
const getMarketplaceSpace = fetchMarketplaceSpace

/**
 * POST install event. The gateway's /api/marketplace/install-events route
 * runs auth_request, then signs the proxied call with X-Internal-Secret for
 * the upstream's gateway-secret gate. The desktop client authenticates with a
 * Bearer token (no browser session cookie exists in the Tauri webview), so we
 * must attach it explicitly — `credentials: 'include'` alone yields a 401.
 * Skipped entirely when signed out. Failures are silent — install must not
 * depend on telemetry.
 */
async function recordInstall(spaceId: string, version: string): Promise<void> {
  const token = useAuthStore().token
  if (!token) return
  try {
    await fetch(`${appConfig.marketplaceUrl}/install-events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ space: spaceId, version }),
      credentials: 'include',
    })
  } catch { /* ignore */ }
}

export interface MarketplaceCategory {
  slug: string
  title: string
  description?: string
  icon?: string
  position?: number
  visible?: boolean
}

export interface MarketplaceCollection {
  id: string
  slug: string
  title: string
  description?: string
  kind: 'manual' | 'dynamic'
  priority?: number
}

export async function fetchMarketplaceCategories(): Promise<MarketplaceCategory[]> {
  const data = await fetchJson<{ categories?: MarketplaceCategory[] }>(`${appConfig.marketplaceUrl}/categories`)
  return data?.categories ?? []
}

export async function fetchMarketplaceCollections(): Promise<MarketplaceCollection[]> {
  const data = await fetchJson<{ collections?: MarketplaceCollection[] }>(`${appConfig.marketplaceUrl}/collections`)
  return data?.collections ?? []
}

export async function fetchMarketplaceCollection(slug: string): Promise<{ collection: MarketplaceCollection; spaces: MarketplaceSpace[] } | null> {
  return fetchJson(`${appConfig.marketplaceUrl}/collections/${encodeURIComponent(slug)}`)
}

const ICON_MIME_BY_EXT: Record<string, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  ico: 'image/x-icon',
}

function isRelativeImageIcon(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false
  if (value.startsWith('i-') || value.startsWith('lucide:')) return false
  if (value.startsWith('data:')) return false
  if (/^https?:\/\//.test(value)) return false
  return /\.(svg|png|webp|jpe?g|gif|ico)(\?|#|$)/i.test(value)
}

async function inlineInstalledIcon(src: SpaceSource, ref: string): Promise<string | null> {
  try {
    const rel = ref.replace(/^\.?\//, '')
    if (!(await src.entryExists(rel))) return null
    const bytes = await src.readBytes(rel)
    const ext = (rel.split('.').pop() || '').toLowerCase().split(/[?#]/)[0]
    const mime = ICON_MIME_BY_EXT[ext] || 'application/octet-stream'
    let bin = ''
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
    return `data:${mime};base64,${btoa(bin)}`
  } catch {
    return null
  }
}

async function resolveInstalledIcon(manifest: Record<string, unknown>, src: SpaceSource): Promise<string | undefined> {
  const nav = manifest.navigation as Record<string, unknown> | undefined
  const icon = typeof manifest.icon === 'string'
    ? manifest.icon
    : typeof nav?.icon === 'string'
      ? nav.icon
      : undefined
  if (!icon) return undefined
  if (!isRelativeImageIcon(icon)) return icon
  return (await inlineInstalledIcon(src, icon)) ?? undefined
}

/** Download a marketplace bundle and install it to the active app spaces dir. */
async function downloadAndExtract(spaceId: string, tarballUrl: string): Promise<void> {
  const { mkdir, exists, copyFile, stat } = await import('@tauri-apps/plugin-fs')
  const { homeDir } = await import('@tauri-apps/api/path')
  const { invoke } = await import('@tauri-apps/api/core')
  const { Command } = await import('@tauri-apps/plugin-shell')

  const home = await homeDir()
  const spacesDir = getSpacesDirPath(home)
  const spaceDir = getSpaceDirPath(home, spaceId)
  const tempRoot = `${spacesDir}/space-install-tmp`
  const downloadPath = `${tempRoot}/${spaceId}.download`
  const stageDir = `${tempRoot}/${spaceId}.stage`

  // Ensure spaces directory exists before writing the downloaded bundle.
  if (!(await exists(spacesDir))) {
    await mkdir(spacesDir, { recursive: true })
  }
  if (!(await exists(tempRoot))) {
    await mkdir(tempRoot, { recursive: true })
  }
  await removeIfExists(spaceDir)
  await removeIfExists(downloadPath)
  await removeIfExists(stageDir)

  // Download via the Rust backend (reqwest + rustls) rather than a browser
  // fetch or the OS curl. A browser fetch is blocked by CORS (the CDN sends no
  // Access-Control-Allow-Origin for dev origins); the OS curl uses Windows
  // schannel, which fails the TLS handshake on older Windows
  // (SEC_E_ILLEGAL_MESSAGE). reqwest carries its own TLS, so it works
  // regardless of the OS TLS stack and isn't subject to CORS.
  try {
    await invoke('download_file', { url: tarballUrl, dest: downloadPath })
  } catch (e) {
    throw new Error(`Download failed: ${e instanceof Error ? e.message : String(e)}`, { cause: e })
  }

  try {
    // Future marketplace artifacts should be direct .space ZIP files. Try that
    // first, then fall back to the current bundle.tar.gz shape.
    await copyFile(downloadPath, spaceDir)
    try {
      if (await invoke<boolean>('space_bundle_validate', { spaceId })) {
        return
      }
      await removeIfExists(spaceDir)
    } catch {
      await removeIfExists(spaceDir)
    }

    await mkdir(stageDir, { recursive: true })
    const cmd = Command.create('tar', ['-xzf', downloadPath, '-C', stageDir])
    const output = await cmd.execute()
    if (output.code !== 0) {
      throw new Error(`tar extract failed: ${output.stderr}`)
    }

    const nestedBundle = `${stageDir}/${spaceId}.space`
    if (await exists(nestedBundle)) {
      const info = await stat(nestedBundle)
      if (info.isFile) {
        await copyFile(nestedBundle, spaceDir)
      } else if (info.isDirectory) {
        await invoke<string>('space_bundle_pack', {
          spaceId,
          sourceDir: nestedBundle,
        })
      } else {
        throw new Error(`Unsupported ${spaceId}.space entry in bundle`)
      }
    } else if (await exists(`${stageDir}/manifest.json`)) {
      await invoke<string>('space_bundle_pack', {
        spaceId,
        sourceDir: stageDir,
      })
    } else {
      throw new Error(`Bundle did not contain manifest.json or ${spaceId}.space`)
    }

    if (!(await invoke<boolean>('space_bundle_validate', { spaceId }))) {
      throw new Error(`Installed bundle for "${spaceId}" failed validation`)
    }
  } finally {
    await removeIfExists(downloadPath)
    await removeIfExists(stageDir)
  }
}

async function removeIfExists(path: string): Promise<void> {
  try {
    const { exists, remove } = await import('@tauri-apps/plugin-fs')
    if (await exists(path)) await remove(path, { recursive: true })
  } catch { /* ignore cleanup failures */ }
}
