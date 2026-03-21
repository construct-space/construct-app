<script setup lang="ts">
/**
 * ProjectsPage - Local project management
 * Thin orchestrator — delegates UI to components.
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useProjectStore } from '@/stores/project'
import type { LocalProject } from '@/types/project'
import { usePinnedStore, createProjectPin } from '@/stores/pinned'
import { useToolbar } from '@/composables/useToolbar'
import { getProjectRouteKey } from '@/utils/projectRoutes'
import ProjectCard from '../components/ProjectCard.vue'
import ProjectCreateModal from '../components/ProjectCreateModal.vue'
import ProjectEditModal from '../components/ProjectEditModal.vue'
import ProjectRemoveModal from '../components/ProjectRemoveModal.vue'
import ProjectDeployModal from '../components/ProjectDeployModal.vue'
import { useBasepodDeploy, type DeployedApp } from '@/composables/useBasepodDeploy'
import { useAuthStore } from '@/stores/auth'
import { useAutomationProvider } from '../composables/useAutomationProvider'

// Register automation provider for operator bridge
useAutomationProvider()

const router = useRouter()
const projectStore = useProjectStore()
const pinnedStore = usePinnedStore()
const authStore = useAuthStore()
const { listApps, loadDeployInfo, generateAppName } = useBasepodDeploy()
const { setPageItems, setSearch, clearToolbar } = useToolbar()

const searchQuery = ref('')
const showCreateModal = ref(false)
const creating = ref(false)
const initialized = ref(false)

// Edit / remove / deploy state
const editingProject = ref<LocalProject | null>(null)
const confirmRemove = ref<LocalProject | null>(null)
const deployProject = ref<LocalProject | null>(null)

// Deployed apps tracking
const deployedApps = ref<Map<string, DeployedApp>>(new Map())

function isProjectDeployed(project: LocalProject): boolean {
  return deployedApps.value.has(generateAppName(project.name))
}

function getDeployedUrl(project: LocalProject): string | null {
  const app = deployedApps.value.get(generateAppName(project.name))
  return app ? `https://${app.domain}` : null
}

async function fetchDeployedApps() {
  const map = new Map<string, DeployedApp>()

  // Check local .construct/deploy.json for each project (instant, no network)
  for (const project of projectStore.projects) {
    const info = await loadDeployInfo(project.path)
    if (info) {
      map.set(info.name, { id: '', name: info.name, domain: info.domain, status: 'running', owner_id: '', created_at: info.deployed_at, updated_at: info.deployed_at })
    }
  }

  // Also fetch from API if logged in (gets real status)
  if (authStore.isAuthenticated) {
    try {
      const apps = await listApps()
      for (const app of apps) map.set(app.name, app)
    } catch { /* not critical */ }
  }

  deployedApps.value = map
}

// Computed
const filteredProjects = computed(() => {
  const q = searchQuery.value.toLowerCase()
  if (!q) return projectStore.projects
  return projectStore.projects.filter(p =>
    p.name.toLowerCase().includes(q) ||
    p.description?.toLowerCase().includes(q)
  )
})

const sortedProjects = computed(() => {
  return [...filteredProjects.value].sort((a, b) => {
    const aTime = a.last_opened_at ? new Date(a.last_opened_at).getTime() : 0
    const bTime = b.last_opened_at ? new Date(b.last_opened_at).getTime() : 0
    return bTime - aTime
  })
})

const needsSetup = computed(() => initialized.value && !projectStore.projectsRoot)

// Actions
function openProject(project: LocalProject) {
  projectStore.trackRecentOpen(project)
  router.push(`/app/projects/${encodeURIComponent(getProjectRouteKey(project))}`)
}

function isProjectPinned(project: LocalProject): boolean {
  return pinnedStore.isPinned(`project-${getProjectRouteKey(project)}`)
}

function togglePin(project: LocalProject) {
  const routeKey = getProjectRouteKey(project)
  const pinId = `project-${routeKey}`
  if (pinnedStore.isPinned(pinId)) {
    pinnedStore.removePin(pinId)
  } else {
    pinnedStore.addPin(createProjectPin({ id: routeKey, name: project.name, description: project.description }))
  }
}

