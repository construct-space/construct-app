<script setup lang="ts">
/**
 * SpacePreviewShell — Lightweight shell for preview windows.
 *
 * Opened via `openWindow({ type: 'space-preview', spaceId })` in a separate
 * Tauri webview window. Intentionally NOT MainShell — preview windows must
 * stay cheap to boot: no project store, no operator, no agent runtime.
 *
 * What it does provide (to match "installed-space" feel):
 *   - Subspace switcher in the left rail (from `.construct/project.json`)
 *   - Page navigation within the current space (from manifest.pages)
 *   - Toolbar teleport targets (#toolbar-left/center/right) + manifest toolbar items
 *   - Hot reload on manifest changes
 *   - onErrorCaptured surfacing so space crashes don't blank the window
 *
 * Route: /preview/:spaceName, /preview/:spaceName/:subPage(.*)
 */

import { useUniversalBootstrap } from '@/composables/useUniversalBootstrap'
import { startChildMirror } from '@/lib/crossWindow/childMirror'
import { loadSpace, reloadSpace, loadSpaceFromDir, type LoadedSpace } from '@/space_loader/SpaceLoader'
import { getSpaceIdFromDirName } from '@/lib/appPaths'
import { isSpaceBundleEntry, resolveInstalledSpaceDir, resolveSpaceBundleDir, resolveSpaceDirFromBase } from '@/space_loader/spaceBundleResolver'
import { installKeyGuard } from '@/lib/keyGuard'
import { Loader2, AlertCircle, RefreshCw, Box } from 'lucide-vue-next'
import { shallowRef, markRaw, computed, onErrorCaptured, watch } from 'vue'

// Install before the space IIFE evaluates — wraps window/document
// addEventListener so space key handlers yield to focused host inputs.
installKeyGuard()
useUniversalBootstrap()

interface SubspaceEntry {
  id: string
  name: string
  dir: string           // relative to project root, e.g. "space-docs"
  manifestPath?: string
}

const route = useRoute()
const router = useRouter()

const spaceName = computed(() => (route.params.spaceName as string) ?? '')
const projectPath = computed(() => {
  const raw = route.query.dir
  return typeof raw === 'string' && raw ? raw : undefined
})
const subPage = computed(() => {
  const raw = route.params.subPage
  if (!raw) return ''
  return Array.isArray(raw) ? raw.join('/') : String(raw)
})

const space = shallowRef<LoadedSpace | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const reloadCount = ref(0)

// Normalized current page path — strip leading slashes so it matches
// manifest entries (some declare `/overview`, some just `overview`)
// without the highlight breaking on nested routes like `/tasks/abc`.
const currentPagePath = computed(() => (subPage.value ?? '').replace(/^\/+/, ''))

function normalize(p: string | undefined | null): string {
  return (p ?? '').replace(/^\/+/, '')
}

// Resolve the parent project root from projectPath. Preview windows are
// opened with `dir=<project>/space-<id>/dist`; strip the two trailing
// segments to get the project root for subspace enumeration.
const projectRoot = computed<string | null>(() => {
  const p = projectPath.value
  if (!p) return null
  const parts = p.split('/')
  if (parts[parts.length - 1] === 'dist' && parts.length >= 3) {
    return parts.slice(0, -2).join('/')
  }
  // Caller already passed the project root (rare for preview windows).
  return p
})

const projectSubspaces = ref<SubspaceEntry[]>([])

async function loadProjectSubspaces() {
  projectSubspaces.value = []
  const root = projectRoot.value
  if (!root) return
  try {
    const { readTextFile, exists } = await import('@tauri-apps/plugin-fs')
    const manifest = `${root}/.construct/project.json`
    if (!(await exists(manifest))) return
    const raw = await readTextFile(manifest)
    const parsed = JSON.parse(raw) as { spaces?: SubspaceEntry[] }
    projectSubspaces.value = (parsed.spaces ?? []).filter(s => s && s.id && s.dir)
  } catch {
    // Missing/unreadable project.json is fine — we just render without
    // the subspace rail.
  }
}

watch(projectRoot, loadProjectSubspaces, { immediate: true })

