<script setup lang="ts">
/**
 * WebPreviewShell — device-sized preview of an HTTP/file:// URL.
 *
 * The shell renders a thin chrome bar (device badge + URL + reload) and
 * mounts a Tauri *child* Webview filling the rest of the window. Using
 * a child webview (not an iframe) bypasses X-Frame-Options on dev
 * servers and keeps the external content isolated from the app bundle.
 *
 * Dedup + HMR: `openPreview(url, { type: 'web', device })` returns the
 * same label for a given url+device, so re-opening fires a
 * `preview:reload` event on the existing window. We listen here and
 * reload the child webview in place.
 *
 * Route: /preview-web?url=<encoded>&device=<mobile|tablet|desktop|custom>
 */

import { installKeyGuard } from '@/lib/keyGuard'
import { useUniversalBootstrap } from '@/composables/useUniversalBootstrap'
import { RefreshCw, Loader2, AlertCircle } from 'lucide-vue-next'
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'

installKeyGuard()
useUniversalBootstrap()

const route = useRoute()

const url = computed(() => {
  const raw = route.query.url
  return typeof raw === 'string' ? raw : ''
})

const device = computed(() => {
  const raw = route.query.device
  const val = typeof raw === 'string' ? raw : 'desktop'
  return (['mobile', 'tablet', 'desktop', 'custom'] as const).includes(val as 'mobile')
    ? (val as 'mobile' | 'tablet' | 'desktop' | 'custom')
    : 'desktop'
})

const displayDevice = computed(() => device.value[0].toUpperCase() + device.value.slice(1))

const contentEl = ref<HTMLDivElement | null>(null)
const error = ref<string | null>(null)
const loading = ref(true)
// Non-null once the child webview is mounted. Kept as a shallow ref so
// Vue doesn't try to proxy the Tauri binding (which throws on reactive
// access to native handles).
const childLabel = ref<string | null>(null)

async function computeBounds(): Promise<{ x: number; y: number; width: number; height: number } | null> {
  const el = contentEl.value
  if (!el) return null
  const rect = el.getBoundingClientRect()
  // Use integer pixels — Tauri's webview API rejects fractional values
  // on some platforms.
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  }
}

async function mountChild() {
  if (!url.value) {
    error.value = 'No URL provided'
    loading.value = false
    return
  }
  loading.value = true
  error.value = null

  try {
    const { Webview } = await import('@tauri-apps/api/webview')
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const parent = getCurrentWindow()
    const bounds = await computeBounds()
    if (!bounds) {
      error.value = 'Content area not ready'
      loading.value = false
      return
    }

    const label = `preview-web-content-${Date.now().toString(36)}`
    const webview = new Webview(parent, label, {
      url: url.value,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      acceptFirstMouse: true,
      focus: false,
    })

    webview.once('tauri://created', () => {
      childLabel.value = label
      loading.value = false
    })
    webview.once('tauri://error', (ev) => {
      const payload = (ev as unknown as { payload?: string }).payload
      error.value = `Failed to mount child webview: ${payload ?? 'unknown'}`
      loading.value = false
    })
  } catch (e) {
    error.value = `Webview mount failed: ${e instanceof Error ? e.message : String(e)}`
    loading.value = false
  }
}

async function unmountChild() {
  const label = childLabel.value
  childLabel.value = null
  if (!label) return
  try {
    const { Webview } = await import('@tauri-apps/api/webview')
    const wv = await Webview.getByLabel(label)
    if (wv) await wv.close()
  } catch { /* best-effort */ }
}

async function reload() {
  await unmountChild()
  await mountChild()
}

async function syncBounds() {
  const label = childLabel.value
  if (!label) return
  const bounds = await computeBounds()
  if (!bounds) return
  try {
    const { Webview } = await import('@tauri-apps/api/webview')
    const wv = await Webview.getByLabel(label)
    if (!wv) return
    await wv.setPosition({ type: 'Logical', x: bounds.x, y: bounds.y } as unknown as never)
    await wv.setSize({ type: 'Logical', width: bounds.width, height: bounds.height } as unknown as never)
  } catch { /* ignore — resize race with window close */ }
}

