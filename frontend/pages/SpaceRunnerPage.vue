<script setup lang="ts">
/**
 * SpaceRunnerPage — Standalone space window.
 *
 * Two modes:
 *   1. Popout: /runner/coder?project=/path  — detach a space from the main window
 *   2. Preview: /runner/myspace?dir=/path   — test a dev space from project dir
 *
 * Reserved query params:
 *   - dir     → load IIFE from this path (dev preview mode, shows sidebar)
 *   - project → set project context via projectStore.openProject()
 *
 * Route: /runner, /runner/:spaceName, /runner/:spaceName/:subPage
 */

import { onErrorCaptured, watch } from 'vue'
import { loadSpace, reloadSpace, loadSpaceFromDir, type LoadedSpace } from '@/space_loader/SpaceLoader'
import { getCoreSpaceManifests, DEVELOPER_ONLY_SPACES } from '@/space_loader/coreSpaces'
import { isSpaceBundleEntry, resolveSpaceBundleDir, resolveSpaceDirFromBase } from '@/space_loader/spaceBundleResolver'
import { getSpaceIdFromDirName } from '@/lib/appPaths'
import { useProjectStore } from '@/stores/project'
import { installKeyGuard } from '@/lib/keyGuard'
import { Loader2, AlertCircle, RefreshCw, Play } from 'lucide-vue-next'
import { shallowRef, markRaw } from 'vue'

// Runner windows load space IIFEs too — protect host inputs the same way.
installKeyGuard()

interface SubspaceEntry {
  id: string
  name: string
  dir: string           // relative to project root, e.g. "space-docs"
  manifestPath: string  // relative to project root
}

const props = defineProps<{
  spaceName?: string | null
  subPage?: string
  /** Dev preview: load IIFE bundle from this directory */
  projectPath?: string
  /** Popout: set project context */
  project?: string
}>()

const router = useRouter()
const projectStore = useProjectStore()
const space = shallowRef<LoadedSpace | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const reloadCount = ref(0)

// Dev preview mode = has projectPath (dir param). Shows sidebar for browsing.
// Popout mode = no projectPath. No sidebar — single detached space.
const isPreviewMode = computed(() => !!props.projectPath)

// Project subspaces loaded from `.construct/project.json`. Populated async
// whenever `props.project` changes. When present, the sidebar shows these
// (the project's own spaces) instead of the host's core spaces.
const projectSubspaces = ref<SubspaceEntry[]>([])

async function loadProjectSubspaces() {
  projectSubspaces.value = []
  const root = props.project
  if (!root) return
  try {
    const { readTextFile, exists } = await import('@tauri-apps/plugin-fs')
    const manifest = `${root}/.construct/project.json`
    if (!(await exists(manifest))) return
    const raw = await readTextFile(manifest)
    const parsed = JSON.parse(raw) as { spaces?: SubspaceEntry[] }
    projectSubspaces.value = (parsed.spaces ?? []).filter(s => s && s.id && s.dir)
  } catch {
    // ignore — sidebar will fall back to core spaces
  }
}

watch(() => props.project, loadProjectSubspaces, { immediate: true })

// Sidebar entries in preview mode. Priority order:
//   1. Pages of the currently-loaded space (from its manifest). Lets the
//      user jump between the space's OWN pages — this is what they actually
//      want to test. Static route params like `:id` are skipped (can't
//      navigate to them without a real value).
//   2. Fallback: sibling subspaces declared in `.construct/project.json`.
//      Shown only when the space has zero/one navigable pages — so a
//      multi-space project still gets a switcher.
//   3. Never the host's core spaces — those belong in the main app shell,
//      not the space preview.
interface SidebarEntry {
  id: string             // space id for subspace; page path for page
  name: string
  icon?: string
  kind: 'page' | 'subspace'
  path?: string          // page: the route path relative to the space
  dir?: string           // subspace: dir relative to project root
}

