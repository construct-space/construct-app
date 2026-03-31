<script setup lang="ts">
/**
 * DynamicSpacePage — renderer for dynamic (non-host-native) spaces.
 *
 * Host-native spaces (architect, brainstorm, coder, project) have their own
 * explicit routes in `router/routes.ts` and do NOT go through this component.
 *
 * Dynamic spaces — installed from the marketplace or linked via `construct dev` —
 * are loaded at runtime from IIFE bundles on disk via SpaceLoader.
 *
 * Uses SpaceLoader to get Vue components, renders with <component :is>.
 * Falls back to agent-powered placeholder for config-only spaces (no Vue bundle).
 */

import { loadSpace, watchSpace, getLastLoadError, clearLastLoadError, type LoadedSpace, type SpaceLoadError } from '@/space_loader/SpaceLoader'
import { getSpace as getSpaceTheme } from '@/config/spaces'
import { useSpaces } from '@/composables/useSpaces'
import { useTelemetry } from '@/composables/useTelemetry'
import { useSidebar, type SpaceNavItem } from '@/composables/useSidebar'
import { detectErrorPhase, getErrorActions, type ErrorAction } from '@/space_loader/errorActions'
import { Loader2, AlertCircle, ArrowRight, RefreshCw, ShoppingBag, Wrench } from 'lucide-vue-next'
import { shallowRef, markRaw } from 'vue'

/**
 * ActiveTimeTracker — monotonic timer that pauses when window is blurred/hidden.
 * Uses performance.now() to avoid system clock drift.
 */
class ActiveTimeTracker {
  private _accumulated = 0
  private _startedAt: number | null = null

  resume() {
    if (this._startedAt === null) {
      this._startedAt = performance.now()
    }
  }

  pause() {
    if (this._startedAt !== null) {
      this._accumulated += performance.now() - this._startedAt
      this._startedAt = null
    }
  }

  /** Returns accumulated ms and resets. */
  reset(): number {
    this.pause()
    const total = this._accumulated
    this._accumulated = 0
    return total
  }
}

const props = defineProps<{
  spaceName: string
  subPage?: string
  projectId?: string
}>()

const router = useRouter()
const route = useRoute()
const telemetry = useTelemetry()
const { enterSpace, exitSpace } = useSidebar()
const activeTracker = new ActiveTimeTracker()

const space = shallowRef<LoadedSpace | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const loadError = ref<SpaceLoadError | null>(null)

/** Actionable suggestions derived from the error message */
const errorActions = computed<ErrorAction[]>(() => {
  if (!error.value) return []
  const phase = detectErrorPhase(error.value)
  return getErrorActions(phase)
})

/** The current page path ('' for index, 'editor', 'terminal', etc.) */
const currentPagePath = computed(() => props.subPage ?? '')

/** The Vue component to render for the current page */
const currentPage = computed(() => {
  if (!space.value?.pages) return null
  // Exact match first
  if (space.value.pages[currentPagePath.value]) {
    return space.value.pages[currentPagePath.value]
  }
  // Dynamic param match — e.g. ':id' matches any single segment
  for (const key of Object.keys(space.value.pages)) {
    if (key.startsWith(':') && currentPagePath.value && !currentPagePath.value.includes('/')) {
      return space.value.pages[key]
    }
  }
  return null
})

/** Theme config for the space (colors, icon) */
const theme = computed(() => getSpaceTheme(props.spaceName))

/** Manifest data */
const manifest = computed(() => space.value?.manifest)

/** Apply markRaw to loaded space pages */
function applyLoaded(loaded: LoadedSpace | null) {
  if (loaded) {
    Object.keys(loaded.pages).forEach(k => {
      loaded.pages[k] = markRaw(loaded.pages[k])
    })
  }
  space.value = loaded
  if (!space.value) {
    // Capture structured error from SpaceLoader if available
    loadError.value = getLastLoadError()
    clearLastLoadError()
    if (loadError.value) {
      error.value = loadError.value.message
    } else {
      error.value = `Space "${props.spaceName}" is not installed.`
    }
  } else {
    loadError.value = null
    error.value = null
  }
}

/** Human-readable label for the error phase */
function phaseLabel(phase: string): string {
  const labels: Record<string, string> = {
    manifest: 'Manifest',
    validation: 'Validation',
    version: 'Version Check',
    checksum: 'Integrity Check',
    bundle: 'Bundle Loading',
    eval: 'Execution',
    export: 'Module Export',
  }
  return labels[phase] || phase
}

