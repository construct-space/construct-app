<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import Toolbar3D from '@/components/common/Toolbar3D.vue'
import TitleBar from '@/components/common/TitleBar.vue'
import MenuBar from '@/components/common/MenuBar.vue'
import Sidebar3D from '@/components/common/Sidebar3D.vue'
import AssistantPanel from '@/components/ai/AssistantPanel.vue'
import ModelSwitcherModal from '@/components/ModelSwitcherModal.vue'
import { useAssistantPanel } from '@/composables/useAssistantPanel'
import { useDraggableWindow } from '@/composables/useDraggableWindow'
import { useWindowChromeState } from '@/composables/useWindowChromeState'
import { useModelSwitcher } from '@/composables/useModelSwitcher'
import { isTauriEnv } from '@/utils/tauri'
import { useOrgSpacesSync } from '@/composables/useOrgSpacesSync'
import { useAuthStore } from '@/stores/auth'
import { useOrgStore } from '@/stores/org'

const route = useRoute()

// Detect the active space from the route (kept in sync with
// AssistantPanel's detectAndSwitch). Returns the space slug or
// null when the route doesn't map to a space.
function detectSpace(path: string): string | null {
  const projectMatch = path.match(/\/app\/projects\/([^/]+)\/([^/]+)/)
  if (projectMatch?.[2]) return projectMatch[2]
  if (path.match(/\/app\/projects(\/[^/]+)?$/)) return 'project'
  const directMatch = path.match(/\/app\/([a-z][\w-]*)/)
  if (directMatch?.[1] && !['settings', 'marketplace', 'onboarding'].includes(directMatch[1])) {
    return directMatch[1]
  }
  return null
}

// Broadcast space changes to detach windows (assistant + space) so a
// detached panel auto-switches its agent when the main window
// navigates. The detach window listens for `space-changed` in
// DetachShell.
let lastBroadcast = ''
watch(() => route.path, async (path) => {
  if (!isTauriEnv()) return
  const space = detectSpace(path) ?? ''
  if (space === lastBroadcast) return
  lastBroadcast = space
  try {
    const { emit } = await import('@tauri-apps/api/event')
    await emit('space-changed', { space })
  } catch { /* best-effort */ }
}, { immediate: true })
const assistant = useAssistantPanel()
const modelSwitcher = useModelSwitcher()
const { isWindowChromeHidden } = useWindowChromeState()
const showWindowChrome = computed(() => !isWindowChromeHidden.value)
const isHomePage = computed(() => route.path === '/app' || route.path === '/app/')
const assistantHasMounted = ref(assistant.visible.value)

watch(
  () => assistant.visible.value,
  (visible) => {
    if (visible) assistantHasMounted.value = true
  },
  { immediate: true },
)

// Double-Shift to toggle panels (like IntelliJ's Search Everywhere).
//   LEFT shift  → AI assistant (existing behavior)
//   RIGHT shift → model switcher modal
// Sides are tracked independently so a Left→Right alternation doesn't fire
// either; any non-shift key resets both timers.
let lastLeftShiftTime = 0
let lastRightShiftTime = 0
function handleKeydown(e: KeyboardEvent) {
  if (e.key !== 'Shift' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) {
    lastLeftShiftTime = 0
    lastRightShiftTime = 0
    return
  }
  const now = Date.now()
  // event.code distinguishes ShiftLeft / ShiftRight; location is a fallback
  // for older runtimes that don't populate code.
  const isRight = e.code === 'ShiftRight' || e.location === 2
  if (isRight) {
    if (now - lastRightShiftTime < 400) {
      e.preventDefault()
      modelSwitcher.toggle()
      lastRightShiftTime = 0
    } else {
      lastRightShiftTime = now
    }
    lastLeftShiftTime = 0
  } else {
    if (now - lastLeftShiftTime < 400) {
      e.preventDefault()
      assistant.toggle()
      lastLeftShiftTime = 0
    } else {
      lastLeftShiftTime = now
    }
    lastRightShiftTime = 0
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

// Sync org-pinned spaces — runs once per session when auth + org are
// hydrated. Watches because both can settle asynchronously after boot.
const authStore = useAuthStore()
const orgStore = useOrgStore()
const orgSpacesSync = useOrgSpacesSync()
watch(
  () => [!!authStore.token, orgStore.isEnabled, orgStore.orgId] as const,
  ([authed, enabled, id]) => { if (authed && enabled && id) void orgSpacesSync.run() },
  { immediate: true },
)

// Listen for toggle events from global shortcuts
function handleToggle(_e: Event) {
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
  <div class="flex flex-col h-screen overflow-hidden">
    <!-- Title bar: full-width row over sidebar + content. Drag region with
         traffic-light padding on the left and the detach button on the right.
         Replaces the in-toolbar detach we used to show. -->
    <TitleBar v-if="showWindowChrome" />

    <!-- Custom app menu bar (Windows/Linux only) — hidden until Alt is tapped.
         Renders nothing on macOS, which keeps its native menu bar. -->
    <MenuBar v-if="showWindowChrome" />

    <div class="flex-1 flex overflow-hidden min-h-0">
      <Sidebar3D v-if="showWindowChrome" />

      <div class="flex-1 flex flex-col overflow-hidden min-w-0">
        <Toolbar3D v-if="showWindowChrome && !isHomePage" />

        <div class="flex-1 flex overflow-hidden min-h-0">
          <main class="flex-1 overflow-auto rounded-sm bg-app mx-3 mb-3 rounded-tl-lg rounded-br-lg shadow-xl min-w-0">
            <!-- Contain page/space errors so one broken route can't blank the
                 whole app. Keyed by route so navigating elsewhere clears it. -->
            <ErrorBoundary :key="route.fullPath">
              <RouterView />
            </ErrorBoundary>
          </main>
        </div>
      </div>
    </div>

    <!-- AI Assistant (floating overlay) -->
    <Transition enter-active-class="transition-all duration-200 ease-out"
      enter-from-class="opacity-0 scale-95 translate-y-2" enter-to-class="opacity-100 scale-100 translate-y-0"
      leave-active-class="transition-all duration-150 ease-in" leave-from-class="opacity-100 scale-100"
      leave-to-class="opacity-0 scale-95 translate-y-2">
      <div v-if="assistantHasMounted" v-show="assistant.visible.value"
        class="fixed z-[100] shadow-2xl rounded-2xl border border-white/10 dark:border-white/5 overflow-hidden"
        :style="windowStyle">
        <!-- Panel — header is the drag handle. -->
        <AssistantPanel :docked="true" @header-mousedown="startDrag" />

        <!-- Resize handles -->
        <div class="absolute top-0 left-0 w-1 h-full cursor-w-resize" @mousedown="startResize($event, 'w')" />
        <div class="absolute top-0 right-0 w-1 h-full cursor-e-resize" @mousedown="startResize($event, 'e')" />
        <div class="absolute bottom-0 left-0 w-full h-1 cursor-s-resize" @mousedown="startResize($event, 's')" />
        <div class="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize" @mousedown="startResize($event, 'se')" />
      </div>
    </Transition>

    <!-- Model switcher (double-right-shift) -->
    <ModelSwitcherModal v-model:open="modelSwitcher.open.value" />
  </div>
</template>
