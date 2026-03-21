<script setup lang="ts">
/**
 * ProjectLayout - Wraps all project-scoped routes.
 *
 * 1. Resolves project from route :projectId param
 * 2. Loads projects if needed (auto-initializes projectsRoot)
 * 3. Sets currentProject on the store
 * 4. Configures sidebar with project spaces
 * 5. Renders <RouterView /> for children (detail, spaces)
 */
import { useRoute } from 'vue-router'
import { watch, onMounted, onUnmounted } from 'vue'
import { useProjectStore } from '@/stores/project'
import { useSidebar } from '@/composables/useSidebar'
import { useSpaces, getProjectSpaces } from '@/composables/useSpaces'
import { useSpaceAutoInstall } from '@/composables/useSpaceAutoInstall'
import { getSpace as getSpaceConfig } from '@/config/spaces'
import { projectMatchesLookup, routeParamString } from '@/utils/projectRoutes'
import { useOperator } from '@/operator'

const route = useRoute()
const projectStore = useProjectStore()
const { enterProject } = useSidebar()
const { spaces, loadSpaces } = useSpaces()
const { installMissing } = useSpaceAutoInstall()
const { setProject, clearProject } = useOperator()

const projectId = () => routeParamString(route.params.projectId)

async function resolveAndOpenProject() {
  const id = projectId()
  if (!id) return

  // Auto-initialize projectsRoot if not set
  if (!projectStore.projectsRoot) {
    const { useProjectDirectory } = await import('@/composables/useProjectDirectory')
    const projectDir = useProjectDirectory()
    const defaultRoot = await projectDir.getDefaultProjectsRoot()
    if (defaultRoot) {
      await projectDir.setProjectsRoot(defaultRoot)
      projectStore.setProjectsRoot(defaultRoot)
    }
  }

  // Load projects if empty
  if (projectStore.projects.length === 0) {
    await projectStore.loadProjects()
  }

  // Try to find and open by slug
  let project = projectStore.openProjectById(id)
  if (project) {
    await activateProjectMode(project)
    return
  }

  // Fallback: scan disk for matching project
  const { useProjectDirectory } = await import('@/composables/useProjectDirectory')
  const projectDir = useProjectDirectory()
  const allProjects = await projectDir.listProjects()

  for (const entry of allProjects) {
    if (projectMatchesLookup({ name: entry.config?.name, path: entry.path }, id)
      || projectMatchesLookup({ name: entry.name, path: entry.path }, id)) {
      project = projectStore.openProject(entry.path)
      if (project && entry.config) {
        project.name = entry.config.name || project.name
        project.spaces = (entry.config.spaces as typeof project.spaces) || project.spaces
      }
      if (project) {
        await activateProjectMode(project)
      }
      return
    }
  }
}

async function activateProjectMode(project: { id: string | number; name: string; path?: string; local_path?: string; spaces: string[] }) {
  if (spaces.value.length === 0) {
    await loadSpaces()
  }

  const projectSpaces = getProjectSpaces(spaces.value, project.spaces)
  const items = [
    {
      id: 'vibe',
      label: 'Vibe',
      icon: 'i-lucide-zap',
      route: `/app/projects/${projectId()}/vibe`,
    },
    ...projectSpaces.map(s => ({
      id: s.name,
      label: s.displayName || s.name,
      icon: getSpaceConfig(s.name).icon || s.icon || 'i-lucide-circle',
      route: `/app/projects/${projectId()}/${s.name}`,
    })),
  ]

  enterProject(
    { id: String(project.id), name: project.name },
    items,
    '/app/projects'
  )

  // Sync project context with operator so assistant knows which project is active
  const projectPath = project.path || project.local_path || ''
  setProject({
    name: project.name,
    type: 'local',
    rootPath: projectPath,
    framework: 'unknown',
  }).catch(() => { /* operator may not be ready yet */ })

  // Auto-install missing spaces
  const installedSpaceIds = new Set(spaces.value.map(s => s.name))
  const missingIds = (project.spaces || []).filter(id => !installedSpaceIds.has(id))
  if (missingIds.length > 0) {
    await installMissing(missingIds)
    await loadSpaces()
  }
}

onMounted(() => {
  resolveAndOpenProject()
})

watch(
  () => route.params.projectId,
  () => { resolveAndOpenProject() },
)

onUnmounted(() => {
  // Clear project context from operator when leaving project routes
  clearProject().catch(() => {})
})
</script>

<template>
  <RouterView />
</template>
