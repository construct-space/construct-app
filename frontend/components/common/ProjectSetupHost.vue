<script setup lang="ts">
/**
 * App-level host for the New Project modal when triggered by the bridge
 * (project.create_modal). Kept separate from ProjectsPage's in-page modal
 * so the bridge can open it even when the user isn't on that page.
 *
 * Mount once in App.vue. Watches activeProjectSetupRequest; when non-null,
 * the modal opens prefilled. Create → calls the existing project store +
 * resolves the promise with the new project's path.
 */

import { computed, watch, ref } from 'vue'
import ProjectCreateModal from '@/spaces/project/components/ProjectCreateModal.vue'
import {
  activeProjectSetupRequest,
  resolveProjectSetup,
  cancelProjectSetup,
} from '@/lib/projectSetupHost'
import { useProjectStore } from '@/stores/project'

const projectStore = useProjectStore()
const open = computed({
  get: () => activeProjectSetupRequest.value !== null,
  set: (v) => {
    if (!v) cancelProjectSetup()
  },
})

// Prefill values are read once when a request arrives and passed to the
// modal via v-model-like props. We don't try to update them mid-flight —
// the modal's internal state owns the form from that point on.
const prefillName = ref('')
const prefillDescription = ref('')

watch(activeProjectSetupRequest, (req) => {
  if (!req) return

  // Short-circuit: if a project matching the suggested name already
  // exists in the store, just activate it and resolve. No modal. This
  // covers the "user already created this project manually, then started
  // architect" path — otherwise the modal would prompt to re-create and
  // the collision would cancel the flow.
  const existing = projectStore.projects.find(
    (p) => p.name.toLowerCase() === req.suggestedName.toLowerCase(),
  )
  if (existing?.path && existing?.name) {
    projectStore.openProject(existing.path)
    resolveProjectSetup({ path: existing.path, name: existing.name })
    return
  }

  prefillName.value = req.suggestedName
  prefillDescription.value = req.suggestedDescription
}, { immediate: true })

async function onCreate(name: string, description?: string) {
  // Delegate to the project store — same entry point ProjectsPage uses
  // when the user clicks Create there. Keeps creation logic in one place.
  const result = await projectStore.createProject({ name, description })
  if (result.success && result.data?.path && result.data?.name) {
    // Mark the new project as the active one so the next agent turn
    // sees it in ProjectContext. Without this, architect's system prompt
    // would still show "no active project" and it would re-trigger the
    // setup modal in a loop.
    projectStore.openProject(result.data.path)
    resolveProjectSetup({ path: result.data.path, name: result.data.name })
  } else {
    // Store failed (e.g. name collision) — treat as cancel so the
    // operator-side tool call doesn't hang on a success that didn't
    // happen. User sees the store's error via its own toast system.
    cancelProjectSetup()
  }
}
</script>

<template>
  <ProjectCreateModal
    :open="open"
    :initial-name="prefillName"
    :initial-description="prefillDescription"
    @update:open="open = $event"
    @create="onCreate"
  />
</template>
