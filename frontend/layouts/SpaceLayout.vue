<script setup lang="ts">
/**
 * SpaceLayout — Wraps dynamic space pages.
 *
 * For project-scoped spaces: ProjectLayout has already resolved the project
 * and set currentProject. SpaceLayout just renders the space.
 *
 * For company-scoped spaces: No project context needed.
 *
 * Backward compat: handles ?project= query param.
 */
import { useRoute } from 'vue-router'
import { useProjectStore } from '@/stores/project'
import { watch, onMounted } from 'vue'

const route = useRoute()
const projectStore = useProjectStore()

async function handleQueryProject() {
  // Backward compat: ?project= query param
  const projectPath = route.query.project
  if (typeof projectPath === 'string' && projectPath) {
    if (!projectStore.currentProject || projectStore.currentProject.path !== projectPath) {
      projectStore.openProject(projectPath)
    }
  }
}

onMounted(() => {
  handleQueryProject()
})

watch(
  () => route.query.project,
  () => { handleQueryProject() },
)
</script>

<template>
  <RouterView />
</template>