const spaceManifestPages = computed<SidebarEntry[]>(() => {
  const pages = (space.value?.manifest?.pages ?? []) as Array<{
    path?: string
    label?: string
    icon?: string
    hidden?: boolean
  }>
  return pages
    // Skip pages flagged hidden (detail/[param] views) — matches the main
    // shell's DynamicSpacePage filter — and dynamic/parameterized routes
    // (both `:id` and `[id]` forms) that there's nothing to navigate to.
    .filter(p => typeof p.path === 'string' && !p.hidden && !p.path.includes(':') && !/\[.*\]/.test(p.path))
    .map((p, i) => ({
      id: p.path || '__home__',
      name: p.label || (p.path ? p.path : 'Home'),
      icon: p.icon || (i === 0 ? 'lucide:home' : 'lucide:file'),
      kind: 'page' as const,
      path: p.path ?? '',
    }))
})

const sidebarSpaces = computed<SidebarEntry[]>(() => {
  if (!isPreviewMode.value) return []
  // Prefer the loaded space's own pages — users navigate pages, not the
  // host app, while previewing.
  if (spaceManifestPages.value.length >= 2) {
    return spaceManifestPages.value
  }
  // Single-page space: offer sibling subspaces as a switcher.
  if (projectSubspaces.value.length > 0) {
    return projectSubspaces.value.map(s => ({
      id: s.id,
      name: s.name,
      icon: 'lucide:box',
      kind: 'subspace' as const,
      dir: s.dir,
    }))
  }
  // Single space, single page — still show the space's single page so the
  // sidebar doesn't render a collection of unrelated host icons.
  return spaceManifestPages.value
})

// All available spaces — used for the landing page picker (both modes)
const allSpaces = computed(() => {
  return getCoreSpaceManifests()
    .filter(m => !DEVELOPER_ONLY_SPACES.has(m.id))
    .sort((a, b) => (a.navigation?.order ?? 99) - (b.navigation?.order ?? 99))
})

const currentPagePath = computed(() => props.subPage ?? '')

const currentPage = computed(() => {
  if (!space.value?.pages) return null
  if (space.value.pages[currentPagePath.value]) {
    return space.value.pages[currentPagePath.value]
  }
  for (const key of Object.keys(space.value.pages)) {
    if (key.startsWith(':') && currentPagePath.value && !currentPagePath.value.includes('/')) {
      return space.value.pages[key]
    }
  }
  return null
})

// Toolbar items from manifest (only for dynamic/dev spaces, not core)
const toolbarItems = computed(() => {
  if (!space.value?.manifest?.pages) return []
  const pageDef = space.value.manifest.pages.find(
    (p: { path: string }) => p.path === currentPagePath.value
  ) || space.value.manifest.pages[0]
  return pageDef?.toolbar ?? []
})

function applyLoaded(loaded: LoadedSpace | null) {
  if (loaded) {
    Object.keys(loaded.pages).forEach(k => {
      loaded.pages[k] = markRaw(loaded.pages[k])
    })
  }
  space.value = loaded
  if (!loaded) {
    error.value = `Space "${props.spaceName}" not found`
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
    const manifestPath = await resolveProjectManifestPath(dir, props.spaceName || undefined)
    if (!manifestPath) return null
    const raw = await readTextFile(manifestPath)
    return JSON.parse(raw).id || null
  } catch { return null }
}

// Set project context if provided — openProject creates a minimal entry
// if the project isn't already in the store, so no full initialize() needed.
function initProjectContext() {
  console.log('[Runner] initProjectContext, project prop:', props.project)
  if (props.project) {
    projectStore.openProject(props.project)
    console.log('[Runner] openProject done, currentProject:', projectStore.currentProject?.path)
  }
}

async function load() {
  if (!props.spaceName && !props.projectPath) {
    loading.value = false
    return
  }

  loading.value = true
  error.value = null

  try {
    let loaded: LoadedSpace | null = null

    if (props.projectPath) {
      const realId = await resolveProjectSpaceId(props.projectPath) || props.spaceName || 'dev'
      console.log(`[Runner] Loading from dir: ${props.projectPath}, id: ${realId}`)
      loaded = await loadSpaceFromDir(realId, props.projectPath)
      console.log('[Runner] Loaded:', loaded ? `${Object.keys(loaded.pages).length} pages` : 'null')
    } else if (props.spaceName) {
      loaded = await loadSpace(props.spaceName)
    }

    applyLoaded(loaded)
  } catch (err) {
    console.error('[Runner] Load error:', err)
    error.value = `Failed to load: ${err}`
  } finally {
    loading.value = false
  }
}

