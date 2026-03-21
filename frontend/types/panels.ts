// Panel System Type Definitions

import type { Component } from 'vue'

// Space types that can have panels
export type SpaceType = 'code' | 'ui' | 'git' | 'ai' | 'notes' | 'architect' | 'kanban' | 'terminal' | 'chat' | 'design' | 'docs' | 'calendar'

// Panel definition - registered panel types
export interface PanelDefinition {
  id: string
  name: string
  icon: string
  component: Component | string // Component or async import path
  defaultSize: PanelSize
  minSize?: PanelSize
  maxSize?: PanelSize
  allowedSpaces: SpaceType[]
  singleton?: boolean // Only one instance allowed per layout
}

// Panel size in grid units
export interface PanelSize {
  cols: number
  rows: number
}

// Panel position in grid
export interface PanelPosition {
  col: number
  row: number
}

// Panel instance in a layout
export interface PanelInstance {
  id: string // Unique instance ID
  panelType: string // References PanelDefinition.id
  position: PanelPosition
  size: PanelSize
  state?: Record<string, unknown> // Panel-specific state
  collapsed?: boolean
  maximized?: boolean
}

// Complete layout configuration
export interface PanelLayout {
  id?: string
  name?: string
  panels: PanelInstance[]
  gridCols: number // Total grid columns
  gridRows: number // Total grid rows
}

// Layout storage (for persistence)
export interface StoredLayout {
  id: number
  project_id: number
  space_name: SpaceType
  user_id?: number | null // null = project default
  layout: PanelLayout
  created_at: string
  updated_at: string
}

// Resize handle direction
export type ResizeDirection = 'horizontal' | 'vertical' | 'both'

// Resize event data
export interface ResizeEvent {
  panelId: string
  direction: ResizeDirection
  deltaX: number
  deltaY: number
}

// Panel drag event data
export interface PanelDragEvent {
  panelId: string
  fromPosition: PanelPosition
  toPosition: PanelPosition
}

// Panel registry for available panels
export interface PanelRegistry {
  panels: Map<string, PanelDefinition>
  register: (panel: PanelDefinition) => void
  unregister: (id: string) => void
  get: (id: string) => PanelDefinition | undefined
  getForSpace: (space: SpaceType) => PanelDefinition[]
}

// Panel grid state
export interface PanelGridState {
  layout: PanelLayout | null
  isResizing: boolean
  isDragging: boolean
  activePanel: string | null
  hoveredHandle: string | null
}

// Default layouts per space
export const DEFAULT_LAYOUTS: Record<SpaceType, PanelLayout> = {
  code: {
    panels: [
      { id: 'files-1', panelType: 'file-explorer', position: { col: 1, row: 1 }, size: { cols: 1, rows: 3 } },
      { id: 'editor-1', panelType: 'code-editor', position: { col: 2, row: 1 }, size: { cols: 2, rows: 2 } },
      { id: 'terminal-1', panelType: 'terminal', position: { col: 2, row: 3 }, size: { cols: 2, rows: 1 } }
    ],
    gridCols: 3,
    gridRows: 3
  },
  ui: {
    panels: [
      { id: 'assets-1', panelType: 'assets', position: { col: 1, row: 1 }, size: { cols: 1, rows: 3 } },
      { id: 'canvas-1', panelType: 'canvas', position: { col: 2, row: 1 }, size: { cols: 2, rows: 3 } },
      { id: 'properties-1', panelType: 'properties', position: { col: 4, row: 1 }, size: { cols: 1, rows: 3 } }
    ],
    gridCols: 4,
    gridRows: 3
  },
  git: {
    panels: [
      { id: 'repo-1', panelType: 'repository', position: { col: 1, row: 1 }, size: { cols: 1, rows: 3 } },
      { id: 'diff-1', panelType: 'diff', position: { col: 2, row: 1 }, size: { cols: 2, rows: 2 } },
      { id: 'commits-1', panelType: 'commits', position: { col: 2, row: 3 }, size: { cols: 2, rows: 1 } }
    ],
    gridCols: 3,
    gridRows: 3
  },
  ai: {
    panels: [
      { id: 'chat-1', panelType: 'chat', position: { col: 1, row: 1 }, size: { cols: 2, rows: 3 } },
      { id: 'context-1', panelType: 'context', position: { col: 3, row: 1 }, size: { cols: 1, rows: 3 } }
    ],
    gridCols: 3,
    gridRows: 3
  },
  notes: {
    panels: [
      { id: 'docs-1', panelType: 'document-list', position: { col: 1, row: 1 }, size: { cols: 1, rows: 3 } },
      { id: 'editor-1', panelType: 'note-editor', position: { col: 2, row: 1 }, size: { cols: 2, rows: 3 } }
    ],
    gridCols: 3,
    gridRows: 3
  },
  architect: {
    panels: [
      { id: 'chat-1', panelType: 'architect-chat', position: { col: 1, row: 1 }, size: { cols: 2, rows: 3 } },
      { id: 'plan-1', panelType: 'blueprint-outline', position: { col: 3, row: 1 }, size: { cols: 1, rows: 3 } }
    ],
    gridCols: 3,
    gridRows: 3
  },
  kanban: {
    panels: [
      { id: 'board-1', panelType: 'kanban-board', position: { col: 1, row: 1 }, size: { cols: 3, rows: 3 } }
    ],
    gridCols: 3,
    gridRows: 3
  },
  terminal: {
    panels: [
      { id: 'terminal-1', panelType: 'terminal', position: { col: 1, row: 1 }, size: { cols: 3, rows: 3 } }
    ],
    gridCols: 3,
    gridRows: 3
  },
  chat: {
    panels: [
      { id: 'chat-1', panelType: 'chat', position: { col: 1, row: 1 }, size: { cols: 3, rows: 3 } }
    ],
    gridCols: 3,
    gridRows: 3
  },
  design: {
    panels: [
      { id: 'canvas-1', panelType: 'canvas', position: { col: 1, row: 1 }, size: { cols: 3, rows: 3 } }
    ],
    gridCols: 3,
    gridRows: 3
  },
  docs: {
    panels: [
      { id: 'docs-1', panelType: 'document-list', position: { col: 1, row: 1 }, size: { cols: 1, rows: 3 } },
      { id: 'editor-1', panelType: 'document-editor', position: { col: 2, row: 1 }, size: { cols: 2, rows: 3 } }
    ],
    gridCols: 3,
    gridRows: 3
  },
  calendar: {
    panels: [
      { id: 'calendar-1', panelType: 'calendar', position: { col: 1, row: 1 }, size: { cols: 3, rows: 3 } }
    ],
    gridCols: 3,
    gridRows: 3
  }
}
