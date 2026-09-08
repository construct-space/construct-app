<script setup lang="ts">
/**
 * ToolbarBreadcrumb - Hierarchical navigation display
 * Format: PARENT:CURRENT (light:bold)
 */

import type { ToolbarBreadcrumb } from '@/composables/useToolbar'

const props = defineProps<{
  path?: string
  /** Per-panel snapshot. When provided, takes precedence over the global
   * toolbar breadcrumbs — used by Toolbar3D to keep the cube's two faces
   * showing their own content during rotation. */
  breadcrumbs?: ToolbarBreadcrumb[]
}>()

import { getSpace as getSpaceConfig, hasSpaceTheme } from '@/config/spaces'
import { getCachedOrgProject } from '@/spaces/org-project/composables/useOrgProjects'

const route = useRoute()
const router = useRouter()
const { breadcrumbs: globalBreadcrumbs } = useToolbar()

// Open index of a breadcrumb dropdown (crumbs with `options` - e.g. a board
// switcher). The menu is teleported to <body> with fixed positioning because
// the breadcrumb nav + Toolbar3D clip overflow, which would hide an absolutely
// positioned menu. Selecting an option navigates like a normal crumb `to`.
const openCrumb = ref<number | null>(null)
const menuPos = ref<{ left: number; top: number } | null>(null)
function toggleCrumb(idx: number, e: MouseEvent) {
  if (openCrumb.value === idx) { openCrumb.value = null; return }
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  menuPos.value = { left: r.left, top: r.bottom + 4 }
  openCrumb.value = idx
}
function pickCrumbOption(to: string) {
  openCrumb.value = null
  router.push(resolveCrumbTo(to))
}
const activeCrumbMenu = computed(() =>
  openCrumb.value !== null ? displayBreadcrumbs.value[openCrumb.value] ?? null : null,
)
const breadcrumbs = computed(() =>
  props.breadcrumbs !== undefined ? props.breadcrumbs : globalBreadcrumbs.value,
)
const projectStore = useProjectStore()
const orgStore = useOrgStore()

// Fallback icons for routes that don't have a space config
const routeIcons: Record<string, string> = {
  'projects': 'lucide:folder-open',
  'spaces': 'lucide:layout-grid',
  'marketplace': 'lucide:store',
  'settings': 'lucide:settings',
  'ask': 'lucide:message-circle',
  'editor': 'lucide:code',
  'builder': 'lucide:hammer',
  'space-developer': 'lucide:boxes',
}

