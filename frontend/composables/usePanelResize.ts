import { ref, computed, onUnmounted } from 'vue'

export interface UsePanelResizeOptions {
  axis: 'x' | 'y'
  initial: number
  min?: number
  max?: number
  containerRef: Ref<HTMLElement | null>
  onResizeStart?: () => void
  onResizeEnd?: () => void
}

export function usePanelResize(options: UsePanelResizeOptions) {
  const {
    axis,
    initial,
    min = 0,
    max = Infinity,
    containerRef,
    onResizeStart,
    onResizeEnd
  } = options

  const position = ref(initial)
  const isDragging = ref(false)
  const startPosition = ref(0)
  const startMousePos = ref(0)

  const clamp = (value: number, minVal: number, maxVal: number) => {
    return Math.min(Math.max(value, minVal), maxVal)
  }

  const handlePointerDown = (event: PointerEvent) => {
    event.preventDefault()
    isDragging.value = true
    startPosition.value = position.value
    startMousePos.value = axis === 'x' ? event.clientX : event.clientY

    onResizeStart?.()

    document.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('pointerup', handlePointerUp)
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
  }

  const handlePointerMove = (event: PointerEvent) => {
    if (!isDragging.value) return

    const currentPos = axis === 'x' ? event.clientX : event.clientY
    const delta = currentPos - startMousePos.value
    const newPosition = startPosition.value + delta

    // Get container size for max constraint
    let maxConstraint = max
    if (containerRef.value && max === Infinity) {
      const rect = containerRef.value.getBoundingClientRect()
      maxConstraint = axis === 'x' ? rect.width : rect.height
    }

    position.value = clamp(newPosition, min, maxConstraint)
  }

  const handlePointerUp = () => {
    isDragging.value = false
    document.removeEventListener('pointermove', handlePointerMove)
    document.removeEventListener('pointerup', handlePointerUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''

    onResizeEnd?.()
  }

  const handleDoubleClick = () => {
    position.value = initial
  }

  // Cleanup
  onUnmounted(() => {
    document.removeEventListener('pointermove', handlePointerMove)
    document.removeEventListener('pointerup', handlePointerUp)
  })

  const separatorProps = computed(() => ({
    onPointerdown: handlePointerDown,
    onDblclick: handleDoubleClick,
    role: 'separator',
    'aria-valuenow': position.value,
    'aria-valuemin': min,
    'aria-valuemax': max,
    'aria-orientation': axis === 'x' ? 'vertical' : 'horizontal',
    tabindex: 0
  }))

  return {
    position,
    isDragging: computed(() => isDragging.value),
    separatorProps,
    setPosition: (value: number) => {
      position.value = clamp(value, min, max)
    }
  }
}