const currentPage = computed(() => {
  if (!space.value?.pages) return null
  const key = currentPagePath.value
  if (space.value.pages[key]) return space.value.pages[key]
  // Parameterized route fallback: if a page is declared as `:id` and the
  // current path is a single segment, match it.
  for (const k of Object.keys(space.value.pages)) {
    if (k.startsWith(':') && key && !key.includes('/')) {
      return space.value.pages[k]
    }
  }
  return null
})

// Pages of the loaded space for secondary navigation. Drop
// parameterized routes — no concrete value to navigate to.
const spacePages = computed(() => {
  if (!space.value?.manifest?.pages) return []
  return (space.value.manifest.pages as Array<{ path?: string; label?: string; icon?: string }>)
    .filter(p => typeof p.path === 'string' && !p.path.includes(':'))
    .map((p) => ({
      path: normalize(p.path),
      label: p.label || p.path || 'Home',
      icon: p.icon,
    }))
})

// Manifest toolbar items for the current page.
const toolbarItems = computed(() => {
  const pages = space.value?.manifest?.pages as
    | Array<{ path?: string; toolbar?: Array<{ id: string; label?: string; icon?: string }> }>
    | undefined
  if (!pages || !pages.length) return []
  const here = currentPagePath.value
  const pageDef = pages.find(p => normalize(p.path) === here) || pages[0]
  return pageDef?.toolbar ?? []
})

function navigateToPage(pagePath: string) {
  const base = `/preview/${spaceName.value}`
  const normalized = normalize(pagePath)
  const path = normalized ? `${base}/${normalized}` : base
  const query = projectPath.value ? { dir: projectPath.value } : undefined
  router.push({ path, query })
}

function navigateToSubspace(entry: SubspaceEntry) {
  if (!projectRoot.value) return
  const newDir = `${projectRoot.value}/${entry.dir}/dist`
  router.push({
    path: `/preview/${entry.id}`,
    query: { dir: newDir },
  })
}

function isActivePage(pagePath: string): boolean {
  const target = normalize(pagePath)
  const current = currentPagePath.value
  if (!target) return current === '' // home
  return current === target || current.startsWith(`${target}/`)
}

function applyLoaded(loaded: LoadedSpace | null) {
  if (loaded) {
    Object.keys(loaded.pages).forEach(k => {
      loaded.pages[k] = markRaw(loaded.pages[k])
    })
  }
  space.value = loaded
  if (!space.value) {
    error.value = `Space "${spaceName.value}" not found`
  }
}

async function resolveProjectManifestPath(dir: string, fallbackId?: string): Promise<string | null> {
  try {
    const { readDir, exists } = await import('@tauri-apps/plugin-fs')
    if (await exists(`${dir}/manifest.json`)) return `${dir}/manifest.json`
    if (fallbackId) {
      const spaceDir = await resolveSpaceDirFromBase(fallbackId, dir)
      if (await exists(`${spaceDir}/manifest.json`)) return `${spaceDir}/manifest.json`
    }

    for (const parent of [dir, `${dir}/dist`]) {
      try {
        const entries = await readDir(parent)
        const bundle = entries.find(e => isSpaceBundleEntry(e))
        const id = bundle?.name ? getSpaceIdFromDirName(bundle.name) : null
        if (bundle?.name && id) {
          const spaceDir = await resolveSpaceBundleDir(id, `${parent}/${bundle.name}`)
          if (await exists(`${spaceDir}/manifest.json`)) return `${spaceDir}/manifest.json`
        }
      } catch { /* ignore missing dirs */ }
    }
  } catch { /* ignore */ }
  return null
}

async function resolveProjectSpaceId(dir: string): Promise<string | null> {
  try {
    const { readTextFile } = await import('@tauri-apps/plugin-fs')
    const manifestPath = await resolveProjectManifestPath(dir, spaceName.value)
    if (!manifestPath) return null
    const raw = await readTextFile(manifestPath)
    return JSON.parse(raw).id || null
  } catch {
    return null
  }
}

