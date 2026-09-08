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
import { clearToolbarSlots } from '@/composables/useToolbarSlots'

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
  /** Slot to render this item in. Defaults to 'center'. */
  position?: 'left' | 'center' | 'right'
}

export interface ToolbarBreadcrumb {
  label: string
  icon?: string
  iconColor?: string
  to?: string
  /** Dropdown of sibling destinations; selecting navigates to its `to`. */
  options?: { label: string; to: string }[]
}

interface PanelContent {
  path: string
  spaceName: string | null
  spaceConfig: SpaceConfig | null
  spaceToolbarItems: SpaceToolbarItem[]
  /** Snapshot of the breadcrumbs the page on this face is showing. Keeps the
   * outgoing face frozen while the cube rotates, instead of both faces sharing
   * the live `state.breadcrumbs`. */
  breadcrumbs: ToolbarBreadcrumb[]
  /** Same idea for page-level toolbar items. */
  pageItems: ToolbarItem[]
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
  /** Breadcrumbs set by a newly-mounted page before navigateWithRotation
   * has had a chance to copy them to the bottom panel. */
  pendingBreadcrumbs: ToolbarBreadcrumb[] | null

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
  spaceToolbarItems: [],
  breadcrumbs: [],
  pageItems: [],
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
  pendingBreadcrumbs: null,

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
      breadcrumbs: [],
      pageItems: [],
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

    // Ping-pong rotation: the cube alternates between rotationAngle 0 and
    // 90 with each navigation, swapping which DOM face is currently in
    // view. New content goes on the face that is about to rotate IN; the
    // old face holds the outgoing content and stays in the DOM behind/
    // below. Because we never reset rotationAngle, there is no end-of-
    // animation "snap" — the cube rests where it lands, content already
    // in place.
    const incoming = buildPanelContent(path, spaceName)
    incoming.breadcrumbs = state.pendingBreadcrumbs ?? []
    incoming.pageItems = state.pendingPageItems ?? []

    if (state.rotationAngle === 0) {
      // Front is visible → place new content on bottom panel, rotate to 90.
      state.bottomPanel = incoming
      state.rotationAngle = 90
    } else {
      // Bottom is visible → place new content on front panel, rotate to 0.
      state.frontPanel = incoming
      state.rotationAngle = 0
    }
    state.isRotating = true

