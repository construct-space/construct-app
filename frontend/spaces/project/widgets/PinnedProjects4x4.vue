<script setup lang="ts">
import { buildProjectRoutePath } from '@/utils/projectRoutes'
import { Pin, Folder, PinOff } from 'lucide-vue-next'

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
  const pinned = pinnedStore.pinnedByType('project').slice(0, 6)
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
      description: project?.description || pin.metadata?.description || '',
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

function unpin(entry: typeof pinnedProjects.value[number]) {
  pinnedStore.removePin(entry.pin.id)
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
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <Pin class="size-4 text-[var(--app-accent)]" />
        <span class="text-xs font-medium text-[var(--app-foreground)]">Pinned Projects</span>
        <span v-if="pinnedProjects.length" class="text-[10px] text-[var(--app-muted)] bg-[var(--app-muted)]/10 px-1.5 py-0.5 rounded-full">
          {{ pinnedProjects.length }}
        </span>
      </div>
      <button class="text-[10px] text-[var(--app-muted)] hover:text-[var(--app-accent)] transition-colors" @click="router.push('/app/projects')">
        All projects
      </button>
    </div>

    <!-- Grid -->
    <div v-if="pinnedProjects.length > 0" class="flex-1 grid grid-cols-2 grid-rows-3 gap-2 overflow-hidden">
      <div
        v-for="entry in pinnedProjects"
        :key="entry.pin.id"
        class="group relative flex items-center gap-3 text-left px-3 py-2 rounded-xl border border-[var(--app-border)] hover:border-[color-mix(in_srgb,var(--app-accent)_40%,transparent)] transition-all overflow-hidden min-w-0 cursor-pointer"
        style="background: var(--app-background);"
        @click="openProject(entry)"
      >
        <!-- Icon -->
        <div class="flex size-9 shrink-0 items-center justify-center rounded-lg" :style="{ background: entry.color + '18' }">
          <Folder class="size-4.5" :style="{ color: entry.color }" />
        </div>

        <!-- Text -->
        <div class="min-w-0 flex-1">
          <p class="text-xs font-semibold text-[var(--app-foreground)] truncate leading-tight">{{ entry.name }}</p>
          <p class="mt-0.5 text-[10px] text-[var(--app-muted)] truncate leading-tight">
            {{ entry.description || shortPath(entry.path) }}
          </p>
        </div>

        <!-- Unpin (top-right circle, like close button) -->
        <button
          class="absolute top-1 right-1 size-5 rounded-full bg-[var(--app-background)] border border-[var(--app-border)] flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-red-500/20 hover:border-red-500/40 transition-all cursor-pointer"
          title="Unpin"
          @click.stop="unpin(entry)"
        >
          <PinOff class="size-2.5 text-[var(--app-muted)]" />
        </button>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else class="flex-1 flex items-center justify-center">
      <div class="text-center">
        <Pin class="size-8 text-[var(--app-muted)]/20 mx-auto mb-2" />
        <p class="text-xs text-[var(--app-muted)]">No pinned projects</p>
        <p class="text-[10px] text-[var(--app-muted)]/60 mt-1">Pin projects from the Projects page</p>
      </div>
    </div>
  </div>
</template>