// Derive space name from THIS panel's path, not the shared toolbar state
function getSpaceFromPath(path: string): string | null {
  const segments = path.replace(/^\/app\//, '').split('/')
  // /app/projects/:id/:spaceName
  if (segments[0] === 'projects' && segments.length >= 3) return segments[2]
  return segments[0] || null
}

const breadcrumbIcon = computed(() => {
  const currentPath = props.path || route.path
  const spaceName = getSpaceFromPath(currentPath)

  // Virtual-parent icon wins. Routes that surface under an umbrella
  // (Builder / SpaceKit → DEV) should read as that umbrella, not the
  // leaf. Otherwise users only get the page-level icon and lose the
  // sense of where they are.
  const firstSegment = currentPath.replace(/^\/app\//, '').split('/')[0]
  if (firstSegment && virtualParent[firstSegment]?.icon) {
    return virtualParent[firstSegment].icon
  }

  // Get icon from this path's space config — but only for spaces that are
  // actually registered. Host pseudo-routes (spaces, marketplace, settings…)
  // are not real spaces, so they fall through to routeIcons instead of
  // getSpace()'s generic box default, which would otherwise shadow them.
  if (spaceName && hasSpaceTheme(spaceName)) {
    const config = getSpaceConfig(spaceName)
    if (config.icon) return config.icon
  }

  // Fall back to route-based icon
  const segments = currentPath.split('/').filter(Boolean)
  for (let i = segments.length - 1; i >= 0; i--) {
    if (routeIcons[segments[i]]) return routeIcons[segments[i]]
  }
  // Last resort for unknown/unregistered routes — keep the generic box.
  return 'i-lucide-box'
})

const routeLabels: Record<string, string> = {
  'index': 'HOME',
  'projects': 'PROJECTS',
  'org-project': 'ORG PROJECT',
  'spaces': 'SPACES',
  'marketplace': 'SPACE STORE',
  // Intermediate Space Store segments: collections/<slug> and spaces/<id>.
  // routes.ts has redirects for the slug-less paths so these breadcrumb
  // links route back to the store home cleanly.
  'collections': 'COLLECTIONS',
  // 'spaces' is reused for /app/spaces — handled by the existing entry
  // above, so no override needed here.
  'settings': 'SETTINGS',
  'ask': 'ASK',
  'builder': 'BUILDER',
  'space-developer': 'SPACE DEVELOPER',
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

// Routes that should show a virtual parent breadcrumb. When a route
// surfaces under a parent that isn't part of its URL (e.g. Builder
// lives at /app/builder but is logically inside the Developer Portal),
// declare the parent here. The optional `icon` is used as the leading
// breadcrumb icon so the user sees the umbrella, not the leaf, when
// arriving via a deeplink.
const virtualParent: Record<string, { label: string; to: string; icon?: string }> = {
  'marketplace': { label: 'SPACES', to: '/app/spaces' },
  'builder': { label: 'DEV', to: '/app/developer', icon: 'lucide:code-2' },
  'space-developer': { label: 'DEV', to: '/app/developer', icon: 'lucide:code-2' },
}

/**
 * Resolve a crumb's `to` path. Host pages emit absolute `/app/...` paths,
 * but dynamic spaces emit space-relative ones like `/folder-123` — the
 * SDK's useNavigator handles those, but a direct `router.push` here would
 * escape the space subtree. When the current route is under a space, scope
 * any non-`/app` path to that space's mount base.
 */
function resolveCrumbTo(to: string): string {
  if (!to.startsWith('/')) return to
  if (to.startsWith('/app')) return to
  const params = route.params as Record<string, string | string[] | undefined>
  const spaceName = Array.isArray(params.spaceName) ? params.spaceName[0] : params.spaceName
  if (!spaceName) return to
  const subPage = Array.isArray(params.subPage) ? params.subPage[0] : params.subPage
  const path = route.path
  let base = path
  if (subPage) {
    const idx = path.lastIndexOf('/' + subPage)
    if (idx >= 0) base = path.slice(0, idx)
  } else {
    base = path.replace(/\/+$/, '')
  }
  return to === '/' ? base : base + to
}

/** Truncate long labels with middle ellipsis: "CLASSIC-PACMAN-CONSTRUCT" → "CLASSIC-…NSTRUCT" */
function middleEllipsis(text: string, max = 15): string {
  if (text.length <= max) return text
  const keep = Math.floor((max - 1) / 2)
  return text.slice(0, keep) + '…' + text.slice(text.length - keep)
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

  // Suppress raw UUID-shaped segments. Spaces using filesystem routing
  // ([id]/index.vue, etc.) typically resolve the segment to a human label via
  // useToolbar().setBreadcrumbs() once their data loads — but until that
  // fires we'd otherwise render `12B3-4C5D-...` as a breadcrumb leaf, which
  // is jarring during route changes and inside the Toolbar3D rotation
  // animation that shows both front and bottom panels at once.
  const isUuidLike = (seg: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg) ||
    /^[0-9a-f]{24,}$/i.test(seg)

  const crumbs: Array<{ label: string; to?: string; options?: { label: string; to: string }[] }> = []

  // Inject virtual parent if the first segment has one (e.g. marketplace → SPACES > MARKETPLACE)
  if (pathSegments.length > 0 && virtualParent[pathSegments[0]]) {
    const parent = virtualParent[pathSegments[0]]
    crumbs.push({ label: parent.label, to: parent.to })
  }

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
    } else if (prevSegment === 'org-project') {
      const orgProject = getCachedOrgProject(segment)
      crumbs.push({
        label: (orgProject?.name || segment).toUpperCase(),
        to: isLast ? undefined : buildPath
      })
    } else if (prevSegment === 'members' || prevSegment === 'org-members') {
      const member = orgStore.getMemberById(segment)
      crumbs.push({
        label: (member?.name || segment).toUpperCase(),
        to: isLast ? undefined : buildPath
      })
    } else if (prevSegment === 'departments' || prevSegment === 'org-departments') {
      const dept = orgStore.getDepartmentById(segment)
      crumbs.push({
        label: (dept?.name || segment).toUpperCase(),
        to: isLast ? undefined : buildPath
      })
    } else if (prevSegment === 'teams' || prevSegment === 'org-teams') {
      const team = orgStore.getTeamById(segment)
      crumbs.push({
        label: (team?.name || segment).toUpperCase(),
        to: isLast ? undefined : buildPath
      })
    } else if (isUuidLike(segment)) {
      crumbs.push({
        label: '…',
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
  <nav class="flex items-center gap-1.5 text-sm min-w-0 overflow-hidden">
    <!-- Breadcrumb icon (space icon or route fallback) -->
    <div v-if="breadcrumbIcon" class="size-5 rounded flex items-center justify-center shrink-0"
      style="background: color-mix(in srgb, var(--app-accent) 15%, transparent)">
      <Icon :name="breadcrumbIcon" class="size-3.5" style="color: var(--app-accent)" />
    </div>
    <template v-for="(crumb, idx) in displayBreadcrumbs" :key="idx">
      <svg v-if="idx > 0" class="size-3 shrink-0" style="color: var(--app-muted)" fill="none" viewBox="0 0 24 24"
        stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
      </svg>

      <!-- Dropdown crumb: a switcher (e.g. boards). -->
      <button
        v-if="crumb.options && crumb.options.length"
        class="flex items-center gap-1 font-medium truncate min-w-0 shrink-0 hover:opacity-80 transition"
        style="color: var(--app-foreground)" :title="crumb.label"
        @click="toggleCrumb(idx, $event)"
      >
        <span class="truncate">{{ crumb.label }}</span>
        <svg class="size-3 shrink-0 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <button v-else-if="crumb.to" class="hover:underline transition-colors shrink-0" style="color: var(--app-muted)"
        :title="crumb.label" @click="router.push(resolveCrumbTo(crumb.to))">
        {{ middleEllipsis(crumb.label) }}
      </button>

      <span v-else class="font-medium truncate min-w-0" style="color: var(--app-foreground)" :title="crumb.label">
        {{ crumb.label }}
      </span>
    </template>

    <!-- Dropdown menu, teleported out of the overflow-clipped toolbar. -->
    <Teleport to="body">
      <template v-if="activeCrumbMenu && activeCrumbMenu.options && menuPos">
        <div class="fixed inset-0" style="z-index: 60" @click="openCrumb = null" />
        <div
          class="fixed min-w-[180px] max-h-[320px] overflow-auto rounded-md border py-1 shadow-lg"
          style="z-index: 61; background: var(--app-background); border-color: var(--app-border)"
          :style="{ left: menuPos.left + 'px', top: menuPos.top + 'px' }"
        >
          <button
            v-for="opt in activeCrumbMenu.options" :key="opt.to"
            class="block w-full text-left px-3 py-1.5 text-sm truncate hover:bg-[color-mix(in_srgb,var(--app-foreground)_8%,transparent)]"
            :style="opt.label.toUpperCase() === activeCrumbMenu.label ? 'color: var(--app-accent); font-weight: 600' : 'color: var(--app-foreground)'"
            @click="pickCrumbOption(opt.to)"
          >
            {{ opt.label }}
          </button>
        </div>
      </template>
    </Teleport>
  </nav>
</template>
