<script setup lang="ts">
/**
 * ArchitectQuestionFlow - Left panel: vertical stacking questions
 *
 * Shows describe prompt, answered questions (collapsed), active question (expanded),
 * upcoming questions (dimmed), and thinking indicator.
 */
import type { InterviewQuestion } from '../data/architect-knowledge'
import ArchitectQuestionCard from './ArchitectQuestionCard.vue'
import ArchitectThinkingIndicator from './ArchitectThinkingIndicator.vue'

export interface QuestionFlowItem extends InterviewQuestion {
  index: number
  answered: boolean
  active: boolean
  upcoming: boolean
  answerLabel: string | null
}

defineProps<{
  description: string
  questionFlow: QuestionFlowItem[]
  isThinking: boolean
  thinkingMessage: string
  isGeneratingQuestions: boolean
  isGeneratingPlan: boolean
  isClarifying: boolean
  errorMessage: string
  clarificationMessage: string
  selectedValues: string[]
  showOtherInput: boolean
  otherInputValue: string
  hasQuestions: boolean
}>()

const emit = defineEmits<{
  select: [value: string]
  confirm: []
  confirmOther: []
  goTo: [index: number]
  cancel: []
  'update:showOtherInput': [val: boolean]
  'update:otherInputValue': [val: string]
}>()
</script>

<template>
  <div class="flex-1 overflow-y-auto px-6 py-6 space-y-2">
    <!-- Description display (after submit) -->
    <div v-if="hasQuestions || isGeneratingQuestions" class="mb-4">
      <p class="text-xs text-app-muted/50 uppercase tracking-wider font-medium mb-1">PROJECT</p>
      <p class="text-sm text-app-foreground/80">{{ description }}</p>
    </div>

    <!-- Error message -->
    <div v-if="errorMessage" class="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 mb-4">
      <div class="flex items-start gap-2">
        <Icon name="i-lucide-alert-circle" class="size-4 text-red-400 mt-0.5 shrink-0" />
        <div class="flex-1">
          <p class="text-sm text-red-300">{{ errorMessage }}</p>
        </div>
        <button class="text-red-400 hover:text-red-300" @click="emit('cancel')">
          <Icon name="i-lucide-x" class="size-4" />
        </button>
      </div>
    </div>

    <!-- Thinking indicator (generating questions) -->
    <ArchitectThinkingIndicator
      v-if="isGeneratingQuestions"
      :message="thinkingMessage || 'Generating questions...'"
    />

    <ArchitectThinkingIndicator
      v-else-if="isClarifying"
      :message="thinkingMessage || 'Clarifying the current question...'"
    />

    <div
      v-if="clarificationMessage"
      class="rounded-xl border border-[var(--app-accent)]/20 bg-[var(--app-accent)]/6 px-4 py-3 mb-4"
    >
      <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--app-accent)]/80 mb-1">Architect</p>
      <p class="text-sm text-app-foreground/90 whitespace-pre-wrap">{{ clarificationMessage }}</p>
    </div>

    <!-- Question cards -->
    <TransitionGroup name="question" tag="div" class="space-y-2">
      <ArchitectQuestionCard
        v-for="q in questionFlow"
        :key="q.id"
        :question="q"
        :index="q.index"
        :answered="q.answered"
        :active="q.active"
        :upcoming="q.upcoming"
        :answer-label="q.answerLabel"
        :selected-values="q.active ? selectedValues : []"
        :show-other-input="q.active ? showOtherInput : false"
        :other-input-value="q.active ? otherInputValue : ''"
        @select="emit('select', $event)"
        @confirm="emit('confirm')"
        @confirm-other="emit('confirmOther')"
        @go-to="emit('goTo', $event)"
        @update:show-other-input="emit('update:showOtherInput', $event)"
        @update:other-input-value="emit('update:otherInputValue', $event)"
      />
    </TransitionGroup>

    <!-- Thinking indicator (generating plan) -->
    <ArchitectThinkingIndicator
      v-if="isGeneratingPlan"
      :message="thinkingMessage || 'Building your plan...'"
    />
  </div>
</template>

<style scoped>
.question-enter-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.question-leave-active {
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
.question-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.question-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
