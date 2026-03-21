/**
 * Composable for making modals/windows draggable and resizable
 * with localStorage persistence
 */

import { ref, computed, onUnmounted } from 'vue'

export interface WindowState {
  x: number
  y: number
  width: number
  height: number
}

export interface DraggableWindowOptions {
  /** Storage key for persisting position */
  storageKey: string
  /** Default width */
  defaultWidth?: number
  /** Default height */
  defaultHeight?: number
  /** Minimum width */
  minWidth?: number
  /** Minimum height */
  minHeight?: number
  /** Whether to enable resize handles */
  resizable?: boolean
}

export const useDraggableWindow = (options: DraggableWindowOptions) => {
  const {
    storageKey,
    defaultWidth = 600,
    defaultHeight = 500,
    minWidth = 300,
    minHeight = 200,
    resizable = true,
  } = options

  // State
  const windowState = ref<WindowState | null>(null)
  const isDragging = ref(false)
  const isResizing = ref(false)
  const resizeDirection = ref<string | null>(null)
  const dragOffset = ref({ x: 0, y: 0 })

  // Load from localStorage
  const loadWindowState = () => {
    if (typeof window === 'undefined') return
    try {
      const stored = localStorage.getItem(storageKey)
      if (stored) {
        windowState.value = JSON.parse(stored)
      }
    } catch (e) {
      console.warn(`[useDraggableWindow] Failed to load state for ${storageKey}:`, e)
    }
  }

  // Save to localStorage
  const saveWindowState = () => {
    if (typeof window === 'undefined') return
    try {
      if (windowState.value) {
        localStorage.setItem(storageKey, JSON.stringify(windowState.value))
      } else {
        localStorage.removeItem(storageKey)
      }
    } catch (e) {
      console.warn(`[useDraggableWindow] Failed to save state for ${storageKey}:`, e)
    }
  }

  // Initialize centered position
  const initWindowState = () => {
    if (!windowState.value && typeof window !== 'undefined') {
      windowState.value = {
        x: Math.max(80, (window.innerWidth - defaultWidth) / 2),
        y: Math.max(20, (window.innerHeight - defaultHeight) / 2),
        width: defaultWidth,
        height: defaultHeight,
      }
    }
  }

  // Drag handlers
  const startDrag = (e: MouseEvent) => {
    if (!windowState.value) return
    isDragging.value = true
    dragOffset.value = {
      x: e.clientX - windowState.value.x,
      y: e.clientY - windowState.value.y,
    }
    document.addEventListener('mousemove', onDrag)
    document.addEventListener('mouseup', stopDrag)
  }

  const onDrag = (e: MouseEvent) => {
    if (!isDragging.value || !windowState.value) return
    windowState.value.x = Math.max(0, Math.min(window.innerWidth - 200, e.clientX - dragOffset.value.x))
    windowState.value.y = Math.max(0, Math.min(window.innerHeight - 100, e.clientY - dragOffset.value.y))
  }

  const stopDrag = () => {
    isDragging.value = false
    document.removeEventListener('mousemove', onDrag)
    document.removeEventListener('mouseup', stopDrag)
    saveWindowState()
  }

  // Resize handlers
  const startResize = (e: MouseEvent, direction: string) => {
    if (!windowState.value || !resizable) return
    e.preventDefault()
    e.stopPropagation()
    isResizing.value = true
    resizeDirection.value = direction
    document.addEventListener('mousemove', onResize)
    document.addEventListener('mouseup', stopResize)
  }

  const onResize = (e: MouseEvent) => {
    if (!isResizing.value || !windowState.value || !resizeDirection.value) return
    
    const dir = resizeDirection.value
    
    if (dir.includes('e')) {
      windowState.value.width = Math.max(minWidth, e.clientX - windowState.value.x)
    }
    if (dir.includes('w')) {
      const newW = windowState.value.width + (windowState.value.x - e.clientX)
      if (newW >= minWidth) {
        windowState.value.x = e.clientX
        windowState.value.width = newW
      }
    }
    if (dir.includes('s')) {
      windowState.value.height = Math.max(minHeight, e.clientY - windowState.value.y)
    }
    if (dir.includes('n')) {
      const newH = windowState.value.height + (windowState.value.y - e.clientY)
      if (newH >= minHeight) {
        windowState.value.y = e.clientY
        windowState.value.height = newH
      }
    }
  }

  const stopResize = () => {
    isResizing.value = false
    resizeDirection.value = null
    document.removeEventListener('mousemove', onResize)
    document.removeEventListener('mouseup', stopResize)
    saveWindowState()
  }

  // Toggle between windowed and default (centered) mode
  const toggleWindowed = () => {
    if (windowState.value) {
      windowState.value = null
    } else {
      initWindowState()
    }
    saveWindowState()
  }

  // Reset to center
  const resetPosition = () => {
    windowState.value = null
    initWindowState()
    saveWindowState()
  }

  // Computed style for the window
  const windowStyle = computed(() => {
    if (!windowState.value) return {}
    return {
      position: 'fixed' as const,
      left: `${windowState.value.x}px`,
      top: `${windowState.value.y}px`,
      width: `${windowState.value.width}px`,
      height: `${windowState.value.height}px`,
    }
  })

  // Check if in windowed mode
  const isWindowed = computed(() => windowState.value !== null)

  // Cleanup on unmount
  onUnmounted(() => {
    document.removeEventListener('mousemove', onDrag)
    document.removeEventListener('mouseup', stopDrag)
    document.removeEventListener('mousemove', onResize)
    document.removeEventListener('mouseup', stopResize)
  })

  return {
    // State
    windowState,
    isDragging,
    isResizing,
    isWindowed,
    
    // Computed
    windowStyle,
    
    // Actions
    loadWindowState,
    saveWindowState,
    initWindowState,
    toggleWindowed,
    resetPosition,
    
    // Handlers
    startDrag,
    startResize,
  }
}
