<script setup lang="ts">
import ToolbarSlot from '@/components/common/ToolbarSlot.vue'
/**
 * ProjectsPage - Local project management
 * Thin orchestrator — delegates UI to components.
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { Plus, FolderOpen, Zap, Boxes, TerminalSquare, FolderKanban, Search, Loader2, FolderRoot } from 'lucide-vue-next'
import { Button, Card, Empty, Input } from '@construct-space/ui'
import { useRouter } from 'vue-router'
import { useProjectStore } from '@/stores/project'
import type { LocalProject } from '@/types/project'
import { usePinnedStore, createProjectPin } from '@/stores/pinned'
import { profileStorage } from '@/lib/profileStorage'
import { useToolbar } from '@/composables/useToolbar'
import { getProjectRouteKey } from '@/utils/projectRoutes'
import ProjectCard from '../components/ProjectCard.vue'
import ProjectCreateModal from '../components/ProjectCreateModal.vue'
import ProjectEditModal from '../components/ProjectEditModal.vue'
import ProjectRemoveModal from '../components/ProjectRemoveModal.vue'
import ProjectDeployModal from '../components/ProjectDeployModal.vue'
import { useBasepodDeploy, type DeployedApp } from '@/composables/useBasepodDeploy'
import { useAuthStore } from '@/stores/auth'
import { useOrgStore } from '@/stores/org'
import OrgProjectsPage from '@/spaces/org-project/pages/OrgProjectsPage.vue'

// Suppress the in-page quick-action cards when the Developer Portal
// wraps this page (the portal renders its own, larger explainer cards
// above). Header card stays — the path/Change UI is still useful.
const props = defineProps<{ hideQuickActions?: boolean; hideHeader?: boolean }>()

const router = useRouter()
const projectStore = useProjectStore()
const pinnedStore = usePinnedStore()
const authStore = useAuthStore()
const orgStore = useOrgStore()
const { listApps, loadDeployInfo, generateAppName } = useBasepodDeploy()
const { setPageItems, setSearch, clearToolbar } = useToolbar()

const isOrgUser = computed(() => orgStore.isEnabled)

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

async function handleCreate(name: string, description?: string, kind?: 'project' | 'space-project') {
  creating.value = true
  try {
    const result = await projectStore.createProject({ name, description, kind })
    if (result.success && result.data) {
      showCreateModal.value = false
      openProject(result.data)
    }
  } finally {
    creating.value = false
  }
}

async function handleEdit(name: string, description?: string, color?: string) {
  if (!editingProject.value) return
  await projectStore.updateProjectConfig(editingProject.value.path, { name, description, color })
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
    const savedRoot = profileStorage.getItem('construct_projects_root')
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
    <!-- Org user: show org projects -->
    <OrgProjectsPage v-if="isOrgUser" />

    <!-- Loading -->
    <div v-else-if="!initialized" class="flex-1 flex items-center justify-center">
      <Loader2 class="size-5 animate-spin text-[var(--app-muted)]" />
    </div>

    <!-- Setup needed -->
    <div v-else-if="needsSetup" class="flex-1 overflow-y-auto">
      <div class="max-w-3xl mx-auto px-6 py-6 space-y-4">
        <Card variant="muted">
          <template #header>
            <div class="flex items-start gap-3">
              <FolderRoot class="size-5 text-[var(--app-muted)] mt-0.5 shrink-0" />
              <div class="min-w-0 flex-1">
                <h3 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Projects</h3>
                <p class="text-sm text-[var(--app-muted)] mt-0.5">Choose where your projects live on disk to get started.</p>
              </div>
            </div>
          </template>
        </Card>
        <Card>
          <Empty
            icon="i-lucide-folder-root"
            title="Welcome to Projects"
            description="Pick a folder on disk to house your projects."
          >
            <Button size="sm" label="Choose projects folder" @click="chooseProjectsRoot" />
          </Empty>
        </Card>
      </div>
    </div>

    <!-- Scanning -->
    <div v-else-if="projectStore.loading" class="flex-1 flex items-center justify-center">
      <Loader2 class="size-5 animate-spin text-[var(--app-muted)]" />
    </div>

    <!-- Projects content -->
    <div v-else class="flex-1 overflow-y-auto">
      <div class="max-w-5xl mx-auto px-6 py-6 space-y-4">
        <!-- Intro (merged with projects-directory path) -->
        <Card v-if="!props.hideHeader" variant="muted">
          <template #header>
            <div class="flex items-start gap-3">
              <FolderKanban class="size-5 text-[var(--app-muted)] mt-0.5 shrink-0" />
              <div class="min-w-0 flex-1">
                <div class="flex items-baseline gap-2 flex-wrap">
                  <h3 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Projects</h3>
                  <span class="text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)]">
                    <strong class="text-[var(--app-foreground)]">{{ projectStore.projects.length }}</strong> total
                  </span>
                </div>
                <div v-if="projectStore.projectsRoot" class="mt-1 flex items-center gap-2 flex-wrap min-w-0">
                  <span class="text-sm font-mono text-[var(--app-muted)] truncate">{{ projectStore.projectsRoot }}</span>
                  <button
                    class="text-[10px] tracking-[0.08em] uppercase text-[var(--app-accent)] hover:underline shrink-0"
                    @click="chooseProjectsRoot"
                  >
                    Change
                  </button>
                </div>
                <p v-else class="text-sm text-[var(--app-muted)] mt-0.5">Local projects stored on your disk.</p>
              </div>
            </div>
          </template>
        </Card>

        <!-- Shortcuts -->
        <div v-if="!props.hideQuickActions">
          <h4 class="text-[11px] tracking-[0.12em] uppercase font-medium text-[var(--app-muted)] mb-2">Quick actions</h4>
          <div class="grid gap-3 grid-cols-2 lg:grid-cols-3">
            <Card interactive @click="$router.push('/app/builder')">
              <template #header>
                <div class="flex items-start gap-3">
                  <Zap class="size-5 text-emerald-400 mt-0.5 shrink-0" />
                  <div class="min-w-0 flex-1">
                    <h4 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Let's build</h4>
                    <p class="text-xs text-[var(--app-muted)] mt-1">Builder plans, writes, and verifies whatever you describe.</p>
                  </div>
                </div>
              </template>
            </Card>
            <Card interactive @click="$router.push('/app/space-developer')">
              <template #header>
                <div class="flex items-start gap-3">
                  <Boxes class="size-5 text-violet-400 mt-0.5 shrink-0" />
                  <div class="min-w-0 flex-1">
                    <h4 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Space developer</h4>
                    <p class="text-xs text-[var(--app-muted)] mt-1">Scaffold and verify a Construct Space inside Space Runner.</p>
                  </div>
                </div>
              </template>
            </Card>
          </div>
        </div>

        <!-- Search -->
        <div class="relative max-w-xs">
          <Search class="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--app-muted)] z-10" />
          <Input
            v-model="searchQuery"
            placeholder="Search projects..."
            size="sm"
            class="pl-8"
          />
        </div>

        <!-- Empty (no projects) -->
        <Card v-if="sortedProjects.length === 0 && !searchQuery">
          <Empty
            icon="i-lucide-folder-kanban"
            title="Start a project"
            description="Create a new project, open an existing folder, or spin up a Construct Space."
          >
            <div class="flex items-center gap-2 flex-wrap justify-center">
              <Button size="sm" label="New project" @click="showCreateModal = true">
                <template #leading>
                  <Plus class="size-3.5" />
                </template>
              </Button>
              <Button variant="ghost" size="sm" label="Open folder" @click="handleAddFolder">
                <template #leading>
                  <FolderOpen class="size-3.5" />
                </template>
              </Button>
            </div>
          </Empty>
        </Card>

        <!-- Empty (search) -->
        <Card v-else-if="sortedProjects.length === 0 && searchQuery">
          <Empty
            icon="i-lucide-search"
            title="No matches"
            :description="`No projects match your search.`"
          />
        </Card>

        <!-- Project grid -->
        <div
          v-else
          class="grid gap-4 grid-cols-2 md:grid-cols-3"
        >
          <ProjectCard v-for="project in sortedProjects" :key="project.path" :project="project"
            :pinned="isProjectPinned(project)" :deployed="isProjectDeployed(project)"
            :deployed-url="getDeployedUrl(project)" @open="openProject" @remove="confirmRemove = $event"
            @edit="editingProject = $event" @deploy="deployProject = $event" @toggle-pin="togglePin" />
        </div>
      </div>
    </div>

    <!-- Modals -->
    <ProjectCreateModal v-model:open="showCreateModal" @create="handleCreate" />
    <ProjectEditModal :project="editingProject" @close="editingProject = null" @save="handleEdit" />
    <ProjectRemoveModal :project="confirmRemove" @close="confirmRemove = null" @remove="handleRemove" />
    <ProjectDeployModal :project="deployProject" @close="deployProject = null; fetchDeployedApps()" />

    <!-- Toolbar actions (right side) -->
    <ToolbarSlot name="right">
      <div class="flex items-center gap-1.5">
        <Button size="xs" label="New project" @click="showCreateModal = true">
          <template #leading>
            <Plus class="size-3.5" />
          </template>
        </Button>
        <Button variant="ghost" size="xs" label="Open folder" @click="handleAddFolder">
          <template #leading>
            <FolderOpen class="size-3.5" />
          </template>
        </Button>
        <button
          class="rounded-md p-1 text-[var(--app-muted)] hover:text-cyan-400 transition cursor-pointer"
          title="TUI"
          @click="router.push('/app/tui')"
        >
          <TerminalSquare class="size-3.5" />
        </button>
      </div>
    </ToolbarSlot>
  </div>
</template>
