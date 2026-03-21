<script setup lang="ts">
/**
 * ProjectsSettings — Manage projects root dir, external dirs, scan button
 */
import { ref, onMounted } from 'vue'
import { useProjectStore } from '@/stores/project'
import { FolderOpen, RefreshCw, Plus } from 'lucide-vue-next'

const projectStore = useProjectStore()
const scanning = ref(false)

const changeProjectsRoot = async () => {
  try {
    const { useProjectDirectory } = await import('@/composables/useProjectDirectory')
    const projectDir = useProjectDirectory()
    const path = await projectDir.openFolderDialog('Select Projects Root Directory')
    if (path) {
      projectStore.setProjectsRoot(path)
      await rescan()
    }
  } catch (error) {
    console.warn('Failed to change projects root:', error)
  }
}

const rescan = async () => {
  scanning.value = true
  try {
    await projectStore.loadProjects()
  } finally {
    scanning.value = false
  }
}

const addExternal = async () => {
  try {
    const { useProjectDirectory } = await import('@/composables/useProjectDirectory')
    const projectDir = useProjectDirectory()
    const path = await projectDir.openFolderDialog('Add External Project')
    if (path) {
      await projectStore.addExternalFolderByPath(path)
    }
  } catch (error) {
    console.warn('Failed to add external project:', error)
  }
}

onMounted(() => {
  // Refresh projects list
  if (projectStore.projectsRoot) {
    rescan()
  }
})
</script>

<template>
  <div class="space-y-8">
    <div>
      <h2 class="text-lg font-semibold text-app mb-1">Projects</h2>
      <p class="text-sm text-app-muted">Manage project directories and scanning</p>
    </div>

    <!-- Projects Root -->
    <div class="space-y-3">
      <p class="text-xs font-semibold tracking-widest text-app-muted uppercase">Projects Directory</p>
      <div class="flex items-center gap-3">
        <div class="flex-1 px-3 py-2 rounded-lg border border-app bg-transparent text-sm text-app font-mono truncate">
          {{ projectStore.projectsRoot || 'Not configured' }}
        </div>
        <button
          class="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm border border-app text-app hover:bg-white/5 transition-colors"
          @click="changeProjectsRoot"
        >
          <FolderOpen class="size-3.5" />
          Change
        </button>
        <button
          class="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm border border-app text-app hover:bg-white/5 transition-colors"
          :disabled="scanning"
          @click="rescan"
        >
          <RefreshCw class="size-3.5" :class="{ 'animate-spin': scanning }" />
          Scan
        </button>
      </div>
    </div>

    <!-- External Projects -->
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <p class="text-xs font-semibold tracking-widest text-app-muted uppercase">External Projects</p>
        <button
          class="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-app-muted hover:text-app transition-colors"
          @click="addExternal"
        >
          <Plus class="size-3" />
          Add
        </button>
      </div>

      <div v-if="projectStore.externalPaths.length === 0" class="text-sm text-app-muted py-4">
        No external project directories added
      </div>

      <div v-else class="space-y-1">
        <div
          v-for="path in projectStore.externalPaths"
          :key="path"
          class="flex items-center justify-between px-3 py-2 rounded-lg border border-app"
        >
          <span class="text-sm text-app font-mono truncate">{{ path }}</span>
        </div>
      </div>
    </div>

    <!-- All Projects -->
    <div class="space-y-3">
      <p class="text-xs font-semibold tracking-widest text-app-muted uppercase">
        All Projects ({{ projectStore.projects.length }})
      </p>
      <div class="space-y-1 max-h-60 overflow-y-auto">
        <div
          v-for="project in projectStore.projects"
          :key="project.path"
          class="flex items-center justify-between px-3 py-2 rounded-lg border border-app"
        >
          <div>
            <p class="text-sm font-medium text-app">{{ project.name }}</p>
            <p class="text-[10px] text-app-muted font-mono truncate">{{ project.path }}</p>
          </div>
          <span v-if="project.is_external" class="text-[10px] text-app-muted px-1.5 py-0.5 rounded border border-app">
            External
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
