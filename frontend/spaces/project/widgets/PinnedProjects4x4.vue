<script setup lang="ts">
import { inject } from 'vue'
import { buildProjectRoutePath } from '@/utils/projectRoutes'
import { shortenHomePath } from '@/utils/paths'
import { X } from 'lucide-vue-next'
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
    api.actions.navigate(buildProjectRoutePath(entry.project))
    return
  }
  // Fallback when the project isn't in the store: reconstruct the detail
  // route from the pin id (format: "project-<routeKey>"). Don't trust
  // entry.pin.path — older pins persisted `/code` deep-routes that now 404.
  const routeKey = entry.pin.id.replace(/^project-/, '')
  api.actions.navigate(`/app/projects/${encodeURIComponent(routeKey)}`)
}

function unpin(entry: typeof pinnedProjects.value[number]) {
  pinnedStore.removePin(entry.pin.id)
}

function shortPath(fullPath: string): string {
  return shortenHomePath(fullPath)
}
</script>

<template>
  <div class="h-full flex flex-col px-4 py-3 gap-2">
    <div class="flex items-baseline justify-between">
      <div class="flex items-baseline gap-2">
        <h3 class="widget-title">Pinned Projects</h3>
        <span v-if="pinnedProjects.length" class="text-[10px] font-light text-[var(--app-muted)]">
          · {{ pinnedProjects.length }}
        </span>
      </div>
      <button class="widget-action group" @click="api.actions.navigate('/app/projects')">
        All<span class="widget-action-arrow">›</span>
      </button>
    </div>

    <div v-if="pinnedProjects.length > 0" class="flex-1 grid grid-cols-2 grid-rows-3 gap-1.5 overflow-hidden">
      <div
        v-for="entry in pinnedProjects"
        :key="entry.pin.id"
        class="pinned-card group relative flex items-center gap-3 text-left px-3 py-2 rounded-md transition-colors overflow-hidden min-w-0 cursor-pointer"
        @click="openProject(entry)"
      >
        <span class="pin-bar" :style="{ background: entry.color }" />

        <div class="min-w-0 flex-1">
          <p class="text-[12.5px] font-light text-[var(--app-foreground)] truncate leading-tight">{{ entry.name }}</p>
          <p class="mt-0.5 text-[10.5px] font-light text-[var(--app-muted)] truncate leading-tight">
            {{ entry.description || shortPath(entry.path) }}
          </p>
        </div>

        <button
          class="unpin-btn opacity-0 group-hover:opacity-100 transition-opacity"
          title="Unpin"
          @click.stop="unpin(entry)"
        >
          <X class="size-3" />
        </button>
      </div>
    </div>

    <div v-else class="flex-1 flex flex-col items-center justify-center gap-1">
      <p class="text-[11px] text-[var(--app-muted)]">No pinned projects</p>
      <p class="text-[10px] font-light text-[var(--app-muted)]/60">Pin projects from the Projects page</p>
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

.pinned-card:hover {
  background: color-mix(in srgb, var(--app-foreground) 4%, transparent);
}
/* 2px left accent bar — per-project hue lives here instead of in a
   filled icon box. Flush with the card's left edge for structure. */
.pin-bar {
  display: block;
  width: 2px;
  height: 28px;
  border-radius: 2px;
  flex-shrink: 0;
}

.unpin-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  color: var(--app-muted);
  transition: color 160ms ease, background 160ms ease, opacity 160ms ease;
}
.unpin-btn:hover {
  color: var(--app-accent);
  background: color-mix(in srgb, var(--app-accent) 10%, transparent);
}
</style>
