<script setup lang="ts">
/**
 * AssistantPage — Full-page AI assistant for popout Tauri windows.
 *
 * Frameless window (decorations: false). Traffic lights + drag region
 * are handled inside AssistantPanel when standalone=true.
 *
 * Context (project, space) received via BroadcastChannel from main window.
 */
import { ref, onMounted, onUnmounted } from 'vue'
import { useProjectStore } from '@/stores/project'
import AssistantPanel from '@/components/ai/AssistantPanel.vue'

const projectStore = useProjectStore()
const ready = ref(false)

const NAMES = ['Tank', 'Dozer', 'Switch', 'Link', 'Apoc', 'Niobe', 'Ghost', 'Sparks']
const windowTitle = `Operator ${NAMES[Math.floor(Math.random() * NAMES.length)]}`

// BroadcastChannel for cross-window communication
const channel = new BroadcastChannel('construct-assistant')

async function applyContext(data: { project?: { id: string; name: string; path: string } | null; space?: string | null }) {
  if (data.project?.path) {
    const currentPath = projectStore.currentProject?.path
    if (currentPath !== data.project.path) {
      if (projectStore.projects.length === 0) {
        await projectStore.loadProjects()
      }
      projectStore.openProject(data.project.path)
    }
  } else if ('project' in data) {
    projectStore.clearCurrentProject()
  }

  ready.value = true
}

channel.onmessage = (event) => {
  if (event.data?.type === 'assistant-context') {
    void applyContext(event.data)
  }
}

onMounted(() => {
  projectStore.clearCurrentProject()
  setTimeout(() => { if (!ready.value) ready.value = true }, 2000)
})

onUnmounted(() => {
  channel.postMessage({ type: 'assistant-closed' })
  channel.close()
})
</script>

<template>
  <div class="h-screen w-screen overflow-hidden bg-app">
    <AssistantPanel v-if="ready" :docked="true" :standalone="true" :window-title="windowTitle" />
  </div>
</template>
