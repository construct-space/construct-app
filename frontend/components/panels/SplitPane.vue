<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue'

const props = withDefaults(defineProps<{
  direction?: 'horizontal' | 'vertical'
  initialSize?: number
  minSize?: number
  maxSize?: number
  minPaneSizePx?: number
}>(), {
  direction: 'horizontal',
  initialSize: 50,
  minSize: 10,
  maxSize: 90,
  minPaneSizePx: 0
})

const containerRef = ref<HTMLElement | null>(null)
const isDragging = ref(false)
const separatorPosition = ref(toRef(props, 'initialSize').value)

const startDrag = (event: PointerEvent) => {
  event.preventDefault()
  isDragging.value = true
  document.addEventListener('pointermove', onDrag)
  document.addEventListener('pointerup', stopDrag)
  document.body.style.cursor = props.direction === 'horizontal' ? 'col-resize' : 'row-resize'
  document.body.style.userSelect = 'none'
}

const onDrag = (event: PointerEvent) => {
  if (!isDragging.value || !containerRef.value) return
  const rect = containerRef.value.getBoundingClientRect()
  const containerSize = props.direction === 'horizontal' ? rect.width : rect.height
  const containerStart = props.direction === 'horizontal' ? rect.left : rect.top
  const mousePos = props.direction === 'horizontal' ? event.clientX : event.clientY
  const relativePos = mousePos - containerStart
  let percentage = (relativePos / containerSize) * 100
  percentage = Math.min(Math.max(percentage, props.minSize), props.maxSize)
  if (props.minPaneSizePx > 0 && containerSize > 0) {
    const minPercent = (props.minPaneSizePx / containerSize) * 100
    const maxPercent = 100 - minPercent
    percentage = Math.min(Math.max(percentage, minPercent), maxPercent)
  }
  separatorPosition.value = percentage
}

const stopDrag = () => {
  isDragging.value = false
  document.removeEventListener('pointermove', onDrag)
  document.removeEventListener('pointerup', stopDrag)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

const resetPosition = () => {
  separatorPosition.value = props.initialSize
}

onUnmounted(() => {
  document.removeEventListener('pointermove', onDrag)
  document.removeEventListener('pointerup', stopDrag)
})

const containerStyle = computed(() => ({
  display: 'flex',
  flexDirection: props.direction === 'horizontal' ? 'row' as const : 'column' as const,
  height: '100%',
  width: '100%',
  overflow: 'hidden'
}))

const firstPaneStyle = computed(() => {
  const size = `calc(${separatorPosition.value}% - 4px)`
  return props.direction === 'horizontal'
    ? { width: size, height: '100%', overflow: 'hidden', flexShrink: 0 }
    : { height: size, width: '100%', overflow: 'hidden', flexShrink: 0 }
})

const secondPaneStyle = computed(() => ({
  flex: 1,
  overflow: 'hidden',
  minWidth: 0,
  minHeight: 0
}))

const separatorStyle = computed(() => ({
  flexShrink: 0,
  background: 'transparent',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: props.direction === 'horizontal' ? 'col-resize' : 'row-resize',
  width: props.direction === 'horizontal' ? '8px' : '100%',
  height: props.direction === 'horizontal' ? '100%' : '8px',
  zIndex: 10
}))
</script>

<template>
  <div ref="containerRef" class="split-pane" :style="containerStyle">
    <div :style="firstPaneStyle">
      <slot name="first" />
    </div>
    <div
      class="separator"
      :class="{
        'separator--horizontal': direction === 'horizontal',
        'separator--vertical': direction === 'vertical',
        'separator--dragging': isDragging
      }"
      :style="separatorStyle"
      @pointerdown="startDrag"
      @dblclick="resetPosition"
    >
      <div class="separator-bar" />
    </div>
    <div :style="secondPaneStyle">
      <slot name="second" />
    </div>
  </div>
</template>

<style scoped>
.split-pane { position: relative; }
.separator { transition: background-color 0.15s ease; }
.separator:hover, .separator--dragging { background: var(--app-accent-muted, rgba(99, 102, 241, 0.1)); }
.separator-bar { border-radius: 2px; background: var(--app-border, rgba(255, 255, 255, 0.1)); transition: all 0.15s ease; }
.separator--horizontal .separator-bar { width: 3px; height: 24px; }
.separator--vertical .separator-bar { width: 24px; height: 3px; }
.separator:hover .separator-bar, .separator--dragging .separator-bar { background: var(--app-accent, #6366f1); }
</style>
