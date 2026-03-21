<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { IS_DEV_INSTANCE, initAppPaths } from '@/lib/appPaths'
import { isTauriEnv } from '@/utils/tauri'
import { setDockIcon } from '@/composables/useDockIcon'
import { useAppTheme } from '@/composables/useAppTheme'
import { useWindowChromeState } from '@/composables/useWindowChromeState'
import { useAppMenu } from '@/composables/useAppMenu'
import { useDeepLink } from '@/composables/useDeepLink'
import { useTelemetry } from '@/composables/useTelemetry'
import { useUpdater } from '@/composables/useUpdater'
import { useGlobalShortcuts } from '@/composables/useGlobalShortcuts'

const route = useRoute()
const router = useRouter()
const { initTheme } = useAppTheme()
useAppMenu()
useDeepLink()
const telemetry = useTelemetry()
const updater = useUpdater()

// Global shortcuts (system-wide, works even when app not focused)
useGlobalShortcuts(async (id) => {
  switch (id) {
    case 'global.toggle-app': {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        const win = getCurrentWindow()
        if (await win.isVisible()) {
          await win.hide()
        } else {
          await win.show()
          await win.setFocus()
        }
      } catch (e) {
        console.error('[GlobalShortcut] toggle-app failed:', e)
      }
      break
    }
    case 'global.toggle-assistant': {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        const win = getCurrentWindow()
        await win.show()
        await win.setFocus()
      } catch { /* ignore */ }
      window.dispatchEvent(new CustomEvent('construct:toggle-assistant'))
      break
    }
    case 'global.quick-capture': {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        const win = getCurrentWindow()
        await win.show()
        await win.setFocus()
      } catch { /* ignore */ }
      // Emit a custom event that can be picked up by a notes/capture component
      window.dispatchEvent(new CustomEvent('construct:quick-capture'))
      break
    }
  }
})

// Check if we're in an app route (needs sidebar + toolbar)
const showSidebar = computed(() => route.path.startsWith('/app'))
const { isWindowChromeHidden, setWindowChromeHidden } = useWindowChromeState()

// Check if running in Tauri
const isTauri = ref(false)

let unlistenWindowResize: (() => void) | null = null

const updateWindowChromeState = async () => {
  if (!isTauri.value) return

  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const windowApi = getCurrentWindow()
    const isMaximized = await windowApi.isMaximized()
    const hasFullscreenMethod = 'isFullscreen' in windowApi
    const isFullscreen = hasFullscreenMethod ? await (windowApi as { isFullscreen: () => Promise<boolean> }).isFullscreen() : false

    setWindowChromeHidden(isFullscreen)
  } catch (e) {
    console.error('Failed to sync window chrome state:', e)
  }
}

// Window control handlers
const handleClose = async () => {
  if (!isTauri.value) return
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().close()
  } catch (e) {
    console.error('Failed to close window:', e)
  }
}

const handleMinimize = async () => {
  if (!isTauri.value) return
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().minimize()
  } catch (e) {
    console.error('Failed to minimize window:', e)
  }
}

const handleMaximize = async () => {
  if (!isTauri.value) return
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const win = getCurrentWindow()
    if (await win.isMaximized()) {
      await win.unmaximize()
    } else {
      await win.maximize()
    }
  } catch (e) {
    console.error('Failed to maximize window:', e)
  }
}

// Hide native traffic lights (we use custom semaphore)
const hideNativeTrafficLights = async () => {
  if (!isTauri.value) return
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('set_traffic_lights_visible', { visible: false })
  } catch (e) {
    console.error('Failed to hide traffic lights:', e)
  }
}

// Telemetry: session end on page hide/unload
const handleBeforeUnload = () => { telemetry.trackSessionEnd() }
const handleVisibilityChange = () => {
  if (document.visibilityState === 'hidden') telemetry.trackSessionEnd()
}

function shouldAllowNativeContextMenu(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false

  if (target.closest('[data-allow-native-context-menu]')) {
    return true
  }
 
  return false
}

function handleReleaseContextMenu(event: MouseEvent) {
  if (shouldAllowNativeContextMenu(event.target)) return
  event.preventDefault()
}

let unlisten: (() => void) | null = null

onMounted(async () => {
  isTauri.value = isTauriEnv()

  // Detect runtime --dev flag before anything else
  await initAppPaths()
  if (IS_DEV_INSTANCE.value) {
    setDockIcon('dev')
  }

  if (isTauri.value) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const launchRoute = await invoke<string | null>('get_launch_route')
      if (launchRoute && launchRoute.startsWith('/') && route.path !== launchRoute) {
        await router.replace(launchRoute)
      }
    } catch (e) {
      console.warn('[App] Launch route:', e)
    }

    setTimeout(() => hideNativeTrafficLights(), 100)
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      unlistenWindowResize = await getCurrentWindow().onResized(() => {
        updateWindowChromeState()
      })
      await updateWindowChromeState()
    } catch (e) {
      console.error('Failed to wire window chrome listener:', e)
    }
  }

  // Apply dark mode by default, then initialize theme from preferences
  document.documentElement.classList.add('dark')
  initTheme()

  // Telemetry: track session start + background sync
  telemetry.trackSessionStart()
  window.addEventListener('beforeunload', handleBeforeUnload)
  document.addEventListener('visibilitychange', handleVisibilityChange)

  // Release builds should not expose the WebView's default browser menu
  // (Back / Reload / Inspect Element) over app surfaces.
  if (isTauri.value && import.meta.env.PROD) {
    document.addEventListener('contextmenu', handleReleaseContextMenu, true)
  }

  // Auto-check for updates (respects user preference)
  if (isTauri.value) {
    updater.autoCheckOnStartup()
  }

  // Tauri: bridge window focus/blur to custom events for DynamicSpacePage
  if (isTauri.value) {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      unlisten = await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
        window.dispatchEvent(new Event(focused ? 'construct:window-focus' : 'construct:window-blur'))
      })
    } catch (e) {
      console.error('[Telemetry] Failed to setup focus listener:', e)
    }
  }
})

onUnmounted(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  document.removeEventListener('contextmenu', handleReleaseContextMenu, true)
  unlistenWindowResize?.()
  unlisten?.()
})
</script>

<template>
  <div class="bg-app text-app min-h-screen">
    <!-- Tauri semaphore (traffic lights) placeholder -->
    <div v-if="isTauri && showSidebar && !isWindowChromeHidden" class="fixed top-3 left-[10px] z-[200]" style="-webkit-app-region: no-drag">
      <div class="flex gap-2">
        <button
          class="w-3 h-3 rounded-full bg-red-500 hover:bg-red-600 cursor-default"
          @click="handleClose"
        />
        <button
          class="w-3 h-3 rounded-full bg-yellow-500 hover:bg-yellow-600 cursor-default"
          @click="handleMinimize"
        />
        <button
          class="w-3 h-3 rounded-full bg-green-500 hover:bg-green-600 cursor-default"
          @click="handleMaximize"
        />
      </div>
    </div>

    <div
      v-if="isTauri && IS_DEV_INSTANCE"
      class="fixed top-3 right-3 z-[200] select-none"
      style="-webkit-app-region: no-drag"
    >
      <div class="rounded-full border border-orange-400/35 bg-orange-500/10 px-3 py-1 text-[10px] font-semibold tracking-[0.22em] text-orange-300">
        DEV MODE
      </div>
    </div>

    <!-- Main content -->
    <RouterView />

    <!-- Global toast notifications -->
    <Toast />
  </div>
</template>
