<script setup lang="ts">
import { buildProjectRoutePath } from '@/utils/projectRoutes'
import { Pin } from 'lucide-vue-next'

const router = useRouter()
const projectStore = useProjectStore()
const pinnedStore = usePinnedStore()

const PALETTE = ['#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#14b8a6', '#eab308', '#ef4444', '#06b6d4', '#84cc16', '#6366f1']

function hashColor(name: string): string {
  let hash = 0
  for (const ch of name) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0
  return PALETTE[Math.abs(hash) % PALETTE.length]
}

const pinnedProjects = computed(() => {
  const pinned = pinnedStore.pinnedByType('project').slice(0, 4)
  return pinned.map(pin => {
    const project = projectStore.projects.find(p =>
      `project-${p.id}` === pin.id || p.path === pin.metadata?.localPath
    )
    return {
      pin,
      project,
      name: project?.name || pin.name,
      path: project?.path || pin.metadata?.localPath || '',
      color: project?.color || hashColor(project?.name || pin.name),
    }
  })
})

function openProject(entry: typeof pinnedProjects.value[number]) {
  if (entry.project) {
    projectStore.openProject(entry.project.path)
    router.push(buildProjectRoutePath(entry.project))
  } else {
    router.push(entry.pin.path)
  }
}

function shortPath(fullPath: string): string {
  if (!fullPath) return ''
  const home = '/Users/' + fullPath.split('/')[2]
  if (fullPath.startsWith(home + '/')) return '~/' + fullPath.slice(home.length + 1)
  return fullPath
}
</script>

<template>
  <div class="h-full flex flex-col p-3 gap-2">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <Pin class="size-4 text-[var(--app-accent)]" />
        <span class="text-xs font-medium text-[var(--app-foreground)]">Pinned</span>
      </div>
      <button class="text-[10px] text-[var(--app-muted)] hover:text-[var(--app-accent)] transition-colors" @click="router.push('/app/projects')">
        All
      </button>
    </div>

    <div v-if="pinnedProjects.length > 0" class="flex-1 grid grid-cols-4 gap-1.5 overflow-hidden">
      <button
        v-for="entry in pinnedProjects"
        :key="entry.pin.id"
        class="flex flex-col items-center gap-1 p-2 rounded-lg hover:bg-[var(--app-accent)]/5 transition-colors overflow-hidden"
        @click="openProject(entry)"
      >
        <div class="flex size-8 shrink-0 items-center justify-center rounded-lg" :style="{ background: entry.color + '18' }">
          <Icon name="i-lucide-folder" class="size-4" :style="{ color: entry.color }" />
        </div>
        <p class="text-[11px] font-medium text-[var(--app-foreground)] truncate w-full text-center">{{ entry.name }}</p>
        <p class="text-[10px] text-[var(--app-muted)] truncate w-full text-center">{{ shortPath(entry.path) }}</p>
      </button>
    </div>

    <div v-else class="flex-1 flex items-center justify-center">
      <p class="text-xs text-[var(--app-muted)]">No pinned projects</p>
    </div>
  </div>
</template>