async function manualReload() {
  if (!props.spaceName && !props.projectPath) return
  loading.value = true
  error.value = null

  try {
    let loaded: LoadedSpace | null = null

    if (props.projectPath) {
      const realId = await resolveProjectSpaceId(props.projectPath) || props.spaceName || 'dev'
      loaded = await loadSpaceFromDir(realId, props.projectPath)
    } else if (props.spaceName) {
      loaded = await reloadSpace(props.spaceName)
    }

    applyLoaded(loaded)
    reloadCount.value++
  } catch (err) {
    error.value = `Failed to reload: ${err}`
  } finally {
    loading.value = false
  }
}

function navigateToSpace(entry: SidebarEntry) {
  const query: Record<string, string> = {}
  if (props.project) query.project = props.project

  if (entry.kind === 'page') {
    // Same space, different page — keep the loaded bundle, swap the subPage.
    if (props.projectPath) query.dir = props.projectPath
    const spaceSeg = props.spaceName ?? space.value?.id ?? ''
    const pagePath = (entry.path ?? '').replace(/^\/+/, '')
    const path = pagePath
      ? `/runner/${spaceSeg}/${pagePath}`
      : `/runner/${spaceSeg}`
    router.push({ path, query })
    return
  }

  if (entry.kind === 'subspace' && entry.dir && props.project) {
    // Different space in the same project — swap dir to its dist bundle.
    query.dir = `${props.project}/${entry.dir}/dist`
    router.push({ path: `/runner/${entry.id}`, query })
    return
  }

  if (props.projectPath) query.dir = props.projectPath
  router.push({ path: `/runner/${entry.id}`, query })
}

// HMR: poll manifest for changes (preview mode only)
let stopPolling: (() => void) | null = null

async function startPolling() {
  if (!props.spaceName || !props.projectPath) return

  try {
    const { pollManifestChanges } = await import('@/utils/spacePolling')
    const realId = await resolveProjectSpaceId(props.projectPath) || props.spaceName || 'dev'
    const manifestPath = await resolveProjectManifestPath(props.projectPath, realId) || `${props.projectPath}/${realId}.space/manifest.json`

    stopPolling = await pollManifestChanges(
      manifestPath,
      async (manifest) => {
        console.log(`[Runner] Reloading "${props.spaceName}"...`)
        const realId = (manifest.id as string) || props.spaceName || 'dev'
        const reloaded = await loadSpaceFromDir(realId, props.projectPath!)
        applyLoaded(reloaded)
        reloadCount.value++
      },
      { interval: 1500 },
    )
  } catch { /* Not in Tauri */ }
}

// Catch space component render errors
onErrorCaptured((err) => {
  error.value = `Space error: ${err}`
  loading.value = false
  console.error('[Runner] Space error:', err)
  return false
})

onMounted(async () => {
  initProjectContext()
  await load()
  startPolling()
})

onUnmounted(() => { stopPolling?.() })

