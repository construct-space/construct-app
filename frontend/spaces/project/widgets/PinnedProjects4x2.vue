<script setup lang="ts">
import { inject } from 'vue'
import { buildProjectRoutePath } from '@/utils/projectRoutes'
import { shortenHomePath } from '@/utils/paths'
import type { BuiltinWidgetApi } from '@/lib/widgetApi'

const api = inject<BuiltinWidgetApi>('widgetApi')!
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
    api.actions.navigate(buildProjectRoutePath(entry.project))
    return
  }
  // Fallback when the project isn't in the store: reconstruct the detail
  // route from the pin id (format: "project-<routeKey>"). Don't trust
  // entry.pin.path — older pins persisted `/code` deep-routes that now 404.
  const routeKey = entry.pin.id.replace(/^project-/, '')
  api.actions.navigate(`/app/projects/${encodeURIComponent(routeKey)}`)
}

function shortPath(fullPath: string): string {
  return shortenHomePath(fullPath)
}
</script>

<template>
  <div class="h-full flex flex-col px-4 py-3 gap-2">
    <div class="flex items-baseline justify-between">
      <h3 class="widget-title">Pinned</h3>
      <button class="widget-action group" @click="api.actions.navigate('/app/projects')">
        All<span class="widget-action-arrow">›</span>
      </button>
    </div>

    <div v-if="pinnedProjects.length > 0" class="flex-1 grid grid-cols-4 gap-2 overflow-hidden">
      <button
        v-for="entry in pinnedProjects"
        :key="entry.pin.id"
        class="pinned-tile group flex flex-col justify-between p-2 rounded-lg text-left overflow-hidden transition-colors min-w-0"
        @click="openProject(entry)"
      >
        <span class="color-stripe" :style="{ background: entry.color }" />
        <p class="text-[12px] font-light text-[var(--app-foreground)] truncate mt-1">{{ entry.name }}</p>
        <p class="text-[10px] font-light text-[var(--app-muted)] truncate">{{ shortPath(entry.path) }}</p>
      </button>
    </div>

    <div v-else class="flex-1 flex items-center justify-center">
      <p class="text-[11px] text-[var(--app-muted)]">No pinned projects</p>
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
.widget-action {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 10.5px;
  font-weight: 300;
  color: var(--app-muted);
}
.widget-action:hover { color: var(--app-foreground); }
.widget-action-arrow {
  display: inline-block;
  transition: transform 160ms ease;
}
.widget-action:hover .widget-action-arrow { transform: translateX(2px); }

.pinned-tile:hover {
  background: color-mix(in srgb, var(--app-foreground) 4%, transparent);
}
/* A slim color stripe replaces the old filled icon box — keeps the
   per-project hue as an identity cue without the visual noise. */
.color-stripe {
  display: block;
  height: 2px;
  width: 24px;
  border-radius: 2px;
  margin-bottom: 6px;
}
</style>
