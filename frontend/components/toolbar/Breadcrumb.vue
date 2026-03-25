<script setup lang="ts">
/**
 * ToolbarBreadcrumb - Hierarchical navigation display
 * Format: PARENT:CURRENT (light:bold)
 */

const props = defineProps<{
  path?: string
}>()

const route = useRoute()
const router = useRouter()
const { breadcrumbs, spaceConfig } = useToolbar()
const projectStore = useProjectStore()

const routeLabels: Record<string, string> = {
  'index': 'HOME',
  'projects': 'PROJECTS',
  'spaces': 'SPACES',
  'settings': 'SETTINGS',
  'brainstorm': 'CHAT',
  'architect': 'ARCHITECT',
  'vibe': 'VIBE',
  'media': 'MEDIA',
  'teams': 'TEAMS',
  'code': 'CODE',
  'design': 'DESIGN',
  'ui': 'UI',
  'ai': 'AI',
  'kanban': 'KANBAN',
  'notes': 'NOTES',
  'git': 'GIT',
  'deploy': 'DEPLOY',
  'assets': 'ASSETS',
  'responsive': 'RESPONSIVE',
  'prototype': 'PROTOTYPE',
  'dev': 'DEV',
  'editor': 'EDITOR',
  'terminal': 'TERMINAL',
  'calendar': 'CALENDAR',
  'timeline': 'TIMELINE',
  'list': 'LIST',
  'agents': 'AGENTS',
  'history': 'HISTORY',
  'pinned': 'PINNED',
  'shared': 'SHARED',
}

const displayBreadcrumbs = computed(() => {
  if (breadcrumbs.value.length > 0) {
    return breadcrumbs.value.map(b => ({ ...b, label: b.label.toUpperCase() }))
  }

  const currentPath = props.path || route.path
  let pathSegments = currentPath.split('/').filter(Boolean)

  if (pathSegments[0] === 'app') {
    pathSegments = pathSegments.slice(1)
  }

  if (pathSegments.length === 0) {
    return []
  }

  const crumbs: Array<{ label: string; to?: string }> = []
  let buildPath = '/app'

  pathSegments.forEach((segment, idx) => {
    buildPath += `/${segment}`
    const isLast = idx === pathSegments.length - 1
    const prevSegment = idx > 0 ? pathSegments[idx - 1] : null

    const label = routeLabels[segment]

    if (label) {
      crumbs.push({
        label,
        to: isLast ? undefined : buildPath
      })
    } else if (prevSegment === 'projects' && projectStore.currentProject) {
      crumbs.push({
        label: projectStore.currentProject.name.toUpperCase(),
        to: isLast ? undefined : buildPath
      })
    } else {
      crumbs.push({
        label: segment.toUpperCase().replace(/-/g, ' '),
        to: isLast ? undefined : buildPath
      })
    }
  })

  return crumbs
})
</script>

<template>
  <nav class="flex items-center gap-1.5 text-sm ml-4">
    <!-- Space icon -->
    <div v-if="spaceConfig?.icon" class="size-5 rounded flex items-center justify-center shrink-0" style="background: color-mix(in srgb, var(--app-accent) 15%, transparent)">
      <Icon :name="spaceConfig.icon" class="size-3.5" style="color: var(--app-accent)" />
    </div>
    <template v-for="(crumb, idx) in displayBreadcrumbs" :key="idx">
      <svg v-if="idx > 0" class="size-3 shrink-0" style="color: var(--app-muted)" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>

      <button
        v-if="crumb.to"
        class="hover:underline transition-colors"
        style="color: var(--app-muted)"
        @click="router.push(crumb.to)"
      >
        {{ crumb.label }}
      </button>

      <span
        v-else
        class="font-medium"
        style="color: var(--app-foreground)"
      >
        {{ crumb.label }}
      </span>
    </template>
  </nav>
</template>