    setTimeout(() => {
      state.isRotating = false
      state.previousPath = path

      // Mirror pending items into state.pageItems (the live ref read by
      // legacy consumers). The visible panel already carries them.
      if (state.pendingPageItems && state.pendingPageItems.length > 0) {
        state.pageItems = state.pendingPageItems
      }
      state.pendingPageItems = null
      state.pendingBreadcrumbs = null
    }, 500)
  }

  // Which DOM face is currently in view of the camera. Driven by
  // rotationAngle so it stays in sync without extra bookkeeping.
  // Used by setPageItems / setBreadcrumbs / toolbarItems and exposed
  // to consumers (Toolbar3D) for "what's visible right now" queries.
  const visiblePanel = computed(() => state.rotationAngle === 0 ? state.frontPanel : state.bottomPanel)
  function writeVisible(patch: Partial<PanelContent>) {
    if (state.rotationAngle === 0) Object.assign(state.frontPanel, patch)
    else Object.assign(state.bottomPanel, patch)
  }

  function clearTransientToolbarContent() {
    state.pageItems = []
    state.pendingPageItems = null
    state.pendingBreadcrumbs = null
    state.breadcrumbs = []
    state.searchPlaceholder = 'Search...'
    state.searchHandler = null
    state.frontPanel.pageItems = []
    state.bottomPanel.pageItems = []
    state.frontPanel.breadcrumbs = []
    state.bottomPanel.breadcrumbs = []
    clearToolbarSlots()
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
    clearTransientToolbarContent()
    if (state.spacesInitialized) {
      navigateWithRotation()
    }
  }, { immediate: false, flush: 'pre' })

  // ============================================
  // PAGE TOOLBAR ITEMS
  // ============================================

  const setPageItems = (items: ToolbarItem[]) => {
    // Route incoming page items to whichever panel they belong to so the cube
    // can show the OLD page on the front and the NEW page on the bottom
    // during rotation. We detect "incoming" by comparing the current route
    // path to the front panel's snapshot — Vue Router updates route.path
    // before the new component's setup runs, so by the time the new component
    // calls setPageItems, route.path is already the new path.
    state.pageItems = items
    if (state.isRotating) {
      // Mid-rotation — items belong to the incoming face (the one currently
      // rotating into view). With ping-pong that's whichever panel matches
      // the new rotationAngle, which is exactly `visiblePanel`.
      writeVisible({ pageItems: items })
      state.pendingPageItems = items
    } else if (state.spacesInitialized && route.path !== visiblePanel.value.path) {
      // New component mounted before navigateWithRotation fired. Stage on
      // the hidden side; the rotation step picks it up.
      state.pendingPageItems = items
    } else {
      // No nav in progress — items belong to the currently-visible face.
      writeVisible({ pageItems: items })
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
    state.pendingPageItems = null
    state.frontPanel.pageItems = []
    state.bottomPanel.pageItems = []
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
    if (state.isRotating) {
      // Mid-rotation — visible panel already points at the incoming face.
      writeVisible({ breadcrumbs: items })
    } else if (state.spacesInitialized && route.path !== visiblePanel.value.path) {
      // Incoming page mounted ahead of navigateWithRotation. Stage; the
      // rotation step will land these on the hidden side.
      state.pendingBreadcrumbs = items
    } else {
      writeVisible({ breadcrumbs: items })
    }
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
    clearTransientToolbarContent()
  }

  // ============================================
  // COMPUTED
  // ============================================

  const rotationTransform = computed(() => `rotateX(${state.rotationAngle}deg)`)

  // Current space config — derived from the face the user is looking at.
  const spaceConfig = computed(() => visiblePanel.value.spaceConfig)

  // Items rendered on the front-face DOM element. Tied to state.frontPanel
  // regardless of which face is currently in view — the DOM-to-panel
  // mapping is fixed, and CSS handles which face the camera sees.
  const toolbarItems = computed(() => {
    const items: ToolbarItem[] = []
    const seenIds = new Set<string>()
    const panel = state.frontPanel

    const pageItems = panel.pageItems.length > 0
      ? panel.pageItems
      : (state.rotationAngle === 0 ? state.pageItems : [])

    if (pageItems.length > 0) {
      for (const item of pageItems) {
        seenIds.add(item.id)
        items.push(item)
      }
    }

    if (panel.spaceToolbarItems.length > 0) {
      for (const item of panel.spaceToolbarItems) {
        if (!seenIds.has(item.id)) {
          seenIds.add(item.id)
          items.push({ ...item, type: 'action' as const, category: 'space' as const })
        }
      }
    }

    return items
  })

  // Items rendered on the bottom-face DOM element. Tied to state.bottomPanel.
  const bottomToolbarItems = computed(() => {
    const items: ToolbarItem[] = []
    const panel = state.bottomPanel

    if (panel.pageItems.length > 0) {
      items.push(...panel.pageItems)
    } else if (state.rotationAngle === 90) {
      items.push(...state.pageItems)
    }

    if (panel.spaceToolbarItems.length > 0) {
      items.push(...panel.spaceToolbarItems.map(item => ({
        ...item,
        type: 'action' as const,
        category: 'space' as const
      })))
    }

    // Pending items from a new page that mounted mid-rotation
    if (state.isRotating && state.pendingPageItems && state.pendingPageItems.length > 0) {
      items.push(...state.pendingPageItems)
    }

    return items
  })

  return {
    // 3D Rotation
    frontPanel: computed(() => state.frontPanel),
    bottomPanel: computed(() => state.bottomPanel),
    /** The face currently in view of the camera (ping-pong: front at
     *  angle 0, bottom at angle 90). Use this for "what's the active
     *  panel right now" queries; the literal front/bottom refs only
     *  describe DOM placement. */
    visiblePanel,
    rotationTransform,
    isRotating: computed(() => state.isRotating),

    // Space (auto-detected)
    spaceConfig,

    // Unified toolbar items (space + page items combined)
    toolbarItems,
    bottomToolbarItems,

    // Items grouped by `position` field. Items without position default
    // to 'center', preserving the legacy layout for spaces that haven't
    // started using positions yet.
    toolbarItemsLeft: computed(() => toolbarItems.value.filter(i => i.position === 'left')),
    toolbarItemsCenter: computed(() => toolbarItems.value.filter(i => !i.position || i.position === 'center')),
    toolbarItemsRight: computed(() => toolbarItems.value.filter(i => i.position === 'right')),

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
