import type { PanelDefinition, SpaceType } from '~/types/panels'

// Panel registry - stores all available panel definitions
const panelRegistry = new Map<string, PanelDefinition>()

// Register default panels
const defaultPanels: PanelDefinition[] = [
  // Code space panels
  {
    id: 'file-explorer',
    name: 'Files',
    icon: 'i-lucide-folder-tree',
    component: 'FileExplorer',
    defaultSize: { cols: 1, rows: 3 },
    minSize: { cols: 1, rows: 1 },
    allowedSpaces: ['code']
  },
  {
    id: 'code-editor',
    name: 'Editor',
    icon: 'i-lucide-code',
    component: 'Code',
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 1, rows: 1 },
    allowedSpaces: ['code']
  },
  {
    id: 'preview',
    name: 'Preview',
    icon: 'i-lucide-eye',
    component: 'PanelsPreview',
    defaultSize: { cols: 1, rows: 2 },
    minSize: { cols: 1, rows: 1 },
    allowedSpaces: ['code']
  },

  // UI space panels
  {
    id: 'assets',
    name: 'Assets',
    icon: 'i-lucide-image',
    component: 'PanelsUIAssets',
    defaultSize: { cols: 1, rows: 3 },
    minSize: { cols: 1, rows: 1 },
    allowedSpaces: ['ui']
  },
  {
    id: 'canvas',
    name: 'Canvas',
    icon: 'i-lucide-frame',
    component: 'PanelsUICanvas',
    defaultSize: { cols: 2, rows: 3 },
    minSize: { cols: 1, rows: 1 },
    allowedSpaces: ['ui'],
    singleton: true
  },
  {
    id: 'properties',
    name: 'Properties',
    icon: 'i-lucide-sliders',
    component: 'PanelsUIProperties',
    defaultSize: { cols: 1, rows: 3 },
    minSize: { cols: 1, rows: 1 },
    allowedSpaces: ['ui']
  },

  // Git space panels
  {
    id: 'repository',
    name: 'Repository',
    icon: 'i-lucide-git-branch',
    component: 'PanelsGitRepository',
    defaultSize: { cols: 1, rows: 3 },
    minSize: { cols: 1, rows: 1 },
    allowedSpaces: ['git']
  },
  {
    id: 'diff',
    name: 'Diff',
    icon: 'i-lucide-diff',
    component: 'PanelsGitDiff',
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 1, rows: 1 },
    allowedSpaces: ['git']
  },
  {
    id: 'commits',
    name: 'Commits',
    icon: 'i-lucide-git-commit',
    component: 'PanelsGitCommits',
    defaultSize: { cols: 2, rows: 1 },
    minSize: { cols: 1, rows: 1 },
    allowedSpaces: ['git']
  },

  // AI space panels
  {
    id: 'chat',
    name: 'Chat',
    icon: 'i-lucide-message-square',
    component: 'PanelsAiChat',
    defaultSize: { cols: 2, rows: 3 },
    minSize: { cols: 1, rows: 1 },
    allowedSpaces: ['ai'],
    singleton: true
  },
  {
    id: 'context',
    name: 'Context',
    icon: 'i-lucide-file-search',
    component: 'PanelsAiContext',
    defaultSize: { cols: 1, rows: 3 },
    minSize: { cols: 1, rows: 1 },
    allowedSpaces: ['ai']
  },

  // Notes space panels
  {
    id: 'document-list',
    name: 'Documents',
    icon: 'i-lucide-file-text',
    component: 'PanelsNotesDocumentList',
    defaultSize: { cols: 1, rows: 3 },
    minSize: { cols: 1, rows: 1 },
    allowedSpaces: ['notes']
  },
  {
    id: 'note-editor',
    name: 'Editor',
    icon: 'i-lucide-edit',
    component: 'PanelsNotesEditor',
    defaultSize: { cols: 2, rows: 3 },
    minSize: { cols: 1, rows: 1 },
    allowedSpaces: ['notes'],
    singleton: true
  }
]

// Initialize default panels
defaultPanels.forEach(panel => {
  panelRegistry.set(panel.id, panel)
})

export function usePanels() {
  // Register a new panel definition
  const registerPanel = (panel: PanelDefinition) => {
    panelRegistry.set(panel.id, panel)
  }

  // Unregister a panel definition
  const unregisterPanel = (id: string) => {
    panelRegistry.delete(id)
  }

  // Get a panel definition by ID
  const getPanelDefinition = (id: string): PanelDefinition | undefined => {
    return panelRegistry.get(id)
  }

  // Get all panels available for a specific space
  const getPanelsForSpace = (space: SpaceType): PanelDefinition[] => {
    return Array.from(panelRegistry.values()).filter(
      panel => panel.allowedSpaces.includes(space)
    )
  }

  // Get all registered panels
  const getAllPanels = (): PanelDefinition[] => {
    return Array.from(panelRegistry.values())
  }

  // Generate unique panel instance ID
  const generatePanelId = (panelType: string): string => {
    return `${panelType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  // Create a new panel instance
  const createPanelInstance = (
    panelType: string,
    position: { col: number; row: number }
  ) => {
    const definition = getPanelDefinition(panelType)
    if (!definition) {
      throw new Error(`Panel type "${panelType}" not found in registry`)
    }

    return {
      id: generatePanelId(panelType),
      panelType,
      position,
      size: { ...definition.defaultSize },
      collapsed: false,
      maximized: false
    }
  }

  return {
    registerPanel,
    unregisterPanel,
    getPanelDefinition,
    getPanelsForSpace,
    getAllPanels,
    generatePanelId,
    createPanelInstance
  }
}
