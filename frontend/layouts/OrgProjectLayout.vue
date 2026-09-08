<script setup lang="ts">
/**
 * OrgProjectLayout — two-column shell for /app/org-project/:projectId/*.
 *
 * Mirrors OrgSettingsPage's pattern: a left column with branding + a list
 * of installed projectAware spaces, and a right column rendering the
 * routed child page (org-project detail or a project-scoped space).
 *
 * Stays out of Sidebar3D — the outer cube is unaffected.
 */
import { useRoute } from 'vue-router'
import { computed, onMounted, ref, watch } from 'vue'
import { useSpaces, getProjectSpaces } from '@/composables/useSpaces'
import { useSpaceAutoInstall } from '@/composables/useSpaceAutoInstall'
import { getSpace as getSpaceConfig } from '@/config/spaces'
import { routeParamString } from '@/utils/projectRoutes'
import {
  useOrgProjects,
  type OrgProject,
} from '@/spaces/org-project/composables/useOrgProjects'
import { FolderKanban, LayoutGrid } from 'lucide-vue-next'

const route = useRoute()
const { spaces, loadSpaces } = useSpaces()
const { installMissing } = useSpaceAutoInstall()
const { projects, fetchProject, fetchProjects } = useOrgProjects()

const projectId = computed(() => routeParamString(route.params.projectId))
const project = ref<OrgProject | null>(null)

async function resolveProject() {
  const id = projectId.value
  if (!id) {
    project.value = null
    return
  }
  let found = projects.value.find(p => p.id === id) ?? null
  if (!found) found = await fetchProject(id)
  if (!found && projects.value.length === 0) {
    await fetchProjects()
    found = projects.value.find(p => p.id === id) ?? null
  }
  project.value = found
}

const navItems = computed(() => {
  if (!project.value) return []
  const id = project.value.id
  const projectAware = getProjectSpaces(spaces.value)
  return projectAware.map((s) => {
    const cfg = getSpaceConfig(s.name)
    return {
      id: s.name,
      label: s.displayName || s.name,
      icon: cfg.icon || s.icon || 'i-lucide-circle',
      path: `/app/org-project/${id}/${s.name}`,
    }
  })
})

const overviewPath = computed(() =>
  project.value ? `/app/org-project/${project.value.id}` : '/app/org-project',
)

const sidebarWidth = ref(260)
const isResizing = ref(false)
const MIN_WIDTH = 220
const MAX_WIDTH = 480

function startResize(e: MouseEvent) {
  e.preventDefault()
  isResizing.value = true
  const startX = e.clientX
  const startWidth = sidebarWidth.value

  function onMove(ev: MouseEvent) {
    const delta = ev.clientX - startX
    sidebarWidth.value = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + delta))
  }

  function onUp() {
    isResizing.value = false
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }

  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

onMounted(async () => {
  if (spaces.value.length === 0) await loadSpaces()
  await resolveProject()
  const installed = new Set(spaces.value.map(s => s.name))
  const missing = navItems.value.map(i => i.id).filter(id => !installed.has(id))
  if (missing.length > 0) {
    await installMissing(missing)
    await loadSpaces()
  }
})

watch(() => route.params.projectId, () => { resolveProject() })
</script>

<template>
  <div class="h-full flex" :class="isResizing ? 'select-none' : ''">
    <!-- LEFT COLUMN — project branding + space nav -->
    <div
      class="shrink-0 flex flex-col items-start px-6 py-10 overflow-y-auto"
      :style="{ width: sidebarWidth + 'px' }"
    >
      <p class="text-lg tracking-wide select-none mb-1">
        <span class="text-app-muted font-normal">{{ (project?.name || 'PROJECT').toUpperCase() }}:</span><span
          class="font-bold text-app-foreground">SPACES</span>
      </p>
      <p class="text-xs text-app-muted uppercase tracking-widest mb-4">
        Org Project
      </p>

      <nav class="w-full space-y-6">
        <div>
          <p class="text-[10px] font-semibold tracking-widest text-app-muted uppercase mb-1.5 px-1">
            Project
          </p>
          <div class="space-y-0.5">
            <RouterLink
              :to="overviewPath"
              class="flex items-center gap-2.5 px-2 py-1.5 rounded text-xs font-normal uppercase tracking-wider transition-colors"
              :class="route.path === overviewPath
                ? 'text-app-accent bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)]'
                : 'text-app-foreground hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)]'"
            >
              <FolderKanban class="w-4 h-4 shrink-0"
                :class="route.path === overviewPath ? 'text-app-accent' : 'text-app-muted'" />
              <span>Overview</span>
            </RouterLink>
          </div>
        </div>

        <div v-if="navItems.length > 0">
          <p class="text-[10px] font-semibold tracking-widest text-app-muted uppercase mb-1.5 px-1">
            Spaces
          </p>
          <div class="space-y-0.5">
            <RouterLink
              v-for="item in navItems"
              :key="item.id"
              :to="item.path"
              class="flex items-center gap-2.5 px-2 py-1.5 rounded text-xs font-normal uppercase tracking-wider transition-colors"
              :class="route.path.startsWith(item.path)
                ? 'text-app-accent bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)]'
                : 'text-app-foreground hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)]'"
            >
              <Icon :name="item.icon" class="w-4 h-4 shrink-0"
                :class="route.path.startsWith(item.path) ? 'text-app-accent' : 'text-app-muted'" />
              <span>{{ item.label }}</span>
            </RouterLink>
          </div>
        </div>

        <div v-else class="text-[11px] text-app-muted px-1">
          <LayoutGrid class="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
          No project-aware spaces installed.
        </div>
      </nav>
    </div>

    <!-- Resize handle -->
    <div class="w-1 shrink-0 cursor-col-resize group relative" @mousedown="startResize">
      <div
        class="absolute inset-y-0 -left-px w-[3px] transition-colors"
        :class="isResizing ? 'bg-[var(--app-accent)]' : 'bg-transparent group-hover:bg-[var(--app-border)]'"
      />
    </div>

    <!-- RIGHT COLUMN — page content -->
    <div class="flex-1 min-w-0 overflow-y-auto">
      <RouterView />
    </div>
  </div>
</template>
