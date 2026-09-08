import { onMounted, onUnmounted } from 'vue'
import { useAppTheme } from '@/composables/useAppTheme'
import { useNetworkStatus } from '@/composables/useNetworkStatus'
import { isTauriEnv } from '@/utils/tauri'

export interface UniversalBootstrapOptions {
  initTheme?: boolean
  enableDevtoolsShortcut?: boolean
  suppressContextMenuInProd?: boolean
}

export function useUniversalBootstrap(options: UniversalBootstrapOptions = {}): void {
  const {
    initTheme = true,
    enableDevtoolsShortcut = true,
    suppressContextMenuInProd = true,
  } = options

  // useAppTheme drives the `--app-*` CSS vars. Without initialising it
  // here the persisted theme id is loaded from profileStorage but
  // applyThemeColors never runs, so the picker's selected state is right
  // while the screen renders with whatever the auto-mode resolved to.
  const appTheme = useAppTheme()
  const network = useNetworkStatus()

  function allowNativeContextMenu(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    return !!target.closest('[data-allow-native-context-menu]')
  }

  function handleContextMenu(event: MouseEvent) {
    if (allowNativeContextMenu(event.target)) return
    event.preventDefault()
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!(e.metaKey || e.ctrlKey) || !e.altKey || e.code !== 'KeyI') return
    e.preventDefault()
    ;(async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow')
        const label = getCurrentWebviewWindow().label
        await invoke('open_devtools', { label })
      } catch (err) {
        console.error('[useUniversalBootstrap] devtools invoke failed:', err)
      }
    })()
  }

  onMounted(() => {
    if (initTheme) {
      appTheme.initTheme()
    }
    // Start listening for online/offline transitions exactly once —
    // install() short-circuits on subsequent calls so mounting multiple
    // shells (e.g. detach windows) stays safe.
    network.install()
    if (!isTauriEnv()) return
    if (enableDevtoolsShortcut) {
      window.addEventListener('keydown', handleKeydown)
    }
    if (suppressContextMenuInProd && import.meta.env.PROD) {
      document.addEventListener('contextmenu', handleContextMenu, true)
    }
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKeydown)
    document.removeEventListener('contextmenu', handleContextMenu, true)
  })
}
