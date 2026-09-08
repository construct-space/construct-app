<script setup lang="ts">
import { allSettingsNavItems, getSettingsNavGroups } from '@/router/settingsNavigation'
import { useDevMode } from '@/composables/useDevMode'
const route = useRoute()
const settingsStore = useSettingsStore()
const { isEnrolled } = useDevMode()

const navGroups = computed(() => getSettingsNavGroups({
  isDeveloper: isEnrolled.value,
  isOrg: false,
  isAdmin: false,
}))

const currentSection = computed(() =>
  allSettingsNavItems.find(item => route.path === item.path)?.label ?? ''
)

onMounted(() => {
  if (settingsStore.settings.length === 0) {
    settingsStore.fetchSettings().catch(() => undefined)
  }
})

// Resizable sidebar
const sidebarWidth = ref(260)
const isResizing = ref(false)
const MIN_WIDTH = 260
const MAX_WIDTH = 640

function startResize(e: MouseEvent) {
  e.preventDefault()
  isResizing.value = true
  const startX = e.clientX
  const startWidth = sidebarWidth.value

  function onMove(e: MouseEvent) {
    const delta = e.clientX - startX
    sidebarWidth.value = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta))
  }

  function onUp() {
    isResizing.value = false
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }

  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}
</script>

<template>
  <div class="h-full flex" :class="isResizing ? 'select-none' : ''">
    <!-- LEFT COLUMN — branding + nav -->
    <div class="shrink-0 flex flex-col items-start px-6 py-10 overflow-y-auto" :style="{ width: sidebarWidth + 'px' }">
      <!-- Branding -->
      <p class="text-lg tracking-wide select-none mb-1">
        <span class="text-app-muted font-normal">CONSTRUCT:</span><span
          class="font-bold text-app-foreground">SETTINGS</span>
      </p>
      <p class="text-xs text-app-muted uppercase tracking-widest mb-10">
        {{ currentSection }}
      </p>

      <!-- Nav -->
      <nav class="w-full space-y-6">
        <div v-for="group in navGroups" :key="group.label">
          <p class="text-[10px] font-semibold tracking-widest text-app-muted uppercase mb-1.5 px-1">
            {{ group.label }}
          </p>
          <div class="space-y-0.5">
            <RouterLink v-for="item in group.items" :key="item.path" :to="item.path"
              class="flex items-center gap-2.5 px-2 py-1.5 rounded text-xs font-normal uppercase tracking-wider transition-colors" :class="route.path === item.path
                ? 'text-app-accent bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)]'
                : 'text-app-foreground hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)]'">
              <component :is="item.icon" class="w-4 h-4 shrink-0"
                :class="route.path === item.path ? 'text-app-accent' : 'text-app-muted'" />
              <span>{{ item.label }}</span>
            </RouterLink>
          </div>
        </div>
      </nav>
    </div>

    <!-- Resize handle -->
    <div
      class="w-1 shrink-0 cursor-col-resize group relative"
      @mousedown="startResize"
    >
      <div class="absolute inset-y-0 -left-px w-[3px] transition-colors" :class="isResizing ? 'bg-[var(--app-accent)]' : 'bg-transparent group-hover:bg-[var(--app-border)]'" />
    </div>

    <!-- RIGHT COLUMN — page content -->
    <div class="flex-1 min-w-0 overflow-y-auto py-10 px-10">
      <slot />
    </div>
  </div>
</template>
