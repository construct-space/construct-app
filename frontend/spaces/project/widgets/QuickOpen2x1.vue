<script setup lang="ts">
import { Search, Folder } from 'lucide-vue-next'
import { buildProjectRoutePath } from '@/utils/projectRoutes'

const router = useRouter()
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
  router.push(buildProjectRoutePath(project))
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
  <div class="h-full flex items-center p-3 gap-2 relative">
    <Search class="size-4 text-[var(--app-muted)] shrink-0" />
    <input
      v-model="query"
      type="text"
      placeholder="Open project..."
      class="flex-1 text-xs bg-transparent border-none outline-none text-[var(--app-foreground)] placeholder-[var(--app-muted)]/50"
      @focus="showResults = true"
      @blur="handleBlur"
      @keydown="handleKeydown"
    />

    <!-- Results dropdown -->
    <div
      v-if="showResults && filtered.length > 0"
      class="absolute left-2 right-2 top-full mt-1 rounded-lg border border-[var(--app-border)] bg-[var(--app-background)] shadow-xl z-50 py-1 overflow-hidden"
    >
      <button
        v-for="project in filtered"
        :key="project.path"
        class="flex items-center gap-2 w-full px-3 py-1.5 text-left hover:bg-[var(--app-accent)]/5 transition-colors"
        @mousedown.prevent="openProject(project)"
      >
        <Folder class="size-3.5 text-[var(--app-muted)]" />
        <span class="text-xs text-[var(--app-foreground)] truncate">{{ project.name }}</span>
      </button>
    </div>
  </div>
</template>
