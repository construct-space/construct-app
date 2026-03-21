/**
 * useToolbar - Unified toolbar system with 3D rotation
 *
 * Handles:
 * - Space detection and toolbar items (from space.config files)
 * - Page-specific toolbar items (set by pages)
 * - 3D rotation animation on navigation
 * - Search, breadcrumbs, and customization
 */

import type { SpaceConfig, SpaceToolbarItem } from '~/composables/useSpaces'
import { usePreferencesStore } from '~/stores/preferences'
import { globalToolbarItems, defaultToolbarLayout } from '~/config/toolbar'

export interface ToolbarItem {
  id: string
  icon: string
  label: string
  type?: 'action' | 'space' | 'separator' | 'flexible-space' | 'breadcrumb'
  onClick?: () => void
  to?: string
  action?: string
  disabled?: boolean
  active?: boolean
  category?: 'navigation' | 'app' | 'space' | 'utility'
}

export interface ToolbarBreadcrumb {
  label: string
  icon?: string
  iconColor?: string
  to?: string
}

interface PanelContent {
  path: string
  spaceName: string | null
  spaceConfig: SpaceConfig | null
  spaceToolbarItems: SpaceToolbarItem[]
}

interface ToolbarState {
  // 3D rotation panels
  frontPanel: PanelContent
  bottomPanel: PanelContent
  rotationAngle: number
  isRotating: boolean
  previousPath: string | null

  // Space configs cache
  spacesCache: Map<string, SpaceConfig>
  spacesInitialized: boolean

  // Page-specific toolbar items
  pageItems: ToolbarItem[]
  pendingPageItems: ToolbarItem[] | null

  // Legacy customization (toolbar layout)
  items: string[]
  registry: Map<string, ToolbarItem>

  // Search config
  searchPlaceholder: string
  searchHandler: ((query: string) => void) | null

  // Breadcrumbs
  breadcrumbs: ToolbarBreadcrumb[]

  // Customize mode
  isCustomizing: boolean
  loading: boolean
}

const emptyPanel = (): PanelContent => ({
  path: '',
  spaceName: null,
  spaceConfig: null,
  spaceToolbarItems: []
})

const state = reactive<ToolbarState>({
  // 3D rotation
  frontPanel: emptyPanel(),
  bottomPanel: emptyPanel(),
  rotationAngle: 0,
  isRotating: false,
  previousPath: null,

  // Space
  spacesCache: new Map(),
  spacesInitialized: false,

  // Page items
  pageItems: [],
  pendingPageItems: null,

  // Legacy
  items: [...defaultToolbarLayout],
  registry: new Map(),

  // Search
  searchPlaceholder: 'Search...',
  searchHandler: null,

  // Breadcrumbs
  breadcrumbs: [],

  // UI state
  isCustomizing: false,
  loading: false
})

// Initialize global toolbar items
globalToolbarItems.forEach(item => {
  state.registry.set(item.id, item as ToolbarItem)
})

