<script setup lang="ts">
/**
 * WidgetChrome — wrapper around a space widget on the Home grid.
 * Provides error boundary, loading state, and remove action.
 * Watches placement.sizeKey to reload component on resize.
 * Mounts widgets inside a closed Shadow DOM for style + global isolation.
 */
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import type { Component } from 'vue'
import { useRouter } from 'vue-router'
import { useScheduler } from '@/composables/useScheduler'
import { useSpaces } from '@/composables/useSpaces'
import type { WidgetPlacement } from '@/composables/useWidgetRegistry'
import { isBuiltinSpace } from '@/composables/useWidgetRegistry'
import { mountWidgetInShadow } from '@/lib/widgetSandbox'
import { createBuiltinWidgetApi, createMarketplaceWidgetApi } from '@/lib/widgetApi'
import { navigateToSpace } from '@/lib/spaceNavigation'
import { getInjectedSpaceCss, subscribeToSpaceReload, watchSpace } from '@/space_loader/SpaceLoader'
import { isCoreSpace } from '@/space_loader/coreSpaces'
import { X } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  placement: WidgetPlacement
  getComponent: (spaceId: string, widgetId: string, sizeKey: string) => Promise<Component | null>
  removable?: boolean
}>(), {
  removable: true,
})

const emit = defineEmits<{
  remove: [instanceId: string]
}>()

// A tiny condensed space-name label so you can tell what a widget is without
// relying on its (sometimes missing) icon. Builtins title themselves, so this
// is only for installed/marketplace space widgets.
const { spaces } = useSpaces()
const spaceLabel = computed(() => {
  const id = props.placement.spaceId
  const s = spaces.value.find(x => x.name === id)
  return s?.displayName || s?.name || id
})
const showSpaceLabel = computed(() => !isBuiltinSpace(props.placement.spaceId))

const router = useRouter()
const scheduler = useScheduler()
const hostRef = ref<HTMLElement | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

// Track the current shadow app cleanup function
let cleanup: (() => void) | null = null

function getThemeVars(): Record<string, string> {
  const style = getComputedStyle(document.documentElement)
  const varNames = [
    '--app-background',
    '--app-foreground',
    '--app-surface',
    '--app-input-bg',
    '--app-border',
    '--app-accent',
    '--app-accent-foreground',
    '--app-muted',
    '--app-canvas-bg',
    '--app-status-bg',
    '--font-sans',
    '--font-mono',
    '--default-font-family',
    '--default-mono-font-family',
  ]
  const vars: Record<string, string> = {}
  for (const name of varNames) {
    const val = style.getPropertyValue(name).trim()
    if (val) vars[name] = val
  }
  return vars
}

