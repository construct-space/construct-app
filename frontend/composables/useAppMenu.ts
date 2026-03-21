/**
 * useAppMenu - Manages the native application menu based on active space
 * Updates the Tauri menu when navigating between spaces
 * Handles menu events from native menus
 */
import type { UnlistenFn } from '@tauri-apps/api/event'
import { SETTINGS_DEFAULT_PATH } from '@/router/settingsNavigation'
import { useAssistant } from '@/operator'

// Track current space to avoid unnecessary updates
const currentMenuSpace = ref<string | null>(null)

// Check if running in Tauri
const isTauri = () => !!(window as unknown as { __TAURI__?: unknown }).__TAURI__

// Store unlisteners for cleanup
const unlisteners: UnlistenFn[] = []

export function useAppMenu() {
  const route = useRoute()
  const router = useRouter()
  const toast = useToast()

  const ensureFolderAccess = async (folderPath: string): Promise<string | null> => {
    if (!folderPath) return null

    try {
      const { stat } = await import('@tauri-apps/plugin-fs')
      await stat(folderPath)
      return folderPath
    } catch (error) {
      const message = String(error || '')
      const needsGrant =
        message.includes('forbidden path') ||
        message.includes('Operation not permitted') ||
        message.includes('not allowed')

      if (!needsGrant) {
        return folderPath
      }

      // Dock-opened paths are not granted through a dialog selection, so ask
      // the user to confirm access once.
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: folderPath,
        title: 'Grant access to opened folder',
      })

      if (selected && typeof selected === 'string') {
        return selected
      }

      toast.add({
        title: 'Folder access denied',
        description: 'Please grant access to open this folder.',
        color: 'warning',
      })
      return null
    }
  }

  const handleDockOpenFolder = async (folderPath: string) => {
    if (!folderPath) return

    const accessiblePath = await ensureFolderAccess(folderPath)
    if (!accessiblePath) return

    const projectStore = useProjectStore()
    await projectStore.addExternalFolderByPath(accessiblePath)
    projectStore.openProject(accessiblePath)

    const name = accessiblePath.split('/').filter(Boolean).pop() || accessiblePath
    toast.add({ title: `Project added: ${name}`, color: 'success' })

    router.push('/app')
  }

  // Determine space from route
  const activeSpace = computed(() => {
    const path = route.path
    if (path.includes('/code')) return 'code'
    if (path.includes('/ui')) return 'ui'
    if (path.includes('/kanban')) return 'kanban'
    if (path.includes('/git')) return 'git'
    if (path.includes('/browser')) return 'browser'
    if (path.includes('/terminal')) return 'terminal'
    return 'default'
  })

  // Update native menu when space changes
  const updateMenu = async (space: string) => {
    if (!isTauri()) return
    if (currentMenuSpace.value === space) return

    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('set_app_menu', { space })
      currentMenuSpace.value = space
    } catch {
      // Silently fail if not in Tauri or command not available
    }
  }

  // Setup menu event listeners
  const setupMenuListeners = async () => {
    if (!isTauri()) return

    const { listen } = await import('@tauri-apps/api/event')

    unlisteners.push(await listen('menu:check-updates', () => {
      router.push('/app/settings/updates')
    }))

    unlisteners.push(await listen('menu:settings', () => {
      router.push(SETTINGS_DEFAULT_PATH)
    }))

    unlisteners.push(await listen('menu:projects', () => {
      router.push('/app')
    }))

    unlisteners.push(await listen('menu:new-project', () => {
      router.push('/app/code')
    }))

    unlisteners.push(await listen('menu:about', () => {
      router.push('/app/settings/system')
    }))

    unlisteners.push(await listen('menu:keyboard-shortcuts', () => {
      router.push('/app/settings/shortcuts')
    }))

    unlisteners.push(await listen('menu:toggle-sidebar', () => {
      const sidebar = useSidebar()
      sidebar.setPanel(sidebar.state.panel === 'main' ? 'space' : 'main')
    }))

    unlisteners.push(await listen('menu:toggle-assistant', () => {
      const assistant = useAssistant()
      assistant.toggle()
    }))

    // macOS: folder dropped on dock icon → add as project
    unlisteners.push(await listen<string>('dock:open-folder', async (event) => {
      await handleDockOpenFolder(event.payload)
    }))

    // Mark the frontend dock listener as ready and process any early drops
    // that arrived before Vue mounted and registered listeners.
    const { invoke } = await import('@tauri-apps/api/core')
    const pending = await invoke<string[]>('dock_set_listener_ready').catch(() => [])
    for (const folderPath of pending) {
      await handleDockOpenFolder(folderPath)
    }
  }

  // Cleanup listeners
  const cleanup = () => {
    unlisteners.forEach((unlisten) => unlisten())
    unlisteners.length = 0
  }

  // Watch for space changes (only on client)
  onMounted(() => {
    updateMenu(activeSpace.value)
    setupMenuListeners()

    watch(activeSpace, (space) => {
      updateMenu(space)
    })
  })

  onUnmounted(() => {
    cleanup()
  })

  return {
    activeSpace,
    updateMenu
  }
}
