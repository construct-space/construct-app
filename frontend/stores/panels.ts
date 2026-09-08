import { defineStore } from 'pinia'
import type { PanelLayout, PanelInstance, SpaceType } from '~/types/panels'
import { DEFAULT_LAYOUTS } from '~/types/panels'

interface PanelsState {
  // Current layout per space
  layouts: Record<string, PanelLayout>
  // Active space
  activeSpace: SpaceType | null
  // Maximized panel ID (only one can be maximized at a time)
  maximizedPanel: string | null
  // Loading state
  isLoading: boolean
  // Dirty state (layout has unsaved changes)
  isDirty: boolean
}

export const usePanelsStore = defineStore('panels', {
  state: (): PanelsState => ({
    layouts: {},
    activeSpace: null,
    maximizedPanel: null,
    isLoading: false,
    isDirty: false
  }),

  getters: {
    // Get current layout for active space
    currentLayout: (state): PanelLayout | null => {
      if (!state.activeSpace) return null
      return state.layouts[state.activeSpace] ?? null
    },

    // Get layout for specific space
    getLayout: (state) => (space: SpaceType): PanelLayout | null => {
      return state.layouts[space] ?? null
    },

    // Check if a panel is maximized
    isPanelMaximized: (state) => (panelId: string): boolean => {
      return state.maximizedPanel === panelId
    }
  },

  actions: {
    // Set active space
    setActiveSpace(space: SpaceType) {
      this.activeSpace = space

      // Load default layout if not exists
      if (!this.layouts[space]) {
        this.layouts[space] = { ...DEFAULT_LAYOUTS[space] }
      }
    },

    // Update layout for a space
    updateLayout(space: SpaceType, layout: PanelLayout) {
      this.layouts[space] = layout
      this.isDirty = true
    },

    // Add panel to current layout
    addPanel(panel: PanelInstance) {
      if (!this.activeSpace) return
      const layout = this.layouts[this.activeSpace]
      if (!layout) return

      layout.panels.push(panel)
      this.isDirty = true
    },

    // Remove panel from current layout
    removePanel(panelId: string) {
      if (!this.activeSpace) return
      const layout = this.layouts[this.activeSpace]
      if (!layout) return

      const index = layout.panels.findIndex(p => p.id === panelId)

      if (index !== -1) {
        layout.panels.splice(index, 1)
        this.isDirty = true

        // Clear maximized if this panel was maximized
        if (this.maximizedPanel === panelId) {
          this.maximizedPanel = null
        }
      }
    },

    // Update a specific panel
    updatePanel(panelId: string, updates: Partial<PanelInstance>) {
      if (!this.activeSpace) return
      const layout = this.layouts[this.activeSpace]
      if (!layout) return

      const panel = layout.panels.find(p => p.id === panelId)

      if (panel) {
        Object.assign(panel, updates)
        this.isDirty = true
      }
    },

    // Toggle panel collapse
    togglePanelCollapse(panelId: string) {
      if (!this.activeSpace) return
      const layout = this.layouts[this.activeSpace]
      if (!layout) return

      const panel = layout.panels.find(p => p.id === panelId)

      if (panel) {
        panel.collapsed = !panel.collapsed
        this.isDirty = true
      }
    },

    // Toggle panel maximize
    togglePanelMaximize(panelId: string) {
      if (this.maximizedPanel === panelId) {
        this.maximizedPanel = null
      } else {
        this.maximizedPanel = panelId
      }
    },

    // Reset layout to default
    resetToDefault(space: SpaceType) {
      this.layouts[space] = { ...DEFAULT_LAYOUTS[space] }
      this.maximizedPanel = null
      this.isDirty = true
    },

    // Load layout — local-only, use localStorage
    async loadLayout(_projectId: number, space: SpaceType) {
      this.isLoading = true
      try {
        const key = `construct_layout_${space}`
        const stored = localStorage.getItem(key)
        if (stored) {
          this.layouts[space] = JSON.parse(stored)
        } else {
          this.layouts[space] = { ...DEFAULT_LAYOUTS[space] }
        }
        this.isDirty = false
      } catch {
        this.layouts[space] = { ...DEFAULT_LAYOUTS[space] }
      } finally {
        this.isLoading = false
      }
    },

    // Save layout — local-only, use localStorage
    async saveLayout(_projectId: number, space: SpaceType) {
      if (!this.layouts[space]) return
      try {
        const key = `construct_layout_${space}`
        localStorage.setItem(key, JSON.stringify(this.layouts[space]))
        this.isDirty = false
      } catch (error) {
        console.error('Failed to save layout:', error)
      }
    },

    // Save layout to localStorage for quick access
    persistToLocalStorage(projectId: number, space: SpaceType) {
      if (!this.layouts[space]) return

      const key = `panel-layout-${projectId}-${space}`
      localStorage.setItem(key, JSON.stringify(this.layouts[space]))
    },

    // Load layout from localStorage
    loadFromLocalStorage(projectId: number, space: SpaceType): boolean {
      const key = `panel-layout-${projectId}-${space}`
      const stored = localStorage.getItem(key)

      if (stored) {
        try {
          this.layouts[space] = JSON.parse(stored)
          return true
        } catch {
          return false
        }
      }

      return false
    }
  }
})
