<script setup lang="ts">
/**
 * ScrollWheel - 3D cylindrical scroll picker
 *
 * A rotating drum/wheel that displays items in a 3D cylindrical arrangement.
 * Used in the Projects page for the "wheel" view mode.
 *
 * Props:
 *   items - Array of objects with at least { id, label }
 *   modelValue - Currently selected item id
 *   itemHeight - Height of each item slot (px)
 *   visibleCount - Number of visible items in the viewport
 *   fillContainer - If true, fills parent height
 *   radiusScale - Multiplier for cylinder radius
 *
 * Events:
 *   update:modelValue - When selection changes
 *   select - When an item is clicked/confirmed
 *   enter - When Enter key is pressed on selected item
 */

import type { Component } from 'vue'

export interface ScrollWheelItem {
  id: string | number
  label: string
  description?: string
  icon?: Component
  [key: string]: unknown
}

const props = withDefaults(defineProps<{
  items: ScrollWheelItem[]
  modelValue?: string | number | null
  itemHeight?: number
  visibleCount?: number
  fillContainer?: boolean
  radiusScale?: number
}>(), {
  modelValue: null,
  itemHeight: 48,
  visibleCount: 7,
  fillContainer: false,
  radiusScale: 1,
})

const emit = defineEmits<{
  'update:modelValue': [value: string | number]
  select: [item: ScrollWheelItem]
  enter: [item: ScrollWheelItem]
}>()

const containerRef = ref<HTMLElement | null>(null)
const currentIndex = ref(0)
const targetIndex = ref(0)
const _isAnimating = ref(false)
const isDragging = ref(false)
const dragStartY = ref(0)
const dragStartIndex = ref(0)

// Compute the angle per item based on visible count
const anglePerItem = computed(() => 360 / Math.max(props.items.length, props.visibleCount))

// Cylinder radius
const radius = computed(() => {
  const circumference = props.items.length * props.itemHeight * props.radiusScale
  return Math.max(circumference / (2 * Math.PI), props.itemHeight * 2)
})

// Find index from modelValue
watch(() => props.modelValue, (val) => {
  if (val == null) return
  const idx = props.items.findIndex(item => item.id === val)
  if (idx !== -1 && idx !== currentIndex.value) {
    currentIndex.value = idx
    targetIndex.value = idx
  }
}, { immediate: true })

// Current rotation angle
const rotationAngle = computed(() => {
  return -currentIndex.value * anglePerItem.value
})

// Transform style for each item
const getItemStyle = (index: number) => {
  const angle = index * anglePerItem.value
  return {
    transform: `rotateX(${angle}deg) translateZ(${radius.value}px)`,
    height: `${props.itemHeight}px`,
  }
}

// Item opacity based on distance from center
const getItemOpacity = (index: number) => {
  const diff = Math.abs(index - currentIndex.value)
  const maxDiff = Math.floor(props.visibleCount / 2)
  if (diff > maxDiff) return 0
  return 1 - (diff / (maxDiff + 1)) * 0.7
}

// Navigate to index
const goToIndex = (index: number) => {
  const clamped = Math.max(0, Math.min(index, props.items.length - 1))
  currentIndex.value = clamped
  targetIndex.value = clamped
  const item = props.items[clamped]
  if (item) {
    emit('update:modelValue', item.id)
  }
}

// Scroll by delta
const scrollBy = (delta: number) => {
  goToIndex(currentIndex.value + delta)
}

// Wheel handler
const onWheel = (e: WheelEvent) => {
  e.preventDefault()
  const direction = e.deltaY > 0 ? 1 : -1
  scrollBy(direction)
}

// Pointer handlers
const onPointerDown = (e: PointerEvent) => {
  isDragging.value = true
  dragStartY.value = e.clientY
  dragStartIndex.value = currentIndex.value
  ;(e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
}

const onPointerMove = (e: PointerEvent) => {
  if (!isDragging.value) return
  const deltaY = dragStartY.value - e.clientY
  const indexDelta = Math.round(deltaY / props.itemHeight)
  const newIndex = dragStartIndex.value + indexDelta
  const clamped = Math.max(0, Math.min(newIndex, props.items.length - 1))
  if (clamped !== currentIndex.value) {
    currentIndex.value = clamped
    targetIndex.value = clamped
    const item = props.items[clamped]
    if (item) {
      emit('update:modelValue', item.id)
    }
  }
}

const onPointerUp = () => {
  isDragging.value = false
}

// Click on item
const onItemClick = (index: number) => {
  goToIndex(index)
  const item = props.items[index]
  if (item) {
    emit('select', item)
  }
}

// Keyboard navigation
const onKeyDown = (e: KeyboardEvent) => {
  switch (e.key) {
    case 'ArrowUp':
      e.preventDefault()
      scrollBy(-1)
      break
    case 'ArrowDown':
      e.preventDefault()
      scrollBy(1)
      break
    case 'Enter': {
      e.preventDefault()
      const item = props.items[currentIndex.value]
      if (item) {
        emit('enter', item)
      }
      break
    }
  }
}

// Container height
const containerHeight = computed(() => {
  if (props.fillContainer) return '100%'
  return `${props.visibleCount * props.itemHeight}px`
})

onMounted(() => {
  containerRef.value?.focus()
})
</script>

<template>
  <div
    ref="containerRef"
    class="relative overflow-hidden outline-none select-none"
    :style="{ height: containerHeight, perspective: '2000px' }"
    tabindex="0"
    @wheel.prevent="onWheel"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @keydown="onKeyDown"
  >
    <!-- Gradient overlays for fade effect -->
    <div class="absolute inset-x-0 top-0 h-16 z-10 pointer-events-none bg-gradient-to-b from-[var(--app-background)] to-transparent" />
    <div class="absolute inset-x-0 bottom-0 h-16 z-10 pointer-events-none bg-gradient-to-t from-[var(--app-background)] to-transparent" />

    <!-- Selection highlight -->
    <div
      class="absolute inset-x-4 z-5 rounded-lg border border-app-accent/30 bg-app-accent/5 pointer-events-none"
      :style="{
        height: `${itemHeight}px`,
        top: '50%',
        transform: 'translateY(-50%)',
      }"
    />

    <!-- 3D Cylinder -->
    <div
      class="absolute inset-0 flex items-center justify-center"
      :style="{
        transformStyle: 'preserve-3d',
        transform: `rotateX(${rotationAngle}deg)`,
        transition: isDragging ? 'none' : 'transform 0.3s ease-out',
      }"
    >
      <div
        v-for="(item, index) in items"
        :key="item.id"
        class="absolute inset-x-0 flex items-center px-6 cursor-pointer transition-opacity duration-200"
        :style="getItemStyle(index)"
        :class="index === currentIndex ? 'text-[var(--app-foreground)]' : 'text-[var(--app-muted)]'"
        @click="onItemClick(index)"
      >
        <div
          class="flex items-center gap-3 w-full"
          :style="{ opacity: getItemOpacity(index) }"
        >
          <!-- Icon slot -->
          <component
            :is="item.icon"
            v-if="item.icon"
            class="w-5 h-5 shrink-0"
          />

          <!-- Text -->
          <div class="flex-1 min-w-0">
            <div class="truncate text-sm font-medium">{{ item.label }}</div>
            <div v-if="item.description" class="truncate text-xs text-[var(--app-muted)]">{{ item.description }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
