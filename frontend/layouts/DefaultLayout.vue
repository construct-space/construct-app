<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import Toolbar3D from '@/components/common/Toolbar3D.vue'
import Sidebar3D from '@/components/common/Sidebar3D.vue'
import AssistantPanel from '@/components/ai/AssistantPanel.vue'
import { useAssistant } from '@/operator'
import { useDraggableWindow } from '@/composables/useDraggableWindow'
import { useWindowChromeState } from '@/composables/useWindowChromeState'

const assistant = useAssistant()
const { isWindowChromeHidden } = useWindowChromeState()
const showWindowChrome = computed(() => !isWindowChromeHidden.value)

// Double-Shift to toggle assistant (like IntelliJ's Search Everywhere)
let lastShiftTime = 0
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Shift' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const now = Date.now()
    if (now - lastShiftTime < 400) {
      e.preventDefault()
      assistant.toggle()
      lastShiftTime = 0
    } else {
      lastShiftTime = now
    }
  } else {
    lastShiftTime = 0
  }
}

const {
  windowStyle,
  loadWindowState,
  initWindowState,
  startDrag,
  startResize,
} = useDraggableWindow({
  storageKey: 'construct-assistant-window',
  defaultWidth: 420,
  defaultHeight: 600,
  minWidth: 340,
  minHeight: 400,
})

// Initialize window position
onMounted(() => {
  loadWindowState()
  initWindowState()
})

// Listen for toggle events from global shortcuts
function handleToggle(e: Event) {
  assistant.toggle()
}

onMounted(() => {
  window.addEventListener('construct:toggle-assistant', handleToggle)
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  window.removeEventListener('construct:toggle-assistant', handleToggle)
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div class="flex h-screen overflow-hidden">
    <Sidebar3D v-if="showWindowChrome" />

    <div class="flex-1 flex flex-col overflow-hidden min-w-0">
      <Toolbar3D v-if="showWindowChrome" />

      <div class="flex-1 flex overflow-hidden min-h-0">
        <main class="flex-1 overflow-auto min-w-0">
          <RouterView />
        </main>
      </div>
    </div>

    <!-- AI Assistant (floating overlay) -->
    <Transition
      enter-active-class="transition-all duration-200 ease-out"
      enter-from-class="opacity-0 scale-95 translate-y-2"
      enter-to-class="opacity-100 scale-100 translate-y-0"
      leave-active-class="transition-all duration-150 ease-in"
      leave-from-class="opacity-100 scale-100"
      leave-to-class="opacity-0 scale-95 translate-y-2"
    >
      <div
        v-if="assistant.visible.value"
        class="fixed z-50 shadow-2xl rounded-2xl border border-white/10 dark:border-white/5 overflow-hidden"
        :style="windowStyle"
      >
        <!-- Drag handle -->
        <div
          class="h-3 cursor-move bg-transparent hover:bg-white/5 transition-colors"
          @mousedown="startDrag"
        >
          <div class="flex justify-center pt-1.5">
            <div class="w-8 h-0.5 rounded-full bg-white/20" />
          </div>
        </div>

        <!-- Panel -->
        <div class="h-[calc(100%-12px)]">
          <AssistantPanel :docked="true" />
        </div>

        <!-- Resize handles -->
        <div class="absolute top-0 left-0 w-1 h-full cursor-w-resize" @mousedown="startResize($event, 'w')" />
        <div class="absolute top-0 right-0 w-1 h-full cursor-e-resize" @mousedown="startResize($event, 'e')" />
        <div class="absolute bottom-0 left-0 w-full h-1 cursor-s-resize" @mousedown="startResize($event, 's')" />
        <div class="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize" @mousedown="startResize($event, 'se')" />
      </div>
    </Transition>
  </div>
</template>
