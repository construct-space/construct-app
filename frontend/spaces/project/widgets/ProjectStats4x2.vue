<script setup lang="ts">
import { FolderOpen, Pin, Rocket, Layers } from 'lucide-vue-next'

const projectStore = useProjectStore()
const pinnedStore = usePinnedStore()

const deployedCount = ref(0)

onMounted(async () => {
  try {
    const { useBasepodDeploy } = await import('@/composables/useBasepodDeploy')
    const { loadDeployInfo } = useBasepodDeploy()
    let count = 0
    for (const project of projectStore.projects) {
      const info = await loadDeployInfo(project.path).catch(() => null)
      if (info) count++
    }
    deployedCount.value = count
  } catch { /* not in Tauri */ }
})

const totalProjects = computed(() => projectStore.projects.length)
const pinnedCount = computed(() => pinnedStore.pinnedByType('project').length)

// Count unique space types across all projects
const spaceBreakdown = computed(() => {
  const counts: Record<string, number> = {}
  for (const project of projectStore.projects) {
    for (const space of project.spaces) {
      counts[space] = (counts[space] || 0) + 1
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
})

const stats = computed(() => [
  { label: 'Total', value: totalProjects.value, icon: FolderOpen, color: 'var(--app-accent)' },
  { label: 'Pinned', value: pinnedCount.value, icon: Pin, color: '#8b5cf6' },
  { label: 'Deployed', value: deployedCount.value, icon: Rocket, color: '#10b981' },
  { label: 'Spaces', value: spaceBreakdown.value.length, icon: Layers, color: '#f59e0b' },
])
</script>

<template>
  <div class="h-full flex flex-col p-3 gap-3">
    <div class="flex items-center gap-2">
      <FolderOpen class="size-4 text-[var(--app-accent)]" />
      <span class="text-xs font-medium text-[var(--app-foreground)]">Project Stats</span>
    </div>

    <div class="flex-1 grid grid-cols-4 gap-2">
      <div
        v-for="stat in stats"
        :key="stat.label"
        class="flex flex-col items-center justify-center rounded-xl border border-[var(--app-border)] p-2"
        style="background: var(--app-background);"
      >
        <component :is="stat.icon" class="size-4 mb-1.5" :style="{ color: stat.color }" />
        <span class="text-lg font-bold text-[var(--app-foreground)] leading-none">{{ stat.value }}</span>
        <span class="text-[10px] text-[var(--app-muted)] mt-1">{{ stat.label }}</span>
      </div>
    </div>

    <!-- Top spaces bar -->
    <div v-if="spaceBreakdown.length > 0" class="flex items-center gap-3">
      <div
        v-for="[space, count] in spaceBreakdown"
        :key="space"
        class="flex items-center gap-1 text-[10px] text-[var(--app-muted)]"
      >
        <span class="size-1.5 rounded-full bg-[var(--app-accent)]/40" />
        <span class="capitalize">{{ space }}</span>
        <span class="text-[var(--app-muted)]/50">{{ count }}</span>
      </div>
    </div>
  </div>
</template>
