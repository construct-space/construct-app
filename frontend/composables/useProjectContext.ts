/**
 * useProjectContext — reads ?project= query param and provides project context
 *
 * Used by space index pages to decide: show ProjectPicker or space content.
 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useProjectStore } from '@/stores/project'

export function useProjectContext() {
  const route = useRoute()
  const projectStore = useProjectStore()

  const projectPath = computed(() => {
    const p = route.query.project
    return typeof p === 'string' ? p : null
  })

  const hasProject = computed(() => !!projectPath.value)

  const currentProject = computed(() => {
    if (!projectPath.value) return null
    return projectStore.projects.find(p => p.path === projectPath.value) || projectStore.currentProject
  })

  return {
    projectPath,
    hasProject,
    currentProject,
  }
}