let reloadUnlisten: (() => void) | null = null
let resizeHandler: (() => void) | null = null

onMounted(async () => {
  // Next microtask so the template has painted and contentEl has bounds.
  await Promise.resolve()
  await mountChild()

  // openPreview emits `preview:reload` when a window with the same
  // url+device label is re-opened. Swap URL if payload carries one.
  try {
    const { listen } = await import('@tauri-apps/api/event')
    reloadUnlisten = await listen<{ url?: string }>('preview:reload', async (ev) => {
      const next = ev.payload?.url
      if (next && next !== url.value) {
        // URL changed — the route watcher below handles the remount.
        // We just surface the new URL in the query so the bar updates.
        const router = useRouter()
        router.replace({ query: { ...route.query, url: next } })
        return
      }
      await reload()
    })
  } catch { /* non-Tauri or API missing */ }

  // Keep the child webview aligned with the content region. Debounced
  // via rAF — plain resize events fire often during a drag.
  let pending = 0
  resizeHandler = () => {
    cancelAnimationFrame(pending)
    pending = requestAnimationFrame(() => { void syncBounds() })
  }
  window.addEventListener('resize', resizeHandler)
})

watch(url, async (next, prev) => {
  if (next === prev) return
  await reload()
})

onUnmounted(async () => {
  reloadUnlisten?.()
  if (resizeHandler) window.removeEventListener('resize', resizeHandler)
  await unmountChild()
})
</script>

<template>
  <div class="h-screen flex flex-col bg-[var(--app-background)] text-[var(--app-foreground)]">
    <!-- Chrome -->
    <div
      class="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--app-border)] bg-[var(--app-background)] shrink-0"
      data-tauri-drag-region
    >
      <span
        class="text-[10px] font-bold tracking-wider text-[var(--app-muted)] bg-[color-mix(in_srgb,var(--app-muted)_10%,transparent)] px-1.5 py-0.5 rounded"
      >{{ displayDevice }}</span>
      <span class="text-xs text-[var(--app-foreground)] truncate flex-1" :title="url">{{ url }}</span>
      <button
        class="p-1 rounded hover:bg-[color-mix(in_srgb,var(--app-muted)_10%,transparent)] text-[var(--app-muted)] hover:text-[var(--app-foreground)] transition-colors"
        title="Reload (Cmd+R)"
        @click="reload"
      >
        <RefreshCw class="size-3.5" />
      </button>
    </div>

    <!-- Status overlay -->
    <div
      v-if="loading || error"
      class="flex-1 flex items-center justify-center"
    >
      <div v-if="loading" class="flex items-center gap-3 text-[var(--app-muted)]">
        <Loader2 class="size-5 animate-spin" />
        <span class="text-sm">Loading…</span>
      </div>
      <div v-else-if="error" class="text-center max-w-sm">
        <AlertCircle class="size-10 text-red-400 mx-auto mb-4" />
        <p class="text-sm text-[var(--app-muted)] mb-4">{{ error }}</p>
        <button
          class="px-4 py-2 rounded-lg border border-[var(--app-border)] text-sm hover:bg-[color-mix(in_srgb,var(--app-muted)_5%,transparent)] transition-colors"
          @click="reload"
        >
          Retry
        </button>
      </div>
    </div>

    <!-- Content region. The child webview is positioned absolutely by
         Tauri against the window; this div only reserves the space and
         provides the bounds for computeBounds(). Tauri webviews render
         ABOVE regular DOM, so we can't show DOM content inside this
         region once the child is mounted. -->
    <div
      v-show="!loading && !error"
      ref="contentEl"
      class="flex-1"
    />
  </div>
</template>
