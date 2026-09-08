<script setup lang="ts">
/**
 * WindowControls — custom minimize / maximize-restore / close for the frameless
 * Windows & Linux window (decorations:false; see lib.rs). Lives at the far
 * right of the TitleBar, after the presence/online component. Hidden on macOS,
 * which keeps its native traffic lights.
 *
 * Hovering the maximize button briefly triggers the Windows-11 Snap-Layouts
 * flyout via decorum's `show_snap_overlay` command (best-effort).
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { Minus, Square, X } from 'lucide-vue-next'
import { usePlatform } from '@/composables/usePlatform'

const { usesCustomChrome } = usePlatform()

const isMaximized = ref(false)
type AppWindow = {
  minimize: () => Promise<void>
  toggleMaximize: () => Promise<void>
  close: () => Promise<void>
  isMaximized: () => Promise<boolean>
  onResized: (cb: () => void) => Promise<() => void>
}
let win: AppWindow | null = null
let unlistenResize: (() => void) | null = null
let snapTimer: ReturnType<typeof setTimeout> | null = null

onMounted(async () => {
  if (!usesCustomChrome()) return
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    win = getCurrentWindow() as unknown as AppWindow
    isMaximized.value = await win.isMaximized()
    unlistenResize = await win.onResized(async () => {
      if (win) isMaximized.value = await win.isMaximized()
    })
  } catch { /* not in Tauri */ }
})

onUnmounted(() => {
  unlistenResize?.()
  if (snapTimer) clearTimeout(snapTimer)
})

function minimize() { void win?.minimize() }
function toggleMaximize() { void win?.toggleMaximize() }
function close() { void win?.close() }

// Windows-11 Snap Layouts: decorum shows the flyout when the maximize button is
// hovered for ~620ms. Reuse its command from our own button. Best-effort.
function onMaxEnter() {
  if (snapTimer) clearTimeout(snapTimer)
  snapTimer = setTimeout(() => {
    import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('plugin:decorum|show_snap_overlay'))
      .catch(() => { /* not Windows / command unavailable */ })
  }, 620)
}
function onMaxLeave() {
  if (snapTimer) { clearTimeout(snapTimer); snapTimer = null }
}
</script>

<template>
  <div v-if="usesCustomChrome()" class="win-controls flex items-stretch shrink-0">
    <button class="win-ctl" title="Minimize" aria-label="Minimize" @click="minimize">
      <Minus class="size-3.5" />
    </button>
    <button
      class="win-ctl"
      :title="isMaximized ? 'Restore' : 'Maximize'"
      :aria-label="isMaximized ? 'Restore' : 'Maximize'"
      @click="toggleMaximize"
      @mouseenter="onMaxEnter"
      @mouseleave="onMaxLeave"
    >
      <!-- Restore (overlapping squares) when maximized, single square otherwise. -->
      <svg v-if="isMaximized" viewBox="0 0 24 24" width="13" height="13" fill="none"
        stroke="currentColor" stroke-width="2">
        <rect x="8" y="3" width="13" height="13" rx="1" />
        <path d="M3 8.5A1.5 1.5 0 0 1 4.5 7H16v9.5A1.5 1.5 0 0 1 14.5 18H4.5A1.5 1.5 0 0 1 3 16.5Z" fill="var(--app-background)" />
      </svg>
      <Square v-else class="size-3" />
    </button>
    <button class="win-ctl win-ctl--close" title="Close" aria-label="Close" @click="close">
      <X class="size-4" />
    </button>
  </div>
</template>

<style scoped>
.win-controls {
  -webkit-app-region: no-drag;
  app-region: no-drag;
  margin-left: 4px;
}

.win-ctl {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 100%;
  min-height: 32px;
  border: none;
  background: transparent;
  color: var(--app-muted);
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}

.win-ctl:hover {
  background: color-mix(in srgb, var(--app-foreground) 9%, transparent);
  color: var(--app-foreground);
}

.win-ctl--close:hover {
  background: #e81123;
  color: #fff;
}
</style>
