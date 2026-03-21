<script setup lang="ts">
/**
 * SpacePreviewPage — Standalone space renderer for preview windows.
 *
 * Opened via `openSpacePreview(spaceId)` in a new Tauri webview window.
 * Loads the space IIFE, renders it, and watches for rebuilds to hot-reload.
 * Used for testing spaces during development without disrupting the main window.
 *
 * Route: /preview/:spaceName
 */

import { loadSpace, reloadSpace, type LoadedSpace } from '@/space_loader/SpaceLoader'
import { getSpaceManifestPath } from '@/lib/appPaths'
import { Loader2, AlertCircle, RefreshCw } from 'lucide-vue-next'
import { shallowRef, markRaw } from 'vue'

const props = defineProps<{
  spaceName: string
  subPage?: string
}>()

const space = shallowRef<LoadedSpace | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const reloadCount = ref(0)

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

function applyLoaded(loaded: LoadedSpace | null) {
  if (loaded) {
    Object.keys(loaded.pages).forEach(k => {
      loaded.pages[k] = markRaw(loaded.pages[k])
    })
  }
  space.value = loaded
  if (!space.value) {
    error.value = `Space "${props.spaceName}" not found`
  }
}

async function load() {
  loading.value = true
  error.value = null
  try {
    const loaded = await loadSpace(props.spaceName)
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
    const reloaded = await reloadSpace(props.spaceName)
    applyLoaded(reloaded)
    reloadCount.value++
  } catch (err) {
    error.value = `Failed to reload: ${err}`
  } finally {
    loading.value = false
  }
}

// Poll for changes (works in both dev and prod for preview windows)
let pollStopped = false
async function startPolling() {
  try {
    const { readTextFile } = await import('@tauri-apps/plugin-fs')
    const { homeDir } = await import('@tauri-apps/api/path')
    const home = await homeDir()
    const manifestPath = getSpaceManifestPath(home, props.spaceName)

    let lastBuiltAt = ''
    try {
      const json = JSON.parse(await readTextFile(manifestPath))
      lastBuiltAt = json.build?.builtAt || ''
    } catch { /* ignore */ }

    const poll = async () => {
      if (pollStopped) return
      try {
        const json = JSON.parse(await readTextFile(manifestPath))
        const builtAt = json.build?.builtAt || ''
        if (builtAt && builtAt !== lastBuiltAt) {
          lastBuiltAt = builtAt
          console.log(`[Preview] Reloading "${props.spaceName}"...`)
          const reloaded = await reloadSpace(props.spaceName)
          applyLoaded(reloaded)
          reloadCount.value++
        }
      } catch { /* file may be mid-write */ }
      if (!pollStopped) setTimeout(poll, 1500)
    }

    setTimeout(poll, 1500)
  } catch {
    // Not in Tauri — skip polling
  }
}

onMounted(async () => {
  await load()
  startPolling()
})

onUnmounted(() => {
  pollStopped = true
})
</script>

<template>
  <div class="h-screen flex flex-col bg-[var(--app-background)] text-[var(--app-foreground)]">
    <!-- Preview toolbar -->
    <div class="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--app-border)] bg-[var(--app-background)] shrink-0" data-tauri-drag-region>
      <div class="flex items-center gap-2 flex-1" data-tauri-drag-region>
        <span class="text-xs font-medium text-[var(--app-muted)]">PREVIEW</span>
        <span class="text-xs text-[var(--app-foreground)]">{{ space?.manifest?.name ?? spaceName }}</span>
        <span v-if="reloadCount" class="text-[10px] text-[var(--app-muted)]">
          (reloaded {{ reloadCount }}x)
        </span>
      </div>
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
    <div v-else-if="currentPage" class="flex-1 overflow-hidden">
      <component
        :is="currentPage"
        :key="`preview-${spaceName}-${currentPagePath}-${reloadCount}`"
      />
    </div>

    <!-- No page -->
    <div v-else class="flex-1 flex items-center justify-center">
      <p class="text-sm text-[var(--app-muted)]">No page to display</p>
    </div>
  </div>
</template>
