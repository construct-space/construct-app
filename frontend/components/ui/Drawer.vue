<script setup lang="ts">
/**
 * Drawer - Slide-out panel component
 * Supports: #header, #default, #footer slots
 * Slides from left, right, or bottom with configurable size
 */
import { watch, onMounted, onUnmounted } from 'vue'

const props = withDefaults(defineProps<{
  open?: boolean
  side?: 'left' | 'right' | 'bottom'
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  overlay?: boolean
  closable?: boolean
}>(), {
  open: false,
  side: 'right',
  size: 'md',
  overlay: true,
  closable: true,
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  close: []
}>()

function close() {
  if (!props.closable) return
  emit('update:open', false)
  emit('close')
}

function onOverlayClick() {
  if (props.overlay && props.closable) close()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.open) close()
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
})

// Prevent body scroll when open
watch(() => props.open, (val) => {
  document.body.style.overflow = val ? 'hidden' : ''
})

const sizeClass = computed(() => {
  if (props.side === 'bottom') {
    const map: Record<string, string> = {
      sm: 'h-1/4',
      md: 'h-1/3',
      lg: 'h-1/2',
      xl: 'h-3/4',
      full: 'h-full',
    }
    return map[props.size]
  }
  const map: Record<string, string> = {
    sm: 'w-72',
    md: 'w-96',
    lg: 'w-[32rem]',
    xl: 'w-[42rem]',
    full: 'w-full',
  }
  return map[props.size]
})

const positionClass = computed(() => {
  const map: Record<string, string> = {
    left: 'inset-y-0 left-0',
    right: 'inset-y-0 right-0',
    bottom: 'inset-x-0 bottom-0',
  }
  return map[props.side]
})

const transformOpen = computed(() => {
  return 'translate-x-0 translate-y-0'
})

const transformClosed = computed(() => {
  const map: Record<string, string> = {
    left: '-translate-x-full',
    right: 'translate-x-full',
    bottom: 'translate-y-full',
  }
  return map[props.side]
})
</script>

<template>
  <Teleport to="body">
    <!-- Overlay -->
    <Transition
      enter-active-class="transition-opacity duration-300 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-opacity duration-200 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open && overlay"
        class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
        @click="onOverlayClick"
      />
    </Transition>

    <!-- Panel -->
    <Transition
      enter-active-class="transition-transform duration-300 ease-out"
      :enter-from-class="transformClosed"
      :enter-to-class="transformOpen"
      leave-active-class="transition-transform duration-200 ease-in"
      :leave-from-class="transformOpen"
      :leave-to-class="transformClosed"
    >
      <div
        v-if="open"
        :class="[
          'fixed z-50 flex flex-col bg-[var(--app-background)] shadow-xl border border-[var(--app-border)] overflow-hidden',
          positionClass,
          sizeClass,
        ]"
      >
        <!-- Close button -->
        <button
          v-if="closable"
          class="absolute top-4 right-4 z-10 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none text-[var(--app-muted)]"
          @click="close"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>

        <!-- Header -->
        <div v-if="$slots.header" class="p-6 pb-0 shrink-0">
          <slot name="header" />
        </div>

        <!-- Body -->
        <div class="p-6 text-[var(--app-foreground)] flex-1 overflow-auto">
          <slot />
        </div>

        <!-- Footer -->
        <div v-if="$slots.footer" class="px-6 pb-6 shrink-0">
          <slot name="footer" />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
