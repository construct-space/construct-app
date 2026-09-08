<script setup lang="ts">
import { inject } from 'vue'
import { buildProjectRoutePath } from '@/utils/projectRoutes'
import type { BuiltinWidgetApi } from '@/lib/widgetApi'

const api = inject<BuiltinWidgetApi>('widgetApi')!
const projectStore = useProjectStore()

interface DeployEntry {
  name: string
  domain: string
  status: string
  projectPath?: string
  updatedAt: string
}

const deploys = ref<DeployEntry[]>([])
const loading = ref(true)

onMounted(async () => {
  try {
    const { useBasepodDeploy } = await import('@/composables/useBasepodDeploy')
    const { loadDeployInfo, generateAppName } = useBasepodDeploy()
    const entries: DeployEntry[] = []
    for (const project of projectStore.projects) {
      const info = await loadDeployInfo(project.path)
      if (info) {
        entries.push({
          name: project.name,
          domain: info.domain || `${generateAppName(project.name)}.construct.ninja`,
          status: 'live',
          projectPath: project.path,
          updatedAt: info.deployed_at || project.updated_at,
        })
      }
    }
    deploys.value = entries.slice(0, 4)
  } catch { /* ignore */ }
  loading.value = false
})

function timeAgo(dateStr: string): string {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function openDeploy(entry: DeployEntry) {
  if (entry.projectPath) {
    const project = projectStore.projects.find(p => p.path === entry.projectPath)
    if (project) {
      projectStore.openProject(project.path)
      api.actions.navigate(buildProjectRoutePath(project))
      return
    }
  }
  window.open(`https://${entry.domain}`, '_blank')
}
</script>

<template>
  <div class="h-full flex flex-col px-4 py-3 gap-2">
    <div class="flex items-baseline justify-between">
      <div class="flex items-baseline gap-2">
        <h3 class="widget-title">Deployed</h3>
        <span v-if="deploys.length" class="text-[10px] font-light text-[var(--app-muted)]">
          · {{ deploys.length }}
        </span>
      </div>
    </div>

    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <span class="size-3 border border-[var(--app-muted)]/30 border-t-[var(--app-accent)] rounded-full animate-spin" />
    </div>

    <div v-else-if="deploys.length > 0" class="flex-1 flex flex-col gap-0.5 overflow-hidden">
      <button
        v-for="entry in deploys"
        :key="entry.domain"
        class="deploy-row group flex items-baseline gap-2.5 px-1 py-1.5 rounded-md text-left transition-colors min-w-0"
        @click="openDeploy(entry)"
      >
        <span class="live-dot shrink-0" />
        <span class="text-[12px] font-light text-[var(--app-foreground)] truncate">{{ entry.name }}</span>
        <span class="text-[10.5px] font-light text-[var(--app-muted)] truncate flex-1 min-w-0">{{ entry.domain }}</span>
        <span class="text-[10px] tabular-nums text-[var(--app-muted)] shrink-0">{{ timeAgo(entry.updatedAt) }}</span>
      </button>
    </div>

    <div v-else class="flex-1 flex items-center justify-center">
      <p class="text-[11px] text-[var(--app-muted)]">No deployments yet</p>
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
.deploy-row:hover {
  background: color-mix(in srgb, var(--app-foreground) 4%, transparent);
}
/* Live pulse — the emerald dot is the only color signal on the card,
   which is all the status nuance we need. */
.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #10b981;
  box-shadow: 0 0 0 2px color-mix(in srgb, #10b981 20%, transparent);
  animation: deploy-pulse 2s ease-in-out infinite;
  transform: translateY(1px);
}
@keyframes deploy-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}
</style>