watch(() => props.spaceName, async (newName) => {
  if (newName) {
    stopPolling?.()
    stopPolling = null
    await load()
    startPolling()
  }
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
        <span class="text-[10px] font-bold tracking-wider text-[var(--app-muted)] bg-[color-mix(in_srgb,var(--app-muted)_10%,transparent)] px-1.5 py-0.5 rounded">
          {{ isPreviewMode ? 'PREVIEW' : 'RUNNER' }}
        </span>
        <template v-if="space">
          <Icon v-if="space.manifest.icon" :name="space.manifest.icon" class="size-3.5 text-[var(--app-muted)]" />
          <span class="text-xs font-medium">{{ space.manifest.name }}</span>
          <span v-if="isPreviewMode" class="text-[10px] text-[var(--app-muted)]">v{{ space.manifest.version }}</span>
        </template>
        <span v-if="reloadCount" class="text-[10px] text-[var(--app-muted)]">
          (reloaded {{ reloadCount }}x)
        </span>
      </div>

      <!-- Teleport targets for space pages (same IDs as Toolbar3D) -->
      <div id="toolbar-left" class="flex items-center" />
      <div class="flex-1" data-tauri-drag-region />
      <div id="toolbar-center" class="flex items-center gap-1" />
      <div class="flex-1" data-tauri-drag-region />
      <div id="toolbar-right" class="flex items-center gap-0.5" />

      <!-- Manifest toolbar items -->
      <template v-for="item in toolbarItems" :key="item.id">
        <button
          class="p-1 rounded hover:bg-[color-mix(in_srgb,var(--app-muted)_10%,transparent)] text-[var(--app-muted)] hover:text-[var(--app-foreground)] transition-colors"
          :title="item.label"
        >
          <Icon v-if="item.icon" :name="item.icon" class="size-3.5" />
        </button>
      </template>

      <button
        v-if="isPreviewMode && spaceName"
        class="p-1 rounded hover:bg-[color-mix(in_srgb,var(--app-muted)_10%,transparent)] text-[var(--app-muted)] hover:text-[var(--app-foreground)] transition-colors"
        title="Reload space"
        @click="manualReload"
      >
        <RefreshCw class="size-3.5" />
      </button>
    </div>

    <div class="flex flex-1 overflow-hidden">
      <!-- Sidebar (preview mode only) -->
      <div
        v-if="isPreviewMode"
        class="w-12 shrink-0 border-r border-[var(--app-border)] bg-[color-mix(in_srgb,var(--app-background)_95%,black)] flex flex-col items-center py-2 gap-1"
      >
        <button
          v-for="entry in sidebarSpaces"
          :key="entry.id"
          class="w-9 h-9 rounded-lg flex items-center justify-center transition-all"
          :class="[
            spaceName === entry.id
              ? 'bg-[color-mix(in_srgb,var(--app-accent,#6366f1)_15%,transparent)] text-[var(--app-accent,#6366f1)]'
              : 'text-[var(--app-muted)] hover:text-[var(--app-foreground)] hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)]'
          ]"
          :title="entry.name"
          @click="navigateToSpace(entry)"
        >
          <Icon :name="entry.icon || 'lucide:circle'" class="size-4.5" />
        </button>
      </div>

      <!-- Content -->
      <div class="flex-1 overflow-hidden">
        <!-- Loading -->
        <div v-if="loading" class="h-full flex items-center justify-center">
          <div class="flex items-center gap-3 text-[var(--app-muted)]">
            <Loader2 class="size-5 animate-spin" />
            <span class="text-sm">Loading {{ spaceName }}...</span>
          </div>
        </div>

        <!-- Error -->
        <div v-else-if="error" class="h-full flex items-center justify-center">
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

        <!-- No space selected — show space picker -->
        <div v-else-if="!spaceName" class="h-full flex items-center justify-center">
          <div class="text-center max-w-md">
            <Play class="size-10 text-[var(--app-muted)] mx-auto mb-4 opacity-40" />
            <p class="text-sm text-[var(--app-muted)] mb-6">Select a space to run</p>
            <div v-if="allSpaces.length" class="grid grid-cols-2 gap-2">
              <button
                v-for="manifest in allSpaces"
                :key="manifest.id"
                class="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--app-border)] text-sm hover:bg-[color-mix(in_srgb,var(--app-muted)_5%,transparent)] transition-colors text-left"
                @click="router.push({ path: `/runner/${manifest.id}`, query: props.project ? { project: props.project } : {} })"
              >
                <Icon :name="manifest.navigation?.icon || manifest.icon || 'lucide:circle'" class="size-4 text-[var(--app-muted)]" />
                <span>{{ manifest.name }}</span>
              </button>
            </div>
            <p v-else class="text-xs text-[var(--app-muted)] opacity-60">No spaces installed</p>
          </div>
        </div>

        <!-- Space content -->
        <div v-else-if="currentPage" class="h-full overflow-hidden">
          <component
            :is="currentPage"
            :key="`runner-${spaceName}-${currentPagePath}-${reloadCount}`"
          />
        </div>

        <!-- No page found -->
        <div v-else class="h-full flex items-center justify-center">
          <p class="text-sm text-[var(--app-muted)]">No page to display</p>
        </div>
      </div>
    </div>
  </div>
</template>
