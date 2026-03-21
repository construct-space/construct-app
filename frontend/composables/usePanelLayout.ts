import type { SpaceType } from '~/types/panels'

// Panel configuration for resizable layout
export interface ResizablePanelConfig {
  id: string
  component: string
  name: string
  defaultSize: number
  minSize: number
  maxSize: number
}

// Layout structure for a space
export interface SpaceLayoutConfig {
  // Horizontal panels (left to right)
  panels: ResizablePanelConfig[]
  // Nested vertical groups (index corresponds to panel that contains nested panels)
  nestedGroups?: Record<number, ResizablePanelConfig[]>
}

// Default layouts for each space - simple two-panel layout: files | editor
const DEFAULT_CODE_LAYOUT: SpaceLayoutConfig = {
  panels: [
    { id: 'file-explorer', component: 'FileExplorer', name: 'Files', defaultSize: 20, minSize: 15, maxSize: 35 },
    { id: 'editor', component: 'Code', name: 'Editor', defaultSize: 80, minSize: 40, maxSize: 85 }
  ]
}

// Alternative layout with file explorer on the right
const CODE_LAYOUT_FILES_RIGHT: SpaceLayoutConfig = {
  panels: [
    { id: 'editor', component: 'Code', name: 'Editor', defaultSize: 80, minSize: 40, maxSize: 85 },
    { id: 'file-explorer', component: 'PanelsFileExplorer', name: 'Files', defaultSize: 20, minSize: 15, maxSize: 35 }
  ]
}

// Predefined layouts
export const PRESET_LAYOUTS: Record<string, SpaceLayoutConfig> = {
  'code-default': DEFAULT_CODE_LAYOUT,
  'code-files-right': CODE_LAYOUT_FILES_RIGHT
}

// Storage key prefix
const STORAGE_KEY_PREFIX = 'panel-layout-'

