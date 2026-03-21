import type { SpacePage } from './useSpaces'

export type SidebarPanel = 'main' | 'space' | 'project'

export interface SpaceNavItem extends SpacePage {
  route: string // Full route path
  requiresContext?: boolean // Inherited from SpacePage
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
    sidebarState.panel = 'main'
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
    enterProject,
    exitProject,
  }
}
