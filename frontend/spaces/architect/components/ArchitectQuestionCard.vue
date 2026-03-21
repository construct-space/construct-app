<script setup lang="ts">
/**
 * ArchitectQuestionCard - A single question with curved brace decoration and option pills
 *
 * States: answered (collapsed), active (expanded with options), upcoming (dimmed)
 */
import type { InterviewQuestion } from '../data/architect-knowledge'

const props = defineProps<{
  question: InterviewQuestion
  index: number
  answered: boolean
  active: boolean
  upcoming: boolean
  answerLabel: string | null
  selectedValues: string[]
  showOtherInput: boolean
  otherInputValue: string
}>()

const emit = defineEmits<{
  select: [value: string]
  confirm: []
  confirmOther: []
  goTo: [index: number]
  'update:showOtherInput': [val: boolean]
  'update:otherInputValue': [val: string]
}>()

function isSelected(value: string): boolean {
  return props.selectedValues.includes(value)
}
</script>

<template>
  <!-- Answered question: collapsed -->
  <div v-if="answered && !active" class="group">
    <button
      class="w-full flex items-center justify-between rounded-lg px-4 py-2.5 border-l-2 border-[var(--app-accent)]/30 hover:bg-[var(--app-accent)]/5 transition-colors text-left"
      @click="emit('goTo', index)"
    >
      <div class="flex-1 min-w-0">
        <p class="text-xs text-app-muted/60 font-medium">{{ question.question }}</p>
        <p class="text-sm text-app-foreground font-medium mt-0.5 truncate">{{ answerLabel }}</p>
      </div>
      <Icon name="i-lucide-check" class="size-3.5 text-[var(--app-accent)] opacity-60 shrink-0 ml-3" />
    </button>
  </div>

  <!-- Active question: expanded -->
  <div v-else-if="active">
    <div class="bg-[color-mix(in_srgb,var(--app-background),white_6%)] rounded-xl p-5 border-l-2 border-[var(--app-accent)]">
      <p class="text-sm font-semibold text-[var(--app-accent)] mb-1">{{ question.question }}</p>
      <p v-if="question.type === 'multi'" class="text-xs text-app-muted mb-4">Select one or more</p>
      <div v-else class="mb-4" />

      <!-- Option pills -->
      <div class="flex flex-wrap gap-2">
        <button
          v-for="opt in question.options"
          :key="opt.value"
          class="px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150"
          :class="[
            isSelected(opt.value)
              ? 'bg-[var(--app-accent)]/15 text-[var(--app-accent)]'
              : 'bg-[color-mix(in_srgb,var(--app-background),white_8%)] text-app-muted hover:text-app-foreground hover:bg-[color-mix(in_srgb,var(--app-background),white_12%)]',
          ]"
          @click="emit('select', opt.value)"
        >
          {{ opt.label }}
        </button>
      </div>

      <!-- Other input -->
      <div v-if="showOtherInput" class="mt-3 flex gap-2">
        <input
          :value="otherInputValue"
          class="flex-1 bg-[color-mix(in_srgb,var(--app-background),white_4%)] rounded-lg px-3 py-2 text-sm text-app-foreground placeholder-app-muted/50 outline-none focus:ring-1 focus:ring-[var(--app-accent)]/30"
          placeholder="Type your answer..."
          autofocus
          @input="emit('update:otherInputValue', ($event.target as HTMLInputElement).value)"
          @keydown.enter.prevent="emit('confirmOther')"
        />
        <button
          class="px-3 py-2 rounded-lg text-sm bg-[var(--app-accent)]/10 text-[var(--app-accent)] hover:bg-[var(--app-accent)]/20 transition-colors"
          :disabled="!otherInputValue.trim()"
          @click="emit('confirmOther')"
        >
          Confirm
        </button>
      </div>

      <!-- Confirm button for multi-select -->
      <div v-if="question.type === 'multi' && selectedValues.length > 0" class="mt-4 flex justify-end">
        <button
          class="px-5 py-2 rounded-lg text-sm font-medium bg-[var(--app-accent)] text-[var(--app-accent-foreground)] hover:opacity-90 transition-opacity"
          @click="emit('confirm')"
        >
          Continue
        </button>
      </div>
    </div>
  </div>

  <!-- Upcoming questions: hidden (only show answered + active) -->
</template>
