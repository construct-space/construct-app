<template>
  <div class="interview-progress">
    <!-- Progress Header -->
    <div class="mb-4">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-medium text-app-muted uppercase tracking-wider">Progress</span>
        <span class="text-xs text-app-muted">{{ progress.completed }}/{{ progress.total }}</span>
      </div>
      <div class="h-1.5 bg-gray-200/50 dark:bg-gray-700/50 rounded-full overflow-hidden">
        <div
          class="h-full bg-[var(--app-accent)] rounded-full transition-all duration-500"
          :style="{ width: `${progress.percentage}%` }"
        />
      </div>
    </div>

    <!-- Phases List -->
    <div class="space-y-1">
      <button
        v-for="(phase, index) in phases"
        :key="phase.id"
        class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-left"
        :class="getPhaseClasses(phase, index)"
        :disabled="!canEdit(phase.id)"
        @click="handlePhaseClick(phase.id)"
      >
        <!-- Status Icon -->
        <div
          class="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition-all"
          :class="getStatusIconClasses(phase, index)"
        >
          <Icon
            v-if="isCompleted(phase.id)"
            name="i-lucide-check"
            class="size-3.5"
          />
          <Icon
            v-else-if="isCurrent(index)"
            name="i-lucide-circle-dot"
            class="size-3.5"
          />
          <span v-else class="text-xs font-medium">{{ index + 1 }}</span>
        </div>

        <!-- Phase Info -->
        <div class="flex-1 min-w-0">
          <p
            class="text-sm font-medium truncate"
            :class="isCompleted(phase.id) ? 'text-app' : isCurrent(index) ? 'text-app-accent' : 'text-app-muted'"
          >
            {{ phase.label }}
          </p>
          <p
            v-if="getAnswerLabel(phase.id)"
            class="text-xs text-app-muted truncate"
          >
            {{ getAnswerLabel(phase.id) }}
          </p>
        </div>

        <!-- Edit Icon (on hover) -->
        <Icon
          v-if="canEdit(phase.id)"
          name="i-lucide-pencil"
          class="size-3.5 text-app-muted opacity-0 group-hover:opacity-100 transition-opacity"
        />
      </button>
    </div>

    <!-- Complete State -->
    <div
      v-if="isComplete"
      class="mt-4 p-3 rounded-lg bg-green-500/10 border border-green-500/20"
    >
      <div class="flex items-center gap-2">
        <Icon name="i-lucide-check-circle" class="size-5 text-green-500" />
        <span class="text-sm font-medium text-green-600 dark:text-green-400">Plan Complete!</span>
      </div>
      <p class="text-xs text-app-muted mt-1">Review the plan and create your project.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { InterviewPhase } from '../../data/architect-knowledge'

interface Props {
  phases: InterviewPhase[]
  answers: Record<string, string | string[]>
  currentPhaseIndex: number
  isComplete: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  editPhase: [phaseId: string]
}>()

// Import the label getter
const { getLabelForValue } = await import('../../data/architect-knowledge')

// Computed
const progress = computed(() => {
  const total = props.phases.length
  const completed = props.phases.filter(p => isCompleted(p.id)).length
  return {
    completed,
    total,
    percentage: Math.round((completed / total) * 100)
  }
})

// Methods
function isCompleted(phaseId: string): boolean {
  const val = props.answers[phaseId]
  return val !== undefined && (Array.isArray(val) ? val.length > 0 : !!val)
}

function isCurrent(index: number): boolean {
  return index === props.currentPhaseIndex && !props.isComplete
}

function canEdit(phaseId: string): boolean {
  return isCompleted(phaseId)
}

function getAnswerLabel(phaseId: string): string | null {
  const val = props.answers[phaseId]
  if (!val) return null

  if (Array.isArray(val)) {
    const labels = val.map(v => getLabelForValue(phaseId, v))
    if (labels.length > 2) {
      return `${labels.slice(0, 2).join(', ')} +${labels.length - 2}`
    }
    return labels.join(', ')
  }

  return getLabelForValue(phaseId, val)
}

function getPhaseClasses(phase: InterviewPhase, index: number): string[] {
  const classes = ['group']

  if (isCompleted(phase.id)) {
    classes.push('hover:bg-white/50 dark:hover:bg-white/10 cursor-pointer')
  }
  else if (isCurrent(index)) {
    classes.push('bg-[var(--app-accent)]/10')
  }
  else {
    classes.push('opacity-50 cursor-not-allowed')
  }

  return classes
}

function getStatusIconClasses(phase: InterviewPhase, index: number): string[] {
  if (isCompleted(phase.id)) {
    return ['bg-[var(--app-accent)]', 'text-white']
  }
  if (isCurrent(index)) {
    return ['bg-[var(--app-accent)]/20', 'text-app-accent']
  }
  return ['bg-gray-200 dark:bg-gray-700', 'text-app-muted']
}

function handlePhaseClick(phaseId: string) {
  if (canEdit(phaseId)) {
    emit('editPhase', phaseId)
  }
}
</script>
