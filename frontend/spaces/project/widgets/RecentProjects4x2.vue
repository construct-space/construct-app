<script setup lang="ts">
import { inject } from 'vue'
import { buildProjectRoutePath } from '@/utils/projectRoutes'
import type { BuiltinWidgetApi } from '@/lib/widgetApi'

const api = inject<BuiltinWidgetApi>('widgetApi')!
const projectStore = useProjectStore()

const projects = computed(() => {
  return [...projectStore.recentProjects]
    .sort((a, b) => new Date(b.last_opened_at || 0).getTime() - new Date(a.last_opened_at || 0).getTime())
    .slice(0, 4)
})

function openProject(project: { path: string }) {
  projectStore.openProject(project.path)
  api.actions.navigate(buildProjectRoutePath(project))
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
  <div class="h-full flex flex-col px-4 py-3 gap-2">
    <div class="flex items-baseline justify-between">
      <h3 class="widget-title">Recent</h3>
      <button class="widget-action group" @click="api.actions.navigate('/app/projects')">
        All<span class="widget-action-arrow">›</span>
      </button>
    </div>

    <div v-if="projects.length > 0" class="flex-1 flex flex-col gap-0.5 overflow-hidden">
      <button
        v-for="project in projects"
        :key="project.path"
        class="project-row group flex items-baseline gap-3 px-1 py-1.5 rounded-md text-left transition-colors"
        @click="openProject(project)"
      >
        <span class="text-[12.5px] font-light text-[var(--app-foreground)] truncate shrink-0">
          {{ project.name }}
        </span>
        <span class="text-[11px] font-light text-[var(--app-muted)] truncate flex-1 min-w-0">
          {{ truncatePath(project.path) }}
        </span>
        <span v-if="project.last_opened_at" class="text-[10px] tabular-nums text-[var(--app-muted)] shrink-0">
          {{ timeAgo(project.last_opened_at) }}
        </span>
      </button>
    </div>

    <div v-else class="flex-1 flex items-center justify-center">
      <button
        class="text-[11px] text-[var(--app-muted)] hover:text-[var(--app-foreground)] transition-colors"
        @click="api.actions.navigate('/app/projects')"
      >
        No recent projects — <span class="underline decoration-dotted underline-offset-2">open one</span>
      </button>
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
  transition: color 160ms ease;
}
.widget-action:hover { color: var(--app-foreground); }
.widget-action-arrow {
  display: inline-block;
  transition: transform 160ms ease;
}
.widget-action:hover .widget-action-arrow { transform: translateX(2px); }

.project-row:hover {
  background: color-mix(in srgb, var(--app-foreground) 4%, transparent);
}
</style>