export function usePanelLayout(space: SpaceType) {
  const currentLayout = ref<SpaceLayoutConfig>(getDefaultLayout(space))
  const isEditMode = ref(false)

  // Get default layout for a space
  function getDefaultLayout(spaceType: SpaceType): SpaceLayoutConfig {
    switch (spaceType) {
      case 'code':
        return { ...DEFAULT_CODE_LAYOUT }
      default:
        return { ...DEFAULT_CODE_LAYOUT }
    }
  }

  // Load saved layout from localStorage
  function loadLayout() {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(`${STORAGE_KEY_PREFIX}${space}`)
      if (saved) {
        try {
          currentLayout.value = JSON.parse(saved)
        } catch {
          currentLayout.value = getDefaultLayout(space)
        }
      }
    }
  }

  // Save layout to localStorage
  function saveLayout() {
    if (typeof window !== 'undefined') {
      localStorage.setItem(`${STORAGE_KEY_PREFIX}${space}`, JSON.stringify(currentLayout.value))
    }
  }

  // Reset to default layout
  function resetLayout() {
    currentLayout.value = getDefaultLayout(space)
    saveLayout()
  }

  // Apply a preset layout
  function applyPreset(presetId: string) {
    const preset = PRESET_LAYOUTS[presetId]
    if (preset) {
      currentLayout.value = { ...preset }
      saveLayout()
    }
  }

  // Swap two panels positions
  function swapPanels(index1: number, index2: number) {
    const panels = [...currentLayout.value.panels]
    const nestedGroups = { ...currentLayout.value.nestedGroups }

    // Swap the panels
    const temp = panels[index1]
    if (temp && panels[index2]) {
      panels[index1] = panels[index2]!
      panels[index2] = temp
    }

    // Also swap nested groups if they exist
    if (nestedGroups) {
      const newNestedGroups: Record<number, ResizablePanelConfig[]> = {}
      Object.entries(nestedGroups).forEach(([key, value]) => {
        const keyNum = parseInt(key)
        if (keyNum === index1) {
          newNestedGroups[index2] = value
        } else if (keyNum === index2) {
          newNestedGroups[index1] = value
        } else {
          newNestedGroups[keyNum] = value
        }
      })
      currentLayout.value = { panels, nestedGroups: newNestedGroups }
      saveLayout()
      return
    }

    currentLayout.value = { panels, nestedGroups }
    saveLayout()
  }

  // Move panel to a specific position
  function movePanelTo(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return

    const panels = [...currentLayout.value.panels]
    const nestedGroups = { ...currentLayout.value.nestedGroups }

    // Remove panel from original position
    const [movedPanel] = panels.splice(fromIndex, 1)
    if (!movedPanel) return

    // Insert at new position
    panels.splice(toIndex, 0, movedPanel)

    // Rebuild nested groups with new indices
    const newNestedGroups: Record<number, ResizablePanelConfig[]> = {}
    if (nestedGroups) {
      Object.entries(nestedGroups).forEach(([key, value]) => {
        const oldIndex = parseInt(key)
        let newIndex = oldIndex

        if (oldIndex === fromIndex) {
          newIndex = toIndex
        } else if (fromIndex < toIndex) {
          if (oldIndex > fromIndex && oldIndex <= toIndex) {
            newIndex = oldIndex - 1
          }
        } else {
          if (oldIndex >= toIndex && oldIndex < fromIndex) {
            newIndex = oldIndex + 1
          }
        }

        newNestedGroups[newIndex] = value
      })
    }

    currentLayout.value = { panels, nestedGroups: newNestedGroups }
    saveLayout()
  }

  // Toggle edit mode
  function toggleEditMode() {
    isEditMode.value = !isEditMode.value
  }

  // Rearrange panel based on drop position - uses remove/insert for proper nesting
  function rearrangePanel(
    draggedId: string,
    targetId: string,
    position: 'top' | 'bottom' | 'left' | 'right'
  ) {
    // Find the dragged panel
    let draggedPanel: ResizablePanelConfig | null = null

    // Check top-level panels
    for (const panel of currentLayout.value.panels) {
      if (panel.id === draggedId) {
        draggedPanel = { ...panel }
        break
      }
    }

    // Check nested panels
    if (!draggedPanel && currentLayout.value.nestedGroups) {
      for (const nested of Object.values(currentLayout.value.nestedGroups)) {
        for (const panel of nested) {
          if (panel.id === draggedId) {
            draggedPanel = { ...panel }
            break
          }
        }
        if (draggedPanel) break
      }
    }

    if (!draggedPanel) return

    // Step 1: Remove the dragged panel from its current location
    let layout = removePanelFromLayout(draggedId)
    if (!layout) return

    // Step 2: Insert the panel at the target position
    layout = insertPanelAtPosition(layout, draggedPanel, targetId, position)
    if (!layout) return

    currentLayout.value = layout
    saveLayout()
  }

  // Get all panels flattened (including nested) - kept for potential future use
  function _getAllFlatPanels(): ResizablePanelConfig[] {
    const panels: ResizablePanelConfig[] = []
    currentLayout.value.panels.forEach((panel, index) => {
      if (panel.component) {
        panels.push(panel)
      }
      const nested = currentLayout.value.nestedGroups?.[index]
      if (nested) {
        panels.push(...nested)
      }
    })
    return panels
  }

  // Remove a panel from the layout and return new layout
  function removePanelFromLayout(panelId: string): SpaceLayoutConfig | null {
    const layout = JSON.parse(JSON.stringify(currentLayout.value)) as SpaceLayoutConfig

    // Check top-level panels
    const topLevelIndex = layout.panels.findIndex(p => p.id === panelId)
    if (topLevelIndex !== -1) {
      const panel = layout.panels[topLevelIndex]
      // If it's a container with nested panels, can't remove it directly
      if (!panel?.component && layout.nestedGroups?.[topLevelIndex]) {
        return null
      }
      layout.panels.splice(topLevelIndex, 1)
      // Update nested group indices
      if (layout.nestedGroups) {
        const newNested: Record<number, ResizablePanelConfig[]> = {}
        Object.entries(layout.nestedGroups).forEach(([key, value]) => {
          const idx = parseInt(key)
          if (idx > topLevelIndex) {
            newNested[idx - 1] = value
          } else if (idx < topLevelIndex) {
            newNested[idx] = value
          }
        })
        layout.nestedGroups = newNested
      }
      return layout
    }

    // Check nested panels
    if (layout.nestedGroups) {
      for (const [key, nested] of Object.entries(layout.nestedGroups)) {
        const nestedIndex = nested.findIndex(p => p.id === panelId)
        if (nestedIndex !== -1) {
          nested.splice(nestedIndex, 1)
          const groupIndex = parseInt(key)
          // If only one panel left in nested, promote it to top level
          if (nested.length === 1) {
            layout.panels[groupIndex] = nested[0]!
            // Rebuild without the deleted key
            const newNested: Record<number, ResizablePanelConfig[]> = {}
            Object.entries(layout.nestedGroups).forEach(([k, v]) => {
              const idx = parseInt(k)
              if (idx !== groupIndex) {
                newNested[idx] = v
              }
            })
            layout.nestedGroups = Object.keys(newNested).length ? newNested : undefined
          } else if (nested.length === 0) {
            // Remove empty nested group - rebuild without the deleted key
            const newNested: Record<number, ResizablePanelConfig[]> = {}
            Object.entries(layout.nestedGroups).forEach(([k, v]) => {
              const idx = parseInt(k)
              if (idx !== groupIndex) {
                newNested[idx] = v
              }
            })
            layout.nestedGroups = Object.keys(newNested).length ? newNested : undefined
          }
          return layout
        }
      }
    }

    return layout
  }

  // Insert panel at position relative to target
  function insertPanelAtPosition(
    layout: SpaceLayoutConfig,
    panel: ResizablePanelConfig,
    targetId: string,
    position: 'top' | 'bottom' | 'left' | 'right'
  ): SpaceLayoutConfig | null {
    // Find target in top-level panels
    const targetTopIndex = layout.panels.findIndex(p => p.id === targetId)

    if (targetTopIndex !== -1) {
      const targetPanel = layout.panels[targetTopIndex]!

      if (position === 'left') {
        // Insert before target
        layout.panels.splice(targetTopIndex, 0, panel)
        // Shift nested group indices
        if (layout.nestedGroups) {
          const newNested: Record<number, ResizablePanelConfig[]> = {}
          Object.entries(layout.nestedGroups).forEach(([key, value]) => {
            const idx = parseInt(key)
            newNested[idx >= targetTopIndex ? idx + 1 : idx] = value
          })
          layout.nestedGroups = newNested
        }
      } else if (position === 'right') {
        // Insert after target
        layout.panels.splice(targetTopIndex + 1, 0, panel)
        // Shift nested group indices
        if (layout.nestedGroups) {
          const newNested: Record<number, ResizablePanelConfig[]> = {}
          Object.entries(layout.nestedGroups).forEach(([key, value]) => {
            const idx = parseInt(key)
            newNested[idx > targetTopIndex ? idx + 1 : idx] = value
          })
          layout.nestedGroups = newNested
        }
      } else if (position === 'top' || position === 'bottom') {
        // Create a nested group with target and dragged panel
        const container: ResizablePanelConfig = {
          id: `container-${Date.now()}`,
          component: '',
          name: 'Container',
          defaultSize: targetPanel.defaultSize,
          minSize: targetPanel.minSize,
          maxSize: targetPanel.maxSize
        }
        layout.panels[targetTopIndex] = container

        const nestedPanels = position === 'top'
          ? [{ ...panel, defaultSize: 50 }, { ...targetPanel, defaultSize: 50 }]
          : [{ ...targetPanel, defaultSize: 50 }, { ...panel, defaultSize: 50 }]

        if (!layout.nestedGroups) layout.nestedGroups = {}
        layout.nestedGroups[targetTopIndex] = nestedPanels
      }

      return layout
    }

    // Find target in nested panels
    if (layout.nestedGroups) {
      for (const [key, nested] of Object.entries(layout.nestedGroups)) {
        const nestedIndex = nested.findIndex(p => p.id === targetId)
        if (nestedIndex !== -1) {
          const groupIndex = parseInt(key)

          if (position === 'top') {
            nested.splice(nestedIndex, 0, panel)
          } else if (position === 'bottom') {
            nested.splice(nestedIndex + 1, 0, panel)
          } else if (position === 'left' || position === 'right') {
            // Pull panel out to top level and create horizontal arrangement
            // Insert the dragged panel as a new top-level panel

            if (position === 'left') {
              // Insert panel before the nested group's container
              layout.panels.splice(groupIndex, 0, panel)
              // Update nested group indices (shift everything after by 1)
              const newNestedGroups: Record<number, ResizablePanelConfig[]> = {}
              Object.entries(layout.nestedGroups!).forEach(([k, v]) => {
                const idx = parseInt(k)
                if (idx >= groupIndex) {
                  newNestedGroups[idx + 1] = v
                } else {
                  newNestedGroups[idx] = v
                }
              })
              layout.nestedGroups = newNestedGroups
            } else {
              // Insert panel after the nested group's container
              layout.panels.splice(groupIndex + 1, 0, panel)
              // Update nested group indices (shift everything after by 1)
              const newNestedGroups: Record<number, ResizablePanelConfig[]> = {}
              Object.entries(layout.nestedGroups!).forEach(([k, v]) => {
                const idx = parseInt(k)
                if (idx > groupIndex) {
                  newNestedGroups[idx + 1] = v
                } else {
                  newNestedGroups[idx] = v
                }
              })
              layout.nestedGroups = newNestedGroups
            }

            // Rebalance sizes for the new arrangement
            const panelCount = layout.panels.length
            const evenSize = 100 / panelCount
            layout.panels.forEach(p => {
              p.defaultSize = evenSize
            })
          }

          return layout
        }
      }
    }

    return layout
  }

  // Get available panels for adding
  function getAvailablePanels(): ResizablePanelConfig[] {
    const { getPanelsForSpace } = usePanels()
    const definitions = getPanelsForSpace(space)

    return definitions.map(def => ({
      id: def.id,
      component: def.component as string,
      name: def.name,
      defaultSize: 50,
      minSize: 15,
      maxSize: 85
    }))
  }

  // Initialize on mount
  onMounted(() => {
    loadLayout()
  })

  return {
    currentLayout,
    isEditMode,
    loadLayout,
    saveLayout,
    resetLayout,
    applyPreset,
    swapPanels,
    movePanelTo,
    toggleEditMode,
    rearrangePanel,
    getAvailablePanels
  }
}