async function handleCreate(name: string, description?: string) {
  creating.value = true
  try {
    const result = await projectStore.createProject({ name, description })
    if (result.success && result.data) {
      showCreateModal.value = false
      openProject(result.data)
    }
  } finally {
    creating.value = false
  }
}

async function handleEdit(name: string, description?: string) {
  if (!editingProject.value) return
  await projectStore.updateProjectConfig(editingProject.value.path, { name, description })
  editingProject.value = null
}

function handleRemove(deleteFromDisk: boolean) {
  if (!confirmRemove.value) return
  if (deleteFromDisk) {
    projectStore.deleteProjectFromDisk(confirmRemove.value.path)
  } else {
    projectStore.removeProject(confirmRemove.value.path)
  }
  confirmRemove.value = null
}

// Init
async function initializeProjects() {
  if (!projectStore.projectsRoot) {
    const { useProjectDirectory } = await import('@/composables/useProjectDirectory')
    const projectDir = useProjectDirectory()
    const savedRoot = localStorage.getItem('construct_projects_root')
    if (savedRoot) {
      const tauriFs = await import('@tauri-apps/plugin-fs')
      if (await tauriFs.exists(savedRoot)) {
        projectStore.setProjectsRoot(savedRoot)
        await projectDir.setProjectsRoot(savedRoot)
      }
    }
  }
  if (projectStore.projectsRoot) {
    await projectStore.loadProjects()
  }
  initialized.value = true
}

async function chooseProjectsRoot() {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const { homeDir } = await import('@tauri-apps/api/path')
  const home = await homeDir()
  const selected = await open({ directory: true, multiple: false, defaultPath: home, title: 'Choose Projects Folder' })
  if (selected && typeof selected === 'string') {
    const { useProjectDirectory } = await import('@/composables/useProjectDirectory')
    const projectDir = useProjectDirectory()
    await projectDir.setProjectsRoot(selected)
    projectStore.setProjectsRoot(selected)
    await projectStore.loadProjects()
  }
}

async function handleAddFolder() {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const selected = await open({ directory: true, multiple: false, title: 'Open Project Folder' })
  if (selected && typeof selected === 'string') {
    const project = await projectStore.addExternalFolderByPath(selected)
    if (project) openProject(project)
  }
}

onMounted(async () => {
  setPageItems([])
  setSearch('Search projects...', (query: string) => { searchQuery.value = query })
  await initializeProjects()
  fetchDeployedApps()
})

