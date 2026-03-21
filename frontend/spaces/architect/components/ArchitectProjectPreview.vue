<script setup lang="ts">
/**
 * ArchitectProjectPreview - Live preview of project being built
 * Shows the evolving project specification as user makes choices
 */
import { INTERVIEW_PHASES, getLabelForValue } from '../data/architect-knowledge'

const props = defineProps<{
  appDescription: string
  answers: Record<string, string | string[]>
  plan: Record<string, unknown> | null
  isComplete: boolean
}>()

const emit = defineEmits<{
  (e: 'editPhase', phaseId: string): void
  (e: 'createProject'): void
}>()

// Get display value for an answer
function getAnswerDisplay(phaseId: string): string | null {
  const val = props.answers[phaseId]
  if (!val) return null

  if (Array.isArray(val)) {
    return val.map(v => getLabelForValue(phaseId, v)).join(', ')
  }
  return getLabelForValue(phaseId, val)
}

// Get phase info
function _getPhase(phaseId: string) {
  return INTERVIEW_PHASES.find(p => p.id === phaseId)
}

// Completed phases
const completedPhases = computed(() => {
  return INTERVIEW_PHASES.filter(phase => {
    const val = props.answers[phase.id]
    return val && (Array.isArray(val) ? val.length > 0 : true)
  })
})
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- Header -->
    <div class="p-6 border-b border-gray-200 dark:border-gray-800">
      <div class="flex items-center gap-3 mb-2">
        <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
          <Icon name="i-lucide-sparkles" class="size-5 text-white" />
        </div>
        <div>
          <h2 class="font-semibold text-app">Your Project</h2>
          <p class="text-xs text-app-muted">Building something amazing</p>
        </div>
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto p-6">
      <!-- App Description -->
      <div v-if="appDescription" class="mb-6">
        <p class="text-sm text-app-muted mb-1 uppercase tracking-wider font-medium">Idea</p>
        <p class="text-app">{{ appDescription }}</p>
      </div>

      <!-- Empty State -->
      <div v-if="completedPhases.length === 0 && !appDescription" class="text-center py-12">
        <div class="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mx-auto mb-4">
          <Icon name="i-lucide-lightbulb" class="size-8 text-app-muted" />
        </div>
        <p class="text-app-muted">Start by describing what you want to build</p>
      </div>

      <!-- Decisions Made -->
      <div v-if="completedPhases.length > 0" class="space-y-4">
        <p class="text-sm text-app-muted uppercase tracking-wider font-medium">Tech Stack</p>

        <div class="grid gap-3">
          <button
            v-for="phase in completedPhases"
            :key="phase.id"
            class="group flex items-center gap-3 p-3 rounded-xl bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-left"
            @click="emit('editPhase', phase.id)"
          >
            <div class="w-8 h-8 rounded-lg bg-white dark:bg-gray-700 flex items-center justify-center shadow-sm">
              <Icon :name="phase.icon" class="size-4 text-app-muted" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-xs text-app-muted">{{ phase.label }}</p>
              <p class="text-sm font-medium text-app truncate">{{ getAnswerDisplay(phase.id) }}</p>
            </div>
            <Icon
              name="i-lucide-pencil"
              class="size-4 text-app-muted opacity-0 group-hover:opacity-100 transition-opacity"
            />
          </button>
        </div>
      </div>

      <!-- Plan Generated -->
      <div v-if="plan && isComplete" class="mt-6 pt-6 border-t border-gray-200 dark:border-gray-800">
        <div class="flex items-center gap-2 mb-4">
          <div class="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
            <Icon name="i-lucide-check" class="size-3.5 text-white" />
          </div>
          <p class="text-sm font-medium text-green-600 dark:text-green-400">Plan Ready!</p>
        </div>

        <div v-if="plan.name" class="mb-3">
          <p class="text-xs text-app-muted mb-1">Project Name</p>
          <p class="font-semibold text-app">{{ plan.name }}</p>
        </div>

        <div v-if="plan.description" class="mb-4">
          <p class="text-xs text-app-muted mb-1">Description</p>
          <p class="text-sm text-app">{{ plan.description }}</p>
        </div>

        <Button
          color="primary"
          class="w-full"
          size="lg"
          @click="emit('createProject')"
        >
          <template #leading>
            <Icon name="i-lucide-rocket" class="size-4" />
          </template>
          Create Project
        </Button>
      </div>
    </div>

    <!-- Progress Footer -->
    <div class="p-4 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs text-app-muted">Progress</span>
        <span class="text-xs font-medium text-app">{{ completedPhases.length }}/{{ INTERVIEW_PHASES.length }}</span>
      </div>
      <div class="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          class="h-full bg-gradient-to-r from-violet-500 to-purple-600 rounded-full transition-all duration-500"
          :style="{ width: `${(completedPhases.length / INTERVIEW_PHASES.length) * 100}%` }"
        />
      </div>
    </div>
  </div>
</template>
