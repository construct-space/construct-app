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
const { breadcrumbs } = useToolbar()
const projectStore = useProjectStore()

const routeLabels: Record<string, string> = {
  'index': 'HOME',
  'projects': 'PROJECTS',
  'spaces': 'SPACES',
  'settings': 'SETTINGS',
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
  <div class="flex items-center text-sm tracking-wide ml-4">
    <template v-for="(crumb, idx) in displayBreadcrumbs" :key="idx">
      <span v-if="idx > 0" class="text-gray-500 mx-0.5">:</span>

      <button
        v-if="crumb.to"
        class="text-gray-500 dark:text-gray-400 font-light hover:text-gray-900 dark:hover:text-white transition-colors"
        @click="router.push(crumb.to)"
      >
        {{ crumb.label }}
      </button>

      <span
        v-else
        class="text-gray-900 dark:text-white font-bold"
      >
        {{ crumb.label }}
      </span>
    </template>
  </div>
</template>
