<script setup lang="ts">
/**
 * SplitPane - Resizable two-panel layout with draggable divider
 */
import { ref, computed, onBeforeUnmount, watch } from 'vue'

const props = withDefaults(defineProps<{
  direction?: 'horizontal' | 'vertical'
  defaultSize?: number
  minSize?: number
  maxSize?: number
  collapsible?: boolean
  modelValue?: number
}>(), {
  direction: 'horizontal',
  defaultSize: 50,
  minSize: 10,
  maxSize: 90,
  collapsible: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

const containerRef = ref<HTMLElement | null>(null)
const isDragging = ref(false)
const isHovering = ref(false)
const isCollapsed = ref(false)

const internalSize = ref(props.defaultSize)

const splitSize = computed({
  get: () => props.modelValue ?? internalSize.value,
  set: (val: number) => {
    internalSize.value = val
    emit('update:modelValue', val)
  },
})

const isHorizontal = computed(() => props.direction === 'horizontal')

const firstPaneStyle = computed(() => {
  const size = isCollapsed.value ? 0 : splitSize.value
  return isHorizontal.value
    ? { width: `${size}%`, minWidth: 0 }
    : { height: `${size}%`, minHeight: 0 }
})

const secondPaneStyle = computed(() => {
  const size = isCollapsed.value ? 100 : 100 - splitSize.value
  return isHorizontal.value
    ? { width: `${size}%`, minWidth: 0 }
    : { height: `${size}%`, minHeight: 0 }
})

const containerClass = computed(() =>
  isHorizontal.value ? 'flex-row' : 'flex-col'
)

const handleCursor = computed(() =>
  isHorizontal.value ? 'cursor-col-resize' : 'cursor-row-resize'
)

let rafId: number | null = null

function clampSize(value: number): number {
  return Math.min(props.maxSize, Math.max(props.minSize, value))
}

function onPointerDown(e: PointerEvent) {
  if (isCollapsed.value) return
  e.preventDefault()
  isDragging.value = true
  const target = e.currentTarget as HTMLElement
  target.setPointerCapture(e.pointerId)

  const onPointerMove = (ev: PointerEvent) => {
    if (!isDragging.value || !containerRef.value) return
    if (rafId !== null) return

    rafId = requestAnimationFrame(() => {
      rafId = null
      if (!containerRef.value) return

      const rect = containerRef.value.getBoundingClientRect()
      let percentage: number

      if (isHorizontal.value) {
        percentage = ((ev.clientX - rect.left) / rect.width) * 100
      } else {
        percentage = ((ev.clientY - rect.top) / rect.height) * 100
      }

      splitSize.value = clampSize(percentage)
    })
  }

  const onPointerUp = () => {
    isDragging.value = false
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    document.removeEventListener('pointermove', onPointerMove)
    document.removeEventListener('pointerup', onPointerUp)
  }

  document.addEventListener('pointermove', onPointerMove)
  document.addEventListener('pointerup', onPointerUp)
}

function onDoubleClick() {
  isCollapsed.value = false
  splitSize.value = props.defaultSize
}

function toggleCollapse() {
  isCollapsed.value = !isCollapsed.value
}

watch(() => props.modelValue, (val) => {
  if (val !== undefined) {
    internalSize.value = val
  }
})

onBeforeUnmount(() => {
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
  }
})
</script>

<template>
  <div
    ref="containerRef"
    class="flex overflow-hidden h-full w-full select-none"
    :class="[
      containerClass,
      isDragging ? (isHorizontal ? 'cursor-col-resize' : 'cursor-row-resize') : '',
    ]"
  >
    <!-- First pane (left / top) -->
    <div
      class="overflow-auto"
      :class="{ 'transition-all duration-200 ease-out': !isDragging }"
      :style="firstPaneStyle"
    >
      <slot name="first">
        <slot :name="isHorizontal ? 'left' : 'top'" />
      </slot>
    </div>

    <!-- Divider / Handle -->
    <div
      :class="[
        'relative flex-shrink-0 flex items-center justify-center group',
        isHorizontal ? 'w-[5px]' : 'h-[5px]',
        handleCursor,
      ]"
      @pointerdown="onPointerDown"
      @dblclick="onDoubleClick"
      @mouseenter="isHovering = true"
      @mouseleave="isHovering = false"
    >
      <!-- Track -->
      <div
        :class="[
          'absolute transition-colors duration-150',
          isHorizontal ? 'w-px h-full' : 'h-px w-full',
          isDragging
            ? 'bg-[var(--app-accent)]'
            : isHovering
              ? 'bg-[var(--app-accent)]/60'
              : 'bg-[var(--app-border)]',
        ]"
      />

      <!-- Drag indicator dots -->
      <div
        :class="[
          'relative z-10 rounded-full transition-all duration-150',
          isHorizontal ? 'w-1 h-8' : 'h-1 w-8',
          isDragging
            ? 'bg-[var(--app-accent)] scale-110'
            : isHovering
              ? 'bg-[var(--app-accent)]/60'
              : 'bg-[var(--app-border)] scale-75',
        ]"
      />

      <!-- Collapse button -->
      <button
        v-if="collapsible"
        :class="[
          'absolute z-20 flex items-center justify-center',
          'w-5 h-5 rounded-full',
          'bg-[var(--app-background)] border border-[var(--app-border)]',
          'text-[var(--app-muted)] hover:text-[var(--app-accent)] hover:border-[var(--app-accent)]',
          'transition-all duration-150 opacity-0 group-hover:opacity-100',
          'cursor-pointer',
          isHorizontal ? '-left-2.5' : '-top-2.5',
        ]"
        @click.stop="toggleCollapse"
        @pointerdown.stop
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          class="w-3 h-3 transition-transform duration-150"
          :class="{
            'rotate-180': isCollapsed && isHorizontal,
            'rotate-90': !isCollapsed && isHorizontal,
            '-rotate-90': isCollapsed && isHorizontal,
          }"
        >
          <path
            fill-rule="evenodd"
            :d="isHorizontal
              ? (isCollapsed
                ? 'M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z'
                : 'M9.78 4.22a.75.75 0 0 1 0 1.06L7.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L5.47 8.53a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0Z')
              : (isCollapsed
                ? 'M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z'
                : 'M11.78 9.78a.75.75 0 0 1-1.06 0L8 7.06 5.28 9.78a.75.75 0 0 1-1.06-1.06l3.25-3.25a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06Z')"
          />
        </svg>
      </button>
    </div>

    <!-- Second pane (right / bottom) -->
    <div
      class="overflow-auto"
      :class="{ 'transition-all duration-200 ease-out': !isDragging }"
      :style="secondPaneStyle"
    >
      <slot name="second">
        <slot :name="isHorizontal ? 'right' : 'bottom'" />
      </slot>
    </div>
  </div>
</template>