onUnmounted(() => {
  clearToolbar()
})
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden relative">
    <!-- Loading -->
    <div v-if="!initialized" class="flex-1 flex items-center justify-center">
      <div class="flex items-center gap-3 text-[var(--app-muted)]">
        <i class="i-lucide-loader-2 size-5 animate-spin" />
        <span class="text-sm">Loading projects...</span>
      </div>
    </div>

    <!-- Setup needed -->
    <div v-else-if="needsSetup" class="flex-1 flex items-center justify-center">
      <div class="text-center max-w-sm">
        <div class="size-16 rounded-2xl bg-[var(--app-muted)]/10 flex items-center justify-center mx-auto mb-4">
          <i class="i-lucide-folder-root size-8 text-[var(--app-muted)]" />
        </div>
        <h2 class="text-lg font-semibold text-[var(--app-foreground)] mb-2">Welcome to Projects</h2>
        <p class="text-sm text-[var(--app-muted)] mb-6">Choose where your projects live on disk.</p>
        <button
          class="px-5 py-2.5 rounded-lg bg-[var(--app-accent)] text-white text-sm font-medium hover:opacity-90 transition-opacity"
          @click="chooseProjectsRoot"
        >
          Choose Projects Folder
        </button>
      </div>
    </div>

    <!-- Scanning -->
    <div v-else-if="projectStore.loading" class="flex-1 flex items-center justify-center">
      <div class="flex items-center gap-3 text-[var(--app-muted)]">
        <i class="i-lucide-loader-2 size-5 animate-spin" />
        <span class="text-sm">Scanning projects...</span>
      </div>
    </div>

    <!-- Projects content -->
    <div v-else class="flex-1 overflow-y-auto">
      <div class="max-w-4xl mx-auto min-h-full p-6 flex flex-col">
        <!-- Actions -->
        <div class="flex items-center justify-center gap-3 mb-6">
          <div class="inline-flex rounded-full bg-[color-mix(in_srgb,var(--app-foreground)_8%,transparent)] p-1">
            <button class="rounded-full px-4 py-2 text-sm font-medium text-app-foreground transition hover:bg-[color-mix(in_srgb,var(--app-foreground)_10%,transparent)]" @click="showCreateModal = true">
              <Icon name="i-lucide-plus" class="size-4 inline mr-1.5 -mt-0.5" />Add new Project
            </button>
            <button class="rounded-full px-4 py-2 text-sm font-medium text-app-muted transition hover:bg-[color-mix(in_srgb,var(--app-foreground)_10%,transparent)] hover:text-app-foreground" @click="handleAddFolder">
              <Icon name="i-lucide-folder-open" class="size-4 inline mr-1.5 -mt-0.5" />Open project
            </button>
          </div>
          <div class="inline-flex rounded-full bg-[color-mix(in_srgb,var(--app-foreground)_8%,transparent)] p-1">
            <button class="rounded-full px-4 py-2 text-sm font-medium text-app-muted transition hover:bg-red-500/15 hover:text-red-400" @click="$router.push('/app/architect')">
              <Icon name="i-lucide-pill" class="size-4 inline mr-1.5 -mt-0.5" />Plan a project
            </button>
            <button class="rounded-full px-4 py-2 text-sm font-medium text-app-muted transition hover:bg-[#00cc34]/15 hover:text-[#00ff41]" @click="$router.push('/app/vibe')">
              <Icon name="i-lucide-zap" class="size-4 inline mr-1.5 -mt-0.5" />Vibe a project
            </button>
          </div>
        </div>
        <div v-if="sortedProjects.length === 0 && !searchQuery" class="flex-1 flex items-center justify-center">
          <div class="text-center max-w-sm">
            <div class="size-16 rounded-2xl bg-[var(--app-muted)]/10 flex items-center justify-center mx-auto mb-4">
              <i class="i-lucide-package size-8 text-[var(--app-muted)]" />
            </div>
            <h2 class="text-lg font-semibold text-[var(--app-foreground)] mb-2">No projects yet</h2>
            <p class="text-sm text-[var(--app-muted)] mb-6">Create your first project or open an existing folder.</p>
            <div class="flex gap-3 justify-center">
              <button class="px-4 py-2 rounded-lg bg-[var(--app-accent)] text-white text-sm font-medium hover:opacity-90 transition-opacity" @click="showCreateModal = true">
                <i class="i-lucide-plus mr-1.5" /> New Project
              </button>
              <button class="px-4 py-2 rounded-lg border border-[var(--app-border)] text-sm text-[var(--app-foreground)] hover:bg-[var(--app-muted)]/5 transition-colors" @click="handleAddFolder">
                <i class="i-lucide-folder-open mr-1.5" /> Open Folder
              </button>
            </div>
          </div>
        </div>
        <div v-else-if="sortedProjects.length === 0 && searchQuery" class="text-center py-16">
          <p class="text-sm text-[var(--app-muted)]">No projects matching "{{ searchQuery }}"</p>
        </div>
        <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <ProjectCard
            v-for="project in sortedProjects"
            :key="project.path"
            :project="project"
            :pinned="isProjectPinned(project)"
            :deployed="isProjectDeployed(project)"
            :deployed-url="getDeployedUrl(project)"
            @open="openProject"
            @remove="confirmRemove = $event"
            @edit="editingProject = $event"
            @deploy="deployProject = $event"
            @toggle-pin="togglePin"
          />
        </div>
      </div>
    </div>

    <!-- Modals -->
    <ProjectCreateModal v-model:open="showCreateModal" @create="handleCreate" />
    <ProjectEditModal :project="editingProject" @close="editingProject = null" @save="handleEdit" />
    <ProjectRemoveModal :project="confirmRemove" @close="confirmRemove = null" @remove="handleRemove" />
    <ProjectDeployModal :project="deployProject" @close="deployProject = null; fetchDeployedApps()" />
  </div>
</template>