export function useToolbar() {
  const route = useRoute()
  const { spaces, loadSpaces, getSpace } = useSpaces()

  // ============================================
  // SPACE DETECTION & 3D ROTATION
  // ============================================

  const isValidSpace = (name: string): boolean => {
    return state.spacesCache.has(name) || !!getSpace(name)
  }

  const getSpaceFromPath = (path: string): string | null => {
    // Project-scoped: /app/projects/:id/:spaceName
    const projectMatch = path.match(/\/app\/projects\/[^/]+\/([^/]+)/)
    if (projectMatch?.[1] && isValidSpace(projectMatch[1])) {
      return projectMatch[1]
    }
    // Company-scoped: /app/:spaceName
    const rootMatch = path.match(/\/app\/([^/]+)/)
    if (rootMatch && rootMatch[1] && isValidSpace(rootMatch[1])) {
      return rootMatch[1]
    }
    return null
  }

  const getSpaceConfig = (spaceName: string | null): SpaceConfig | null => {
    if (!spaceName) return null
    return state.spacesCache.get(spaceName) || getSpace(spaceName) || null
  }

  // Extract the sub-page path segment after the space name
  const getSubPageFromPath = (path: string, spaceName: string): string => {
    // Project-scoped: /app/projects/:id/:spaceName/:subPage
    const projectMatch = path.match(new RegExp(`/app/projects/[^/]+/${spaceName}/?(.*)`))
    if (projectMatch) return projectMatch[1] || ''
    // Company-scoped: /app/:spaceName/:subPage
    const rootMatch = path.match(new RegExp(`/app/${spaceName}/?(.*)`))
    if (rootMatch) return rootMatch[1] || ''
    return ''
  }

  const getSpaceToolbarItems = (spaceName: string | null, subPage = ''): SpaceToolbarItem[] => {
    if (!spaceName) return []
    const space = state.spacesCache.get(spaceName) || getSpace(spaceName)
    if (!space) return []
    const spaceItems = space.toolbar || []
    const page = space.pages.find(p => p.path === subPage)
    const pageItems = page?.toolbar || []
    return [...spaceItems, ...pageItems]
  }

  const buildPanelContent = (path: string, spaceName: string | null): PanelContent => {
    const subPage = spaceName ? getSubPageFromPath(path, spaceName) : ''
    return {
      path,
      spaceName,
      spaceConfig: getSpaceConfig(spaceName),
      spaceToolbarItems: getSpaceToolbarItems(spaceName, subPage),
    }
  }

  const initFrontPanel = () => {
    const path = route.path
    const spaceName = getSpaceFromPath(path)
    state.frontPanel = buildPanelContent(path, spaceName)
    state.previousPath = path
  }

  const navigateWithRotation = () => {
    const path = route.path
    if (path === state.previousPath || state.isRotating) return

    const spaceName = getSpaceFromPath(path)

    // Don't clear pageItems immediately - the new page will set them
    // Store current items as "old" so we can show them during animation if needed
    // state.pageItems = [] // Removed: caused race condition with page mounting

    // Populate bottom panel and rotate
    state.bottomPanel = buildPanelContent(path, spaceName)
    state.isRotating = true
    state.rotationAngle = 90

    setTimeout(() => {
      // Disable transition before resetting angle
      state.isRotating = false

      // Wait a frame for transition to be disabled, then reset
      requestAnimationFrame(() => {
        state.frontPanel = { ...state.bottomPanel }
        state.bottomPanel = emptyPanel()
        state.rotationAngle = 0
        state.previousPath = path

        // Apply any pending page items that were set during rotation
        if (state.pendingPageItems && state.pendingPageItems.length > 0) {
          state.pageItems = state.pendingPageItems
          state.pendingPageItems = null
        }
      })
    }, 500)
  }

  // Initialize spaces and start watching route
  const initToolbar = async () => {
    if (spaces.value.length === 0) {
      await loadSpaces()
    }
    spaces.value.forEach(space => {
      state.spacesCache.set(space.name, space)
    })
    state.spacesInitialized = true
    initFrontPanel()

    // Load preferences
    await loadToolbarLayout()

    // Apply any pending page items that were set before initialization
    applyPendingItems()
  }

  // Watch route changes - flush: 'pre' ensures this fires BEFORE DOM updates
  // so isRotating is true when new page mounts and calls setPageItems
  watch(() => route.path, (newPath, oldPath) => {
    // Skip if this is the initial watch setup or HMR (no actual navigation)
    if (!oldPath || newPath === oldPath) return
    if (state.spacesInitialized) {
      navigateWithRotation()
    }
  }, { immediate: false, flush: 'pre' })

  // ============================================
  // PAGE TOOLBAR ITEMS
  // ============================================

  const setPageItems = (items: ToolbarItem[]) => {
    // During rotation, only store as pending - don't update front panel yet
    if (state.isRotating) {
      state.pendingPageItems = items
    } else {
      state.pageItems = items
      state.pendingPageItems = items
    }
  }

  // Apply pending items after initialization (in case page mounted before toolbar)
  const applyPendingItems = () => {
    if (state.pendingPageItems && state.pendingPageItems.length > 0) {
      state.pageItems = state.pendingPageItems
      state.pendingPageItems = null // Clear pending after applying
    }
  }

  const clearPageItems = () => {
    state.pageItems = []
  }

  // ============================================
  // SEARCH
  // ============================================

  const setSearch = (placeholder: string, handler: (query: string) => void) => {
    state.searchPlaceholder = placeholder
    state.searchHandler = handler
  }

  const executeSearch = (query: string) => {
    state.searchHandler?.(query)
  }

  // ============================================
  // BREADCRUMBS
  // ============================================

  const setBreadcrumbs = (items: ToolbarBreadcrumb[]) => {
    state.breadcrumbs = items
  }

  // ============================================
  // LEGACY TOOLBAR CUSTOMIZATION
  // ============================================

  const loadToolbarLayout = async () => {
    if (typeof window === 'undefined') return
    state.loading = true
    try {
      const preferencesStore = usePreferencesStore()
      await preferencesStore.init()
      const savedItems = preferencesStore.toolbarItems
      state.items = savedItems?.length ? savedItems : [...defaultToolbarLayout]
    } catch {
      state.items = [...defaultToolbarLayout]
    } finally {
      state.loading = false
    }
  }



  const registerItem = (item: ToolbarItem) => {
    state.registry.set(item.id, item)
  }

  const toggleCustomize = () => {
    state.isCustomizing = !state.isCustomizing
  }

  // ============================================
  // CLEANUP
  // ============================================

  const clearToolbar = () => {
    // Only clear search and breadcrumbs - these are page-specific
    state.breadcrumbs = []
    state.searchPlaceholder = 'Search...'
    state.searchHandler = null
    // Don't clear pageItems here - navigateWithRotation handles that on actual navigation
    // Clearing here breaks HMR since unmount happens before remount
  }

  // ============================================
  // COMPUTED
  // ============================================

  const rotationTransform = computed(() => `rotateX(${state.rotationAngle}deg)`)

  // Current space config (auto-detected from route)
  const spaceConfig = computed(() => state.frontPanel.spaceConfig)

  // Unified toolbar items: space items + page items
  // Pages don't need to know if they're in a space
  const toolbarItems = computed(() => {
    const items: ToolbarItem[] = []
    const seenIds = new Set<string>()

    // Add page-specific items first (they take priority / have onClick handlers)
    if (state.pageItems.length > 0) {
      for (const item of state.pageItems) {
        seenIds.add(item.id)
        items.push(item)
      }
    }

    // Add space toolbar items (from space.config), skip duplicates
    if (state.frontPanel.spaceToolbarItems.length > 0) {
      for (const item of state.frontPanel.spaceToolbarItems) {
        if (!seenIds.has(item.id)) {
          seenIds.add(item.id)
          items.push({ ...item, type: 'action' as const, category: 'space' as const })
        }
      }
    }

    return items
  })

  // Bottom panel toolbar items (for animation)
  const bottomToolbarItems = computed(() => {
    const items: ToolbarItem[] = []

    if (state.bottomPanel.spaceToolbarItems.length > 0) {
      items.push(...state.bottomPanel.spaceToolbarItems.map(item => ({
        ...item,
        type: 'action' as const,
        category: 'space' as const
      })))
    }

    // Include pending page items (set by new page during rotation)
    if (state.pendingPageItems && state.pendingPageItems.length > 0) {
      items.push(...state.pendingPageItems)
    }

    return items
  })

  return {
    // 3D Rotation
    frontPanel: computed(() => state.frontPanel),
    bottomPanel: computed(() => state.bottomPanel),
    rotationTransform,
    isRotating: computed(() => state.isRotating),

    // Space (auto-detected)
    spaceConfig,

    // Unified toolbar items (space + page items combined)
    toolbarItems,
    bottomToolbarItems,

    // Set page items (works for any page, space or not)
    setPageItems,
    clearPageItems,

    // Search
    searchPlaceholder: computed(() => state.searchPlaceholder),
    hasSearchHandler: computed(() => state.searchHandler !== null),
    setSearch,
    executeSearch,

    // Breadcrumbs
    breadcrumbs: computed(() => state.breadcrumbs),
    setBreadcrumbs,

    // Customization
    isCustomizing: computed(() => state.isCustomizing),
    loading: computed(() => state.loading),
    registerItem,
    toggleCustomize,

    // Init & Cleanup
    initToolbar,
    clearToolbar
  }
}
