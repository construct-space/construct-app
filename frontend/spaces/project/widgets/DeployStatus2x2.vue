<script setup lang="ts">
import { Rocket } from 'lucide-vue-next'
import { buildProjectRoutePath } from '@/utils/projectRoutes'

const router = useRouter()
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
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function openDeploy(entry: DeployEntry) {
  if (entry.projectPath) {
    const project = projectStore.projects.find(p => p.path === entry.projectPath)
    if (project) {
      projectStore.openProject(project.path)
      router.push(buildProjectRoutePath(project))
      return
    }
  }
  window.open(`https://${entry.domain}`, '_blank')
}
</script>

<template>
  <div class="h-full flex flex-col p-3 gap-2">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <Rocket class="size-4 text-emerald-500" />
        <span class="text-xs font-medium text-[var(--app-foreground)]">Deployed</span>
        <span v-if="deploys.length" class="text-[10px] text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded-full">
          {{ deploys.length }}
        </span>
      </div>
    </div>

    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <span class="size-4 border-2 border-[var(--app-muted)]/30 border-t-[var(--app-accent)] rounded-full animate-spin" />
    </div>

    <div v-else-if="deploys.length > 0" class="flex-1 flex flex-col gap-1.5 overflow-hidden">
      <button
        v-for="entry in deploys"
        :key="entry.domain"
        class="flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-emerald-500/5 transition-colors text-left min-w-0"
        @click="openDeploy(entry)"
      >
        <span class="size-2 rounded-full bg-emerald-400 shrink-0 animate-pulse" />
        <div class="min-w-0 flex-1">
          <p class="text-xs font-medium text-[var(--app-foreground)] truncate">{{ entry.name }}</p>
          <p class="text-[10px] text-[var(--app-muted)] truncate">{{ entry.domain }}</p>
        </div>
        <span class="text-[10px] text-[var(--app-muted)] shrink-0">{{ timeAgo(entry.updatedAt) }}</span>
      </button>
    </div>

    <div v-else class="flex-1 flex items-center justify-center">
      <div class="text-center">
        <Rocket class="size-8 text-[var(--app-muted)]/20 mx-auto mb-2" />
        <p class="text-xs text-[var(--app-muted)]">No deployments yet</p>
      </div>
    </div>
  </div>
</template>
