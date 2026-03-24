<script setup lang="ts">
import { buildProjectRoutePath } from '@/utils/projectRoutes'
import { FolderOpen, FolderPlus } from 'lucide-vue-next'

const router = useRouter()
const projectStore = useProjectStore()

const projects = computed(() => {
  return [...projectStore.recentProjects]
    .sort((a, b) => new Date(b.last_opened_at).getTime() - new Date(a.last_opened_at).getTime())
    .slice(0, 8)
})

function openProject(project: any) {
  projectStore.openProject(project.path)
  router.push(buildProjectRoutePath(project))
}

function timeAgo(dateStr: string) {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function truncatePath(path: string) {
  if (path.length <= 30) return path
  const parts = path.split('/')
  if (parts.length <= 3) return path
  return `~/${parts.slice(-2).join('/')}`
}
</script>

<template>
  <div class="h-full flex flex-col p-3 gap-2">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <FolderOpen class="size-4 text-[var(--app-accent)]" />
        <span class="text-xs font-medium text-[var(--app-foreground)]">Recent Projects</span>
      </div>
      <button class="text-[10px] text-[var(--app-muted)] hover:text-[var(--app-accent)]" @click="router.push('/app/projects')">
        All projects
      </button>
    </div>
    <div v-if="projects.length > 0" class="flex-1 grid grid-cols-4 gap-1.5 overflow-hidden">
      <button
        v-for="project in projects"
        :key="project.path"
        class="text-left px-2.5 py-1.5 rounded-lg hover:bg-[var(--app-accent)]/5 transition-colors overflow-hidden"
        @click="openProject(project)"
      >
        <p class="text-xs font-medium text-[var(--app-foreground)] truncate">{{ project.name }}</p>
        <p class="text-[10px] text-[var(--app-muted)] truncate">{{ truncatePath(project.path) }}</p>
        <p class="text-[10px] text-[var(--app-muted)]">{{ timeAgo(project.last_opened_at) }}</p>
      </button>
    </div>
    <div v-else class="flex-1 flex items-center justify-center">
      <div class="text-center">
        <p class="text-xs text-[var(--app-muted)]">No recent projects</p>
        <button
          class="mt-1.5 flex items-center gap-1 mx-auto text-[10px] text-[var(--app-accent)] hover:underline"
          @click="router.push('/app/projects')"
        >
          <FolderPlus class="size-3" />
          Create one
        </button>
      </div>
    </div>
  </div>
</template>
