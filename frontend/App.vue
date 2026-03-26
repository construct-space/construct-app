<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { IS_DEV_INSTANCE, initAppPaths } from '@/lib/appPaths'
import { isTauriEnv } from '@/utils/tauri'
import { setDockIcon } from '@/composables/useDockIcon'
import { useTheme } from '@construct-space/ui'
import { useWindowChromeState } from '@/composables/useWindowChromeState'
import { useAppMenu } from '@/composables/useAppMenu'
import { useDeepLink } from '@/composables/useDeepLink'
import { useTelemetry } from '@/composables/useTelemetry'
import { useUpdater } from '@/composables/useUpdater'
import { useGlobalShortcuts } from '@/composables/useGlobalShortcuts'

const route = useRoute()
const router = useRouter()

// Splash screen — shown while app initializes
const appReady = ref(false)
const { init: initTheme } = useTheme()
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

    // Native traffic lights are used — no need to hide them
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

  // Initialize theme (sets dark/light class + CSS variables)
  initTheme()

  // Preload space actions so agent tools are available immediately
  import('@/space_loader/SpaceLoader').then(({ preloadSpaceActions }) => {
    preloadSpaceActions()
  })

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

  // Hydrate auth before revealing the app
  try {
    const { useAuthStore } = await import('@/stores/auth')
    const authStore = useAuthStore()
    await authStore.initialize()
  } catch { /* auth will redirect to login */ }

  // Remove HTML splash and reveal app
  const htmlSplash = document.getElementById('splash')
  if (htmlSplash) {
    htmlSplash.style.transition = 'opacity 0.3s ease'
    htmlSplash.style.opacity = '0'
    setTimeout(() => htmlSplash.remove(), 300)
  }
  appReady.value = true
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
    <!-- Native traffic lights handled by macOS (titleBarStyle: Overlay) -->
    <!-- Reserve space so content doesn't overlap the native buttons -->
    <div v-if="isTauri && showSidebar && !isWindowChromeHidden" class="fixed top-0 left-0 w-[78px] h-[38px] z-[200]" style="-webkit-app-region: no-drag" />

    <div
      v-if="isTauri && IS_DEV_INSTANCE"
      class="fixed top-3 right-3 z-[200] select-none"
      style="-webkit-app-region: no-drag"
    >
      <div class="rounded-full border border-orange-400/35 bg-orange-500/10 px-3 py-1 text-[10px] font-semibold tracking-[0.22em] text-orange-300">
        DEV MODE
      </div>
    </div>

    <!-- Splash screen -->
    <Transition name="splash-fade">
      <div v-if="!appReady" class="fixed inset-0 z-[9999] flex items-center justify-center bg-[var(--app-background)]">
        <svg width="48" height="48" viewBox="0 0 533 533" fill="currentColor" class="text-app-accent animate-pulse">
          <path d="M266.5 410.156C230.912 410.156 199.106 402.203 171.081 386.297C143.056 370.39 121.036 348.519 105.022 320.684C89.0072 292.848 81 261.256 81 225.909C81 190.12 89.0072 158.308 105.022 130.472C121.036 102.636 143.056 80.7655 171.081 64.8593C199.106 48.9531 230.912 41 266.5 41C302.087 41 333.671 48.9531 361.252 64.8593C389.277 80.7655 411.297 102.636 427.311 130.472C443.326 158.308 451.555 190.12 452 225.909C452 261.256 443.77 292.848 427.311 320.684C411.297 348.519 389.277 370.39 361.252 386.297C333.671 402.203 302.087 410.156 266.5 410.156ZM266.5 363.763C292.301 363.763 315.433 357.798 335.896 345.868C356.359 333.939 372.373 317.591 383.939 296.824C395.505 276.058 401.288 252.42 401.288 225.909C401.288 199.399 395.505 175.761 383.939 154.994C372.373 133.786 356.359 117.217 335.896 105.287C315.433 93.3579 292.301 87.393 266.5 87.393C240.699 87.393 217.567 93.3579 197.104 105.287C176.641 117.217 160.405 133.786 148.394 154.994C136.828 175.761 131.045 199.399 131.045 225.909C131.045 252.42 136.828 276.058 148.394 296.824C160.405 317.591 176.641 333.939 197.104 345.868C217.567 357.798 240.699 363.763 266.5 363.763Z" />
          <path d="M378.22 451.578C393.077 451.578 405.121 460.85 405.121 472.289C405.121 483.727 393.077 493 378.22 493H160.945C146.089 493 134.044 483.727 134.044 472.289C134.044 460.85 146.089 451.578 160.945 451.578H378.22Z" />
        </svg>
      </div>
    </Transition>

    <!-- Main content -->
    <RouterView v-if="appReady" />

    <!-- Global toast notifications -->
    <Notification />
  </div>
</template>

<style>
.splash-fade-leave-active {
  transition: opacity 0.3s ease;
}
.splash-fade-leave-to {
  opacity: 0;
}
</style>
