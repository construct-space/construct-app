<script setup lang="ts">
import { inject } from 'vue'
import type { WidgetApi } from '@/lib/widgetApi'

const _api = inject<WidgetApi>('widgetApi')

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
  { label: 'Total', value: totalProjects.value },
  { label: 'Pinned', value: pinnedCount.value },
  { label: 'Deployed', value: deployedCount.value },
  { label: 'Spaces', value: spaceBreakdown.value.length },
])
</script>

<template>
  <div class="h-full flex flex-col px-4 py-3 gap-3">
    <h3 class="widget-title">Projects</h3>

    <!-- Big thin numbers with caps labels underneath; no inner boxes. -->
    <div class="flex-1 grid grid-cols-4 items-center">
      <div
        v-for="(stat, i) in stats"
        :key="stat.label"
        class="flex flex-col items-center justify-center"
        :class="i > 0 ? 'border-l border-[color-mix(in_srgb,var(--app-foreground)_6%,transparent)]' : ''"
      >
        <span class="stat-value text-[var(--app-foreground)] tabular-nums">{{ stat.value }}</span>
        <span class="stat-label text-[var(--app-muted)]">{{ stat.label }}</span>
      </div>
    </div>

    <!-- Quiet meta row: top space types with their counts, dot-separated. -->
    <div v-if="spaceBreakdown.length > 0" class="flex items-center gap-2 flex-wrap">
      <template v-for="([space, count], i) in spaceBreakdown" :key="space">
        <span v-if="i > 0" class="sep">·</span>
        <span class="text-[10px] text-[var(--app-muted)]">
          <span class="capitalize">{{ space }}</span>
          <span class="ml-1 font-light text-[var(--app-foreground)]">{{ count }}</span>
        </span>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* Unified kicker: strong foreground text + red accent period — same
   rhythm as "Flakerim." and "anything." elsewhere on the dashboard. */
.widget-title {
  font-size: 11px;
  font-weight: 300;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--app-foreground) 85%, transparent);
}
.widget-title::after {
  content: '.';
  color: var(--app-accent);
  font-weight: 300;
  margin-left: 1px;
}

/* Thin display number — weight 200 for the stat-count voice we
   established on CurrentUser4x2's day number. */
.stat-value {
  font-size: 28px;
  font-weight: 300;
  line-height: 1;
  letter-spacing: -0.02em;
}
.stat-label {
  margin-top: 6px;
  font-size: 9px;
  font-weight: 300;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.sep {
  font-size: 10px;
  color: color-mix(in srgb, var(--app-muted) 50%, transparent);
}
</style>
