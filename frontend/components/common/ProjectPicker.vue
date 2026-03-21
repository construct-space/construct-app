<script setup lang="ts">
/**
 * ProjectPicker — Reusable component shown when no project is selected in a space.
 *
 * Shows projectStore.projects with search/filter.
 * "New Project" + "Open Folder" buttons.
 * Click emits @select(project) → parent navigates with ?project=<path>
 */
import { ref, computed, onMounted } from 'vue'
import { useProjectStore } from '@/stores/project'
import { FolderPlus, FolderOpen, Search } from 'lucide-vue-next'
import type { LocalProject } from '@/types/project'

const emit = defineEmits<{
  select: [project: LocalProject]
}>()

const projectStore = useProjectStore()
const searchQuery = ref('')

const filteredProjects = computed(() => {
  const q = searchQuery.value.toLowerCase().trim()
  if (!q) return projectStore.projects
  return projectStore.projects.filter(p =>
    p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)
  )
})

const truncatePath = (path: string) => {
  if (path.length <= 50) return path
  const parts = path.split('/')
  if (parts.length <= 3) return path
  return `~/${parts.slice(-2).join('/')}`
}

const selectProject = (project: LocalProject) => {
  emit('select', project)
}

const newProject = async () => {
  // Create via project store — simple prompt
  const name = prompt('Project name:')
  if (!name) return

  const result = await projectStore.createProject({ name })
  if (result.success && result.data) {
    emit('select', result.data)
  }
}

const openFolder = async () => {
  try {
    const { useProjectDirectory } = await import('@/composables/useProjectDirectory')
    const projectDir = useProjectDirectory()
    const path = await projectDir.openFolderDialog('Open Project Folder')
    if (path) {
      await projectStore.addExternalFolderByPath(path)
      const project = projectStore.projects.find(p => p.path === path)
      if (project) {
        emit('select', project)
      }
    }
  } catch (error) {
    console.warn('Failed to open folder:', error)
  }
}

onMounted(async () => {
  if (projectStore.projects.length === 0 && projectStore.projectsRoot) {
    await projectStore.loadProjects()
  }
})
</script>

<template>
  <div class="h-full flex items-center justify-center px-6">
    <div class="w-full max-w-lg">
      <h2 class="text-xl font-semibold text-app mb-1">Select a Project</h2>
      <p class="text-sm text-app-muted mb-6">Choose a project to work in this space, or create a new one.</p>

      <!-- Actions -->
      <div class="flex gap-2 mb-4">
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-app-accent text-app-accent-foreground hover:opacity-90 transition-opacity"
          @click="newProject"
        >
          <FolderPlus class="size-3.5" />
          New Project
        </button>
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium border border-app text-app hover:bg-white/5 transition-colors"
          @click="openFolder"
        >
          <FolderOpen class="size-3.5" />
          Open Folder
        </button>
      </div>

      <!-- Search -->
      <div class="relative mb-4">
        <Search class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-app-muted" />
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Search projects..."
          class="w-full pl-9 pr-3 py-2 rounded-lg border border-app bg-transparent text-sm text-app placeholder:text-app-muted focus:outline-none focus:border-app-accent/50"
        />
      </div>

      <!-- Projects list -->
      <div class="max-h-80 overflow-y-auto space-y-1">
        <button
          v-for="project in filteredProjects"
          :key="project.path"
          class="w-full text-left p-3 rounded-lg border border-transparent hover:border-app-accent/30 hover:bg-[color-mix(in_srgb,var(--app-accent)_3%,transparent)] transition-all"
          @click="selectProject(project)"
        >
          <p class="text-sm font-medium text-app">{{ project.name }}</p>
          <p class="text-[10px] text-app-muted truncate mt-0.5">{{ truncatePath(project.path) }}</p>
        </button>

        <p v-if="filteredProjects.length === 0" class="text-sm text-app-muted text-center py-6">
          {{ searchQuery ? 'No matching projects' : 'No projects yet' }}
        </p>
      </div>
    </div>
  </div>
</template>
