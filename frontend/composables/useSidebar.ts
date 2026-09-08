import type { SpacePage } from './useSpaces'

export type SidebarPanel = 'main' | 'space' | 'project'

export interface SpaceNavItem extends SpacePage {
  route: string // Full route path
  requiresContext?: boolean // Inherited from SpacePage
}

/**
 * Avatar-style item rendered above the regular nav items on the
 * space-panel face. Used by multi-account spaces (Mail, Calendar, etc.)
 * to surface per-account quick-switchers in the host sidebar instead of
 * burying them inside the space's own UI.
 */
export interface SpaceAccountItem {
  id: string
  label: string         // tooltip text (usually the email or display name)
  route: string         // route to push when clicked (typically the space root with ?account=…)
  avatar?: string       // optional photo URL; falls back to `fallback` initials when missing
  fallback: string      // 1-2 char initials used when no avatar is loaded
  active?: boolean      // true when this account is the currently selected one
}

export interface ProjectSpaceNavItem {
  id: string
  label: string
  icon: string
  route: string
}

export interface SidebarNavItem {
  label: string
  icon: string
  to: string
  spaceName?: string // For spaces with sub-navigation
  pages?: SpaceNavItem[]
}

interface SidebarState {
  panel: SidebarPanel
  mainItems: SidebarNavItem[]
  mainBottomItems: SidebarNavItem[]
  // Space navigation state
  activeSpace: string | null
  activeSpaceItems: SpaceNavItem[]
  activeSpaceAccounts: SpaceAccountItem[]   // optional avatar row above the page items
  spaceBackRoute: string // Route to go back to
  // Project navigation state
  activeProject: { id: string; name: string } | null
  projectSpaceItems: ProjectSpaceNavItem[]
  projectBackRoute: string
}

const sidebarState = reactive<SidebarState>({
  panel: 'main',
  mainItems: [],
  mainBottomItems: [],
  activeSpace: null,
  activeSpaceItems: [],
  activeSpaceAccounts: [],
  spaceBackRoute: '',
  activeProject: null,
  projectSpaceItems: [],
  projectBackRoute: '',
})

export function useSidebar() {
  const setPanel = (panel: SidebarPanel) => {
    sidebarState.panel = panel
  }

  const setMainItems = (items: SidebarNavItem[], bottomItems: SidebarNavItem[] = []) => {
    sidebarState.mainItems = items
    sidebarState.mainBottomItems = bottomItems
  }

  // Enter a space - rotate to space panel
  const enterSpace = (spaceName: string, pageItems: SpaceNavItem[], backRoute: string) => {
    sidebarState.activeSpace = spaceName
    sidebarState.activeSpaceItems = pageItems
    sidebarState.spaceBackRoute = backRoute
    sidebarState.panel = 'space'
  }

  // Exit space - rotate back to main panel
  const exitSpace = () => {
    sidebarState.activeSpace = null
    sidebarState.activeSpaceItems = []
    sidebarState.activeSpaceAccounts = []
    sidebarState.panel = 'main'
  }

  /**
   * Surface per-account avatar buttons on the host sidebar's space-panel
   * face. Called by multi-account spaces (Mail) when their account list
   * loads or changes. Pass an empty array to hide the row again.
   */
  const setSpaceAccounts = (items: SpaceAccountItem[]) => {
    sidebarState.activeSpaceAccounts = items
  }

  // Enter project mode - rotate to project panel
  const enterProject = (
    project: { id: string; name: string },
    items: ProjectSpaceNavItem[],
    backRoute: string
  ) => {
    sidebarState.activeProject = project
    sidebarState.projectSpaceItems = items
    sidebarState.projectBackRoute = backRoute
    sidebarState.panel = 'project'
  }

  // Exit project mode - back to main panel
  const exitProject = () => {
    sidebarState.activeProject = null
    sidebarState.projectSpaceItems = []
    sidebarState.panel = 'main'
  }

  return {
    state: sidebarState,
    setPanel,
    setMainItems,
    enterSpace,
    exitSpace,
    setSpaceAccounts,
    enterProject,
    exitProject,
  }
}
