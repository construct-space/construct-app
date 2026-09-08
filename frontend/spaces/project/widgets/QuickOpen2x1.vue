<script setup lang="ts">
import { inject } from 'vue'
import { Search } from 'lucide-vue-next'
import { buildProjectRoutePath } from '@/utils/projectRoutes'
import type { BuiltinWidgetApi } from '@/lib/widgetApi'

const api = inject<BuiltinWidgetApi>('widgetApi')!
const projectStore = useProjectStore()

const query = ref('')
const showResults = ref(false)

const filtered = computed(() => {
  if (!query.value.trim()) return []
  const q = query.value.toLowerCase()
  return projectStore.projects
    .filter(p => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q))
    .slice(0, 5)
})

function openProject(project: { name: string; path: string }) {
  if (!project?.path) return
  projectStore.openProject(project.path)
  api.actions.navigate(buildProjectRoutePath(project))
  query.value = ''
  showResults.value = false
}

function handleBlur() {
  globalThis.setTimeout(() => { showResults.value = false }, 150)
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && filtered.value.length > 0) {
    openProject(filtered.value[0])
  }
  if (e.key === 'Escape') {
    query.value = ''
    showResults.value = false
  }
}
</script>

<template>
  <div class="h-full flex items-center px-4 gap-2 relative">
    <Search class="size-3.5 text-[var(--app-muted)]/70 shrink-0" />
    <input
      v-model="query"
      type="text"
      placeholder="Open project"
      class="quick-input flex-1 bg-transparent border-none outline-none text-[var(--app-foreground)]"
      @focus="showResults = true"
      @blur="handleBlur"
      @keydown="handleKeydown"
    />
    <span v-if="!query" class="kbd-hint">⌘K</span>

    <!-- Results dropdown -->
    <div
      v-if="showResults && filtered.length > 0"
      class="absolute left-2 right-2 top-full mt-1 rounded-lg bg-[var(--app-background)] shadow-lg z-50 py-1 overflow-hidden"
      style="box-shadow: 0 10px 30px color-mix(in srgb, var(--app-foreground) 12%, transparent);"
    >
      <button
        v-for="project in filtered"
        :key="project.path"
        class="quick-result flex items-baseline gap-3 w-full px-3 py-2 text-left transition-colors"
        @mousedown.prevent="openProject(project)"
      >
        <span class="text-[12px] font-light text-[var(--app-foreground)] truncate">{{ project.name }}</span>
        <span class="text-[10.5px] font-light text-[var(--app-muted)] truncate">{{ project.path }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.quick-input {
  font-size: 13px;
  font-weight: 300;
  letter-spacing: -0.005em;
}
.quick-input::placeholder {
  color: color-mix(in srgb, var(--app-muted) 70%, transparent);
  font-weight: 300;
}

/* Soft keyboard hint — reads as "here's the shortcut" without a hard box. */
.kbd-hint {
  font-size: 9.5px;
  font-weight: 300;
  letter-spacing: 0.08em;
  color: color-mix(in srgb, var(--app-muted) 70%, transparent);
  padding: 2px 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--app-foreground) 5%, transparent);
}

.quick-result:hover {
  background: color-mix(in srgb, var(--app-foreground) 5%, transparent);
}
</style>