async function loadWidget() {
  // Clean up previous shadow app if reloading (e.g. on resize)
  if (cleanup) {
    cleanup()
    cleanup = null
  }

  loading.value = true
  error.value = null

  let component: Component | null
  try {
    component = await props.getComponent(
      props.placement.spaceId,
      props.placement.widgetId,
      props.placement.sizeKey,
    )
    if (!component) {
      error.value = 'Widget not found'
      return
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load widget'
    return
  } finally {
    loading.value = false
  }

  // Wait a tick so Vue renders <div ref="hostRef"> before we attach shadow
  await new Promise<void>(resolve => setTimeout(resolve, 0))

  const el = hostRef.value
  if (!el) {
    error.value = 'Host element not available'
    return
  }

  const themeVars = getThemeVars()
  const spaceId = props.placement.spaceId
  const theme = {
    mode: (document.documentElement.classList.contains('dark') ? 'dark' : 'light') as 'dark' | 'light',
    vars: themeVars,
  }
  const space = { id: spaceId, name: spaceId, icon: '' }

  let api
  const instanceId = props.placement.instanceId
  // Host-mediated navigation for sandboxed widgets — they have no router of
  // their own. Opens this widget's own space, optionally at a page path.
  const openSpace = (page?: string) => {
    void navigateToSpace({ spaceId, page: page || undefined })
  }
  // Read-only scheduler scoped to this widget's space, so widgets (clock's
  // Timer/Alarm, etc.) reflect server cron tasks without a stale local cache.
  const widgetScheduler = {
    list: async () => {
      const tasks = await scheduler.list({ ownerSpace: spaceId })
      return tasks.map(t => ({ id: t.id, enabled: t.enabled, nextRunAt: t.nextRunAt, schedule: t.schedule, action: t.action }))
    },
  }
  if (isBuiltinSpace(spaceId)) {
    api = createBuiltinWidgetApi({
      instanceId,
      theme,
      space,
      actions: {
        navigate: (path: string) => router.push(path),
        newSession: (params?: unknown) => router.push({ name: 'builder', query: params as Record<string, string> }),
      },
      openSpace,
      scheduler: widgetScheduler,
    })
  } else {
    api = createMarketplaceWidgetApi({ instanceId, theme, space, openSpace, scheduler: widgetScheduler })
  }

  cleanup = mountWidgetInShadow(el, component, api, themeVars, getInjectedSpaceCss(spaceId))
}

let unsubscribeReload: (() => void) | null = null
let unwatchSpace: (() => void) | null = null

onMounted(async () => {
  // Auto-reload this widget whenever the underlying space bundle is reloaded
  // (either because `construct dev` polled a manifest change or because
  // another consumer triggered reloadSpace). Replaces the previous
  // restart-the-app workaround.
  unsubscribeReload = subscribeToSpaceReload(props.placement.spaceId, () => {
    loadWidget()
  })

  // Also start a file watcher so rebuilds outside this component (e.g. the
  // user editing via an external editor) still trigger reload. `watchSpace`
  // returns null when it's not needed (no dev mode / .dev marker).
  if (!isCoreSpace(props.placement.spaceId)) {
    try {
      const unwatch = await watchSpace(props.placement.spaceId, () => { /* subscriber handles it */ })
      if (unwatch) unwatchSpace = unwatch
    } catch { /* best-effort */ }
  }
})

onUnmounted(() => {
  if (cleanup) {
    cleanup()
    cleanup = null
  }
  unsubscribeReload?.()
  unsubscribeReload = null
  unwatchSpace?.()
  unwatchSpace = null
})

// Load on mount and reload when sizeKey changes (resize)
watch(
  () => props.placement.sizeKey,
  () => loadWidget(),
  { immediate: true }
)
</script>

<template>
  <div
    class="widget-chrome relative h-full overflow-hidden group transition-colors"
  >
    <!-- Remove button — visible only on hover, no surface of its own -->
    <button
      v-if="removable"
      draggable="false"
      class="remove-btn absolute top-1.5 right-1.5 z-10 size-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-colors"
      @click.stop.prevent="emit('remove', placement.instanceId)"
      @mousedown.stop.prevent
      @dragstart.stop.prevent
    >
      <X class="size-3" />
    </button>

    <!-- Loading -->
    <div v-if="loading" class="h-full flex items-center justify-center">
      <div class="size-4 border-2 border-[var(--app-muted)]/30 border-t-[var(--app-accent)] rounded-full animate-spin" />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="h-full flex items-center justify-center p-3">
      <p class="text-xs text-[var(--app-muted)] text-center">{{ error }}</p>
    </div>

    <!-- Widget content — mounted into closed Shadow DOM -->
    <div v-else ref="hostRef" class="h-full" />

    <!-- Tiny space-name tag so the widget is identifiable regardless of its
         own icon/title. Subtle + non-interactive so it doesn't disturb layout. -->
    <span
      v-if="!loading && !error && showSpaceLabel"
      class="widget-space-tag absolute top-1 left-2 z-10 pointer-events-none select-none"
      :title="spaceLabel"
    >{{ spaceLabel }}</span>
  </div>
</template>

<style scoped>
/* Quiet rest surface: just enough to let an empty widget feel like a
   defined zone instead of a void. No border, no corner chrome — the
   tint alone carries it. We intentionally don't add a chrome-level
   hover: interior rows/tiles/cards own their own hover feedback, and
   a widget-wide hover at the same intensity would drown that out. */
.widget-chrome {
  background: color-mix(in srgb, var(--app-foreground) 1.5%, transparent);
}

/* Condensed space-name tag — the Construct UI Card-title look (uppercase,
   wide tracking, trailing accent dot, like ASK. / PROJECTS.), but small so it
   just identifies the space without competing with the widget's content. */
.widget-space-tag {
  font-size: 9px;
  font-weight: 400;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--app-foreground);
  opacity: 0.6;
  max-width: calc(100% - 1.5rem);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.widget-space-tag::after {
  content: '.';
  color: var(--app-accent);
}

.remove-btn {
  color: var(--app-muted);
}
.remove-btn:hover {
  color: var(--app-accent);
  background: color-mix(in srgb, var(--app-accent) 10%, transparent);
}
</style>
