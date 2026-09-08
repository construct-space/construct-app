/**
 * useAppMenu - Manages the native application menu based on active space
 * Updates the Tauri menu when navigating between spaces
 * Handles menu events from native menus
 */
import type { UnlistenFn } from '@tauri-apps/api/event'
import { SETTINGS_DEFAULT_PATH } from '@/router/settingsNavigation'
import { useAssistantPanel } from '@/composables/useAssistantPanel'
import { isTauriEnv } from '@/utils/tauri'

// Track current space to avoid unnecessary updates
const currentMenuSpace = ref<string | null>(null)

// Check if running in Tauri
const isTauri = () => isTauriEnv()

// Store unlisteners for cleanup
const unlisteners: UnlistenFn[] = []

export function useAppMenu() {
  const route = useRoute()
  const router = useRouter()
  const toast = useNotification()

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
    const project = projectStore.openProject(accessiblePath)

    const name = accessiblePath.split('/').filter(Boolean).pop() || accessiblePath
    toast.add({ title: `Opened: ${name}`, color: 'success' })

    // Navigate directly to the Coder space for this project
    if (project?.id) {
      router.push(`/app/projects/${project.id}/editor`)
    } else {
      router.push('/app')
    }
  }

  // Determine space from route — checks built-in spaces and dynamic space routes
  const activeSpace = computed(() => {
    const path = route.path
    // Built-in host-native spaces
    if (path.includes('/editor')) return 'editor'
    if (path.includes('/builder')) return 'builder'
    if (path.includes('/space-developer')) return 'space-developer'
    if (path.includes('/ask')) return 'ask'
    // Legacy / external space routes
    if (path.includes('/code')) return 'code'
    if (path.includes('/ui')) return 'ui'
    if (path.includes('/kanban')) return 'kanban'
    // Dynamic space route: /app/spaces/:spaceName
    const dynamicMatch = path.match(/\/app\/spaces\/([^/]+)/)
    if (dynamicMatch) return dynamicMatch[1]
    return 'default'
  })

  // Update native menu when space changes — reads menu def from manifest if available
  const updateMenu = async (space: string) => {
    if (!isTauri()) return
    if (currentMenuSpace.value === space) return

    try {
      const { invoke } = await import('@tauri-apps/api/core')

      // Try to load menu definition from space manifest, fall back to default
      let spaceMenuDef: { label: string; items: Array<{ id: string; label: string; accelerator?: string; separator?: boolean }> } | null = null
      try {
        const manifests = await getSpaceManifestMenu(space)
        if (manifests) {
          spaceMenuDef = manifests
        } else if (space !== 'default' && !['code', 'ui', 'kanban'].includes(space)) {
          // No manifest menu — use a default space menu
          const label = space.charAt(0).toUpperCase() + space.slice(1)
          spaceMenuDef = {
            label,
            items: [
              { id: `${space}_toggle_sidebar`, label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B' },
              { id: `${space}_toggle_assistant`, label: 'Toggle Assistant', accelerator: 'CmdOrCtrl+\\' },
            ],
          }
        }
      } catch { /* use legacy */ }

      await invoke('set_app_menu', { space, spaceMenuDef })
      currentMenuSpace.value = space
    } catch {
      // Silently fail if not in Tauri or command not available
    }
  }

  /** Read menu definition from a space's manifest.json */
  async function getSpaceManifestMenu(spaceId: string) {
    // Check built-in space manifests first
    const builtinManifests: Record<string, () => Promise<Record<string, unknown>>> = {
      builder: () => import('@/spaces/builder/manifest.json').then(m => m.default as Record<string, unknown>),
      'space-developer': () => import('@/spaces/space-developer/manifest.json').then(m => m.default as Record<string, unknown>),
      ask: () => import('~/spaces/ask/manifest.json').then(m => m.default as Record<string, unknown>),
      project: () => import('@/spaces/project/manifest.json').then(m => m.default as Record<string, unknown>),
    }

    const loader = builtinManifests[spaceId]
    if (loader) {
      const manifest = await loader()
      if (manifest.menu && typeof manifest.menu === 'object') {
        return manifest.menu as { label: string; items: Array<{ id: string; label: string; accelerator?: string; separator?: boolean }> }
      }
    }

    // For dynamic spaces, try reading from disk
    try {
      const { readTextFile } = await import('@tauri-apps/plugin-fs')
      const { homeDir } = await import('@tauri-apps/api/path')
      const { getSpaceDirPath } = await import('@/lib/appPaths')
      const home = await homeDir()
      const manifestPath = `${getSpaceDirPath(home, spaceId)}/manifest.json`
      const raw = JSON.parse(await readTextFile(manifestPath))
      if (raw.menu) return raw.menu
    } catch { /* no manifest or no menu field */ }

    return null
  }

  // Setup menu event listeners
  const setupMenuListeners = async () => {
    if (!isTauri()) return

    const { listen } = await import('@tauri-apps/api/event')

    unlisteners.push(await listen('menu:check-updates', async () => {
      // Run the check inline + toast result. Works on the login / register
      // pages too — previously this navigated to /app/settings/updates,
      // which requires auth and bounced back to /login silently.
      const { useUpdater } = await import('@/composables/useUpdater')
      const updater = useUpdater()
      const current = (window as unknown as { __CONSTRUCT_VERSION__?: string }).__CONSTRUCT_VERSION__
        || (import.meta.env.VITE_APP_VERSION as string | undefined)
        || ''
      toast.add({ title: 'Checking for updates…', color: 'info', duration: 1500 })
      const info = await updater.checkForUpdates()
      if (updater.error.value) {
        toast.add({
          title: 'Update check failed',
          description: updater.error.value,
          color: 'error',
        })
        return
      }
      if (info) {
        toast.add({
          title: `Update available: v${info.version}`,
          description: 'A new version of Construct is ready to install.',
          color: 'info',
          duration: 0,
          action: {
            label: 'Install & Restart',
            onClick: () => updater.downloadAndInstall(),
          },
        })
      } else {
        toast.add({
          title: "You're up to date",
          description: current ? `Construct v${current}` : undefined,
          color: 'success',
        })
      }
    }))

    unlisteners.push(await listen('menu:settings', () => {
      router.push(SETTINGS_DEFAULT_PATH)
    }))

    unlisteners.push(await listen('menu:projects', () => {
      router.push('/app')
    }))

    unlisteners.push(await listen('menu:new-project', () => {
      router.push('/app/projects')
    }))

    unlisteners.push(await listen('menu:about', () => {
      router.push('/app/settings/system')
    }))

    unlisteners.push(await listen('menu:keyboard-shortcuts', () => {
      router.push('/app/settings/shortcuts')
    }))

    // Tray "Restart Operator" — only fires when the status poller has
    // toggled the menu item enabled (operator down). Just re-runs the
    // same command the operator client uses on first connect; that
    // function detects an existing instance and otherwise spawns one,
    // so this works whether the operator died or never started.
    unlisteners.push(await listen('tray:restart-operator', async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('start_context_service')
      } catch (e) {
        console.warn('[tray] restart operator failed', e)
      }
    }))

    unlisteners.push(await listen('menu:toggle-sidebar', () => {
      const sidebar = useSidebar()
      sidebar.setPanel(sidebar.state.panel === 'main' ? 'space' : 'main')
    }))

    unlisteners.push(await listen('menu:toggle-assistant', () => {
      const assistant = useAssistantPanel()
      assistant.toggle()
    }))

    unlisteners.push(await listen<string>('menu:switch-profile', async (event) => {
      const profileId = `${event.payload || ''}`.trim()
      if (!profileId) return

      const { useProfileStore } = await import('@/stores/profile')
      const profileStore = useProfileStore()
      if (!profileStore.initialized) await profileStore.init()
      if (profileStore.activeProfileId === profileId) return

      await profileStore.switchProfile(profileId)
      router.replace('/app').catch(() => { })
    }))

    // Generic listener for all dynamic space menu events
    // Rust forwards unknown menu IDs as menu:space:{id-with-dashes}
    // We re-emit as a DOM CustomEvent so space pages can listen
    const { listen: listenAll } = await import('@tauri-apps/api/event')
    // Listen to any event starting with menu:space: — Tauri doesn't support wildcards,
    // so the Rust side emits a single generic event instead
    unlisteners.push(await listenAll('menu:space-action', (event) => {
      const menuId = (event.payload as string) || ''
      if (menuId) {
        window.dispatchEvent(new CustomEvent('construct:menu', { detail: { id: menuId } }))
      }
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