/** Suggested actions based on the error phase */
function suggestedActions(phase: string): string[] {
  switch (phase) {
    case 'manifest':
      return ['Reinstall the space from the marketplace', 'Check if the space files are intact']
    case 'validation':
      return ['The space manifest is malformed — reinstall or contact the developer']
    case 'version':
      return ['Rebuild the space with the latest Construct SDK', 'Check for space updates in the marketplace']
    case 'checksum':
      return ['The bundle file may be corrupted — reinstall the space', 'If developing, rebuild the space']
    case 'bundle':
      return ['Reinstall the space', 'Check disk space and permissions']
    case 'eval':
      return ['The space code has a runtime error — contact the developer', 'If developing, check the console for details']
    case 'export':
      return ['The space bundle is missing page exports — contact the developer', 'Rebuild the space']
    default:
      return ['Try reinstalling the space']
  }
}

/** Check if a space is disabled in marketplace settings */
function isSpaceDisabled(spaceId: string): boolean {
  try {
    const raw = localStorage.getItem('construct:installed_spaces')
    if (!raw) return false
    const items = JSON.parse(raw) as { id: string; enabled: boolean }[]
    const entry = items.find(s => s.id === spaceId)
    return entry?.enabled === false
  } catch {
    return false
  }
}

/** Rotate sidebar to Level 2 when a multi-page space is active */
function updateSidebarForSpace(loaded: LoadedSpace) {
  const pages = loaded.manifest?.pages
  if (!pages || pages.length <= 1) return

  const visiblePages = pages.filter(p => !(p as any).hidden)
  if (visiblePages.length <= 1) return

  const basePath = `/app/${props.spaceName}`
  const pageItems: SpaceNavItem[] = visiblePages.map(p => ({
    path: p.path,
    label: p.label || p.path || 'Home',
    icon: p.icon,
    route: p.path ? `${basePath}/${p.path}` : basePath,
    requiresContext: (p as any).requiresContext,
  }))
  enterSpace(props.spaceName, pageItems, '/app')
}

/** Load the space on mount and when spaceName changes */
async function load() {
  loading.value = true
  error.value = null
  try {
    if (isSpaceDisabled(props.spaceName)) {
      console.warn(`[DynamicSpacePage] "${props.spaceName}" is disabled`)
      error.value = `Space "${props.spaceName}" is disabled. Enable it in Settings > Spaces.`
      return
    }
    const loaded = await loadSpace(props.spaceName)
    applyLoaded(loaded)
    if (loaded) {
      // Rotate sidebar to show subspace pages if space has multiple pages
      // Only for standalone space routes (not project-scoped — ProjectLayout handles those)
      if (!props.projectId) {
        updateSidebarForSpace(loaded)
      }
    }
  } catch (err) {
    error.value = `Failed to load space "${props.spaceName}": ${err}`
    console.error('[DynamicSpacePage]', err)
  } finally {
    loading.value = false
  }
}

/** Dev mode HMR: watch the space bundle for changes and hot-reload */
let unwatchFn: (() => void) | null = null

async function setupDevWatcher() {
  // Clean up previous watcher
  unwatchFn?.()
  const { loadSpaces } = useSpaces()
  // watchSpace returns null if no dev session is active for this space
  unwatchFn = await watchSpace(props.spaceName, async (reloaded) => {
    applyLoaded(reloaded)
    // Refresh spaces list so sidebar/toolbar pick up manifest changes
    await loadSpaces()
  })
}

// Telemetry: pause/resume active time on visibility + focus changes
const handleVisibility = () => {
  if (document.visibilityState === 'hidden') activeTracker.pause()
  else activeTracker.resume()
}
const handleFocus = () => activeTracker.resume()
const handleBlur = () => activeTracker.pause()

function flushSpace(spaceId: string) {
  const activeMs = activeTracker.reset()
  telemetry.trackSpaceLeave(spaceId, activeMs)
}

onMounted(async () => {
  await load()
  await setupDevWatcher()

  // Telemetry: track space entry + start active time
  telemetry.trackSpaceEnter(props.spaceName)
  activeTracker.resume()
  document.addEventListener('visibilitychange', handleVisibility)
  window.addEventListener('construct:window-focus', handleFocus)
  window.addEventListener('construct:window-blur', handleBlur)
})

watch(() => props.spaceName, async (newSpace, oldSpace) => {
  // Flush old space telemetry before switching
  if (oldSpace) flushSpace(oldSpace)

  unwatchFn?.()
  await load()
  await setupDevWatcher()

  // Track new space entry
  telemetry.trackSpaceEnter(newSpace)
  activeTracker.resume()
})

onUnmounted(() => {
  unwatchFn?.()
  flushSpace(props.spaceName)
  // Exit sidebar space mode when leaving standalone space
  if (!props.projectId) {
    exitSpace()
  }
  document.removeEventListener('visibilitychange', handleVisibility)
  window.removeEventListener('construct:window-focus', handleFocus)
  window.removeEventListener('construct:window-blur', handleBlur)
})
</script>

<template>
  <div class="h-full flex flex-col">