async function load() {
  loading.value = true
  error.value = null
  try {
    const loaded = projectPath.value
      ? await loadSpaceFromDir(
          await resolveProjectSpaceId(projectPath.value) || spaceName.value || 'dev',
          projectPath.value,
        )
      : await loadSpace(spaceName.value)
    applyLoaded(loaded)
  } catch (err) {
    error.value = `Failed to load: ${err}`
  } finally {
    loading.value = false
  }
}

async function manualReload() {
  loading.value = true
  error.value = null
  try {
    const reloaded = projectPath.value
      ? await loadSpaceFromDir(
          await resolveProjectSpaceId(projectPath.value) || spaceName.value || 'dev',
          projectPath.value,
        )
      : await reloadSpace(spaceName.value)
    applyLoaded(reloaded)
    reloadCount.value++
  } catch (err) {
    error.value = `Failed to reload: ${err}`
  } finally {
    loading.value = false
  }
}

// Surface runtime errors from the loaded space's Vue tree instead of
// leaving a blank window when a page throws during render.
onErrorCaptured((err) => {
  error.value = `Space error: ${err}`
  loading.value = false
  console.error('[Preview] Space error:', err)
  return false
})

let mirrorUnlistens: (() => void)[] = []
let stopPolling: (() => void) | null = null

async function startPolling() {
  try {
    const { pollManifestChanges } = await import('@/utils/spacePolling')
    let manifestPath: string

    if (projectPath.value) {
      const id = await resolveProjectSpaceId(projectPath.value) || spaceName.value
      manifestPath = await resolveProjectManifestPath(projectPath.value, id) || `${projectPath.value}/${id}.space/manifest.json`
    } else {
      const { homeDir } = await import('@tauri-apps/api/path')
      const home = await homeDir()
      const spaceDir = await resolveInstalledSpaceDir(home, spaceName.value)
      manifestPath = `${spaceDir}/manifest.json`
    }

    stopPolling = await pollManifestChanges(
      manifestPath,
      async (manifest) => {
        console.log(`[Preview] Reloading "${spaceName.value}"...`)
        const reloaded = projectPath.value
          ? await loadSpaceFromDir(
              (manifest?.id as string | undefined) || await resolveProjectSpaceId(projectPath.value) || spaceName.value || 'dev',
              projectPath.value,
            )
          : await reloadSpace(spaceName.value)
        applyLoaded(reloaded)
        reloadCount.value++
      },
      { interval: 1500 },
    )
  } catch {
    // Not in Tauri — skip polling.
  }
}

watch([spaceName, projectPath], async () => {
  stopPolling?.()
  stopPolling = null
  await load()
  await startPolling()
})

onMounted(async () => {
  await load()
  await startPolling()
  mirrorUnlistens = await startChildMirror()
})

onUnmounted(() => {
  stopPolling?.()
  for (const fn of mirrorUnlistens) fn()
  mirrorUnlistens = []
})
</script>