<!-- Loading state -->
    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <div class="flex items-center gap-3 text-[var(--app-muted)]">
        <Loader2 class="size-5 animate-spin" />
        <span class="text-sm">Loading {{ spaceName }}...</span>
      </div>
    </div>

    <!-- Error state — detailed error boundary -->
    <div v-else-if="error" class="flex-1 flex items-center justify-center p-6">
      <div class="max-w-md w-full">
        <!-- Error icon and title -->
        <div class="text-center mb-6">
          <div class="size-14 rounded-2xl bg-red-500/10 flex items-center justify-center mx-auto mb-4">
            <AlertCircle class="size-7 text-red-400" />
          </div>
          <h2 class="text-lg font-semibold text-[var(--app-foreground)] mb-1">
            Failed to load {{ spaceName }}
          </h2>
          <p class="text-sm text-[var(--app-muted)]">{{ error }}</p>
        </div>

        <!-- Detailed error info when available -->
        <div v-if="loadError" class="mb-6 rounded-lg border border-[var(--app-border)] bg-[var(--app-background)] overflow-hidden">
          <!-- Error phase badge -->
          <div class="px-4 py-3 border-b border-[var(--app-border)] flex items-center gap-2">
            <Wrench class="size-4 text-[var(--app-muted)]" />
            <span class="text-xs font-medium text-[var(--app-muted)] uppercase tracking-wider">
              {{ phaseLabel(loadError.phase) }}
            </span>
          </div>

          <!-- Error details -->
          <div v-if="loadError.details?.length" class="px-4 py-3 space-y-1">
            <p
              v-for="(detail, i) in loadError.details"
              :key="i"
              class="text-xs text-[var(--app-muted)] font-mono"
            >
              {{ detail }}
            </p>
          </div>

          <!-- Suggested actions from error-to-action mapping -->
          <div class="px-4 py-3 border-t border-[var(--app-border)] bg-[color-mix(in_srgb,var(--app-muted)_3%,transparent)]">
            <p class="text-xs font-medium text-[var(--app-muted)] mb-2">Suggested actions:</p>
            <ul class="space-y-1">
              <li
                v-for="(action, i) in suggestedActions(loadError.phase)"
                :key="i"
                class="text-xs text-[var(--app-muted)] flex items-start gap-1.5"
              >
                <span class="mt-0.5 shrink-0">&#x2022;</span>
                <span>{{ action }}</span>
              </li>
            </ul>
          </div>
        </div>

        <!-- Action buttons -->
        <div class="flex gap-3 justify-center">
          <button
            class="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--app-border)] text-sm text-[var(--app-foreground)] hover:bg-[color-mix(in_srgb,var(--app-muted)_5%,transparent)] transition-colors"
            @click="router.push('/app/marketplace')"
          >
            <ShoppingBag class="size-4" />
            Marketplace
          </button>
          <button
            class="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--app-border)] text-sm text-[var(--app-foreground)] hover:bg-[color-mix(in_srgb,var(--app-muted)_5%,transparent)] transition-colors"
            @click="load"
          >
            <RefreshCw class="size-4" />
            Retry
          </button>
        </div>
      </div>
    </div>

    <!-- Space loaded — render component -->
    <template v-else-if="space">
      <!-- Render the page component if available -->
      <component
        v-if="currentPage"
        :is="currentPage"
        :key="`${spaceName}-${currentPagePath}`"
        :project-id="projectId"
      />

      <!-- Page not found within the space -->
      <div v-else-if="currentPagePath" class="flex-1 flex items-center justify-center">
        <div class="text-center">
          <p class="text-sm text-[var(--app-muted)]">
            Page "{{ currentPagePath }}" not found in {{ manifest?.name ?? spaceName }}.
          </p>
          <button
            class="mt-4 px-4 py-2 rounded-lg border border-[var(--app-border)] text-sm hover:bg-[color-mix(in_srgb,var(--app-muted)_5%,transparent)] transition-colors"
            @click="router.push(`/app/${spaceName}`)"
          >
            Go to {{ manifest?.name ?? spaceName }}
          </button>
        </div>
      </div>

      <!-- Config-only space with no Vue pages — agent fallback -->
      <div v-else class="flex-1 flex items-center justify-center">
        <div class="text-center max-w-sm">
          <div
            class="size-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
            :class="theme.bg"
          >
            <Icon :name="theme.icon" class="size-8" :class="theme.color" />
          </div>
          <h2 class="text-lg font-semibold text-[var(--app-foreground)] mb-2">
            {{ manifest?.name ?? spaceName }}
          </h2>
          <p class="text-sm text-[var(--app-muted)] mb-4">
            {{ manifest?.description ?? '' }}
          </p>
          <p class="text-xs text-[var(--app-muted)]">
            This space uses agent-powered interaction.
          </p>
        </div>
      </div>
    </template>
</div>
</template>