<template>
  <div class="h-screen flex flex-col bg-[var(--app-background)] text-[var(--app-foreground)]">
    <!-- Toolbar -->
    <div
      class="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--app-border)] bg-[var(--app-background)] shrink-0"
      data-tauri-drag-region
    >
      <!-- Left: badge + space name -->
      <div class="flex items-center gap-2" data-tauri-drag-region>
        <span
          class="text-[10px] font-bold tracking-wider text-[var(--app-muted)] bg-[color-mix(in_srgb,var(--app-muted)_10%,transparent)] px-1.5 py-0.5 rounded"
        >PREVIEW</span>
        <template v-if="space">
          <Icon
            v-if="space.manifest.icon"
            :name="space.manifest.icon"
            class="size-3.5 text-[var(--app-muted)]"
          />
          <span class="text-xs font-medium">{{ space.manifest.name }}</span>
          <span class="text-[10px] text-[var(--app-muted)]">v{{ space.manifest.version }}</span>
        </template>
        <span v-if="reloadCount" class="text-[10px] text-[var(--app-muted)]">
          (reloaded {{ reloadCount }}x)
        </span>
      </div>

      <!-- Teleport targets for space pages -->
      <div id="toolbar-left" class="flex items-center" />
      <div class="flex-1" data-tauri-drag-region />
      <div id="toolbar-center" class="flex items-center gap-1" />
      <div class="flex-1" data-tauri-drag-region />
      <div id="toolbar-right" class="flex items-center gap-0.5" />

      <!-- Manifest toolbar items for the current page -->
      <template v-for="item in toolbarItems" :key="item.id">
        <button
          class="p-1 rounded hover:bg-[color-mix(in_srgb,var(--app-muted)_10%,transparent)] text-[var(--app-muted)] hover:text-[var(--app-foreground)] transition-colors"
          :title="item.label"
        >
          <Icon v-if="item.icon" :name="item.icon" class="size-3.5" />
        </button>
      </template>

      <button
        class="p-1 rounded hover:bg-[color-mix(in_srgb,var(--app-muted)_10%,transparent)] text-[var(--app-muted)] hover:text-[var(--app-foreground)] transition-colors"
        title="Reload space (Cmd+R)"
        @click="manualReload"
      >
        <RefreshCw class="size-3.5" />
      </button>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <div class="flex items-center gap-3 text-[var(--app-muted)]">
        <Loader2 class="size-5 animate-spin" />
        <span class="text-sm">Loading {{ spaceName }}...</span>
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="flex-1 flex items-center justify-center">
      <div class="text-center max-w-sm">
        <AlertCircle class="size-10 text-red-400 mx-auto mb-4" />
        <p class="text-sm text-[var(--app-muted)] mb-4">{{ error }}</p>
        <button
          class="px-4 py-2 rounded-lg border border-[var(--app-border)] text-sm hover:bg-[color-mix(in_srgb,var(--app-muted)_5%,transparent)] transition-colors"
          @click="manualReload"
        >
          Retry
        </button>
      </div>
    </div>

    <!-- Space content -->
    <div v-else-if="space" class="flex-1 flex overflow-hidden">
      <!-- Subspace icon rail (project has sibling spaces) -->
      <div
        v-if="projectSubspaces.length > 0"
        class="w-12 shrink-0 border-r border-[var(--app-border)] bg-[color-mix(in_srgb,var(--app-background)_95%,black)] flex flex-col items-center py-2 gap-1"
      >
        <button
          v-for="entry in projectSubspaces"
          :key="entry.id"
          class="w-9 h-9 rounded-lg flex items-center justify-center transition-all"
          :class="spaceName === entry.id
            ? 'bg-[color-mix(in_srgb,var(--app-accent,#6366f1)_15%,transparent)] text-[var(--app-accent,#6366f1)]'
            : 'text-[var(--app-muted)] hover:text-[var(--app-foreground)] hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)]'"
          :title="entry.name"
          @click="navigateToSubspace(entry)"
        >
          <Box class="size-4" />
        </button>
      </div>

      <!-- Page sidebar (this space has multiple pages) -->
      <div
        v-if="spacePages.length > 1"
        class="w-40 shrink-0 border-r border-[var(--app-border)] overflow-y-auto py-2"
      >
        <button
          v-for="page in spacePages"
          :key="page.path"
          class="w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center gap-2"
          :class="isActivePage(page.path)
            ? 'text-[var(--app-foreground)] bg-[var(--app-accent)]/10 font-medium'
            : 'text-[var(--app-muted)] hover:text-[var(--app-foreground)] hover:bg-[color-mix(in_srgb,var(--app-foreground)_3%,transparent)]'"
          @click="navigateToPage(page.path)"
        >
          <Icon
            v-if="page.icon"
            :name="page.icon"
            class="size-3.5 shrink-0"
          />
          <span>{{ page.label }}</span>
        </button>
      </div>

      <!-- Page content with scroll -->
      <div class="flex-1 overflow-auto">
        <component
          v-if="currentPage"
          :is="currentPage"
          :key="`preview-${spaceName}-${currentPagePath}-${reloadCount}`"
        />
        <div v-else class="flex items-center justify-center h-full">
          <p class="text-sm text-[var(--app-muted)]">Page not found: {{ currentPagePath }}</p>
        </div>
      </div>
    </div>

    <!-- No page -->
    <div v-else class="flex-1 flex items-center justify-center">
      <p class="text-sm text-[var(--app-muted)]">No page to display</p>
    </div>
  </div>
</template>
