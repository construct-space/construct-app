<script setup lang="ts">
import type { QuestionBlock } from '@/operator/useAgentSession'

const props = defineProps<{
  block: QuestionBlock
}>()

const emit = defineEmits<{
  answer: [questionId: string, answer: string]
}>()

function isSelected(optValue: string): boolean {
  return Array.isArray(props.block.answer)
    ? props.block.answer.includes(optValue)
    : props.block.answer === optValue
}

function selectedDescription(): string | undefined {
  return props.block.options.find(o => o.value === props.block.answer)?.description
}

function select(opt: { value: string }) {
  props.block.answer = opt.value
  emit('answer', props.block.id, opt.value)
}
</script>

<template>
  <div class="question-block my-2 rounded-xl border border-app-border p-4">
    <p class="text-sm font-medium text-app mb-3">{{ block.question }}</p>

    <div class="flex flex-wrap gap-2">
      <button
        v-for="opt in block.options"
        :key="opt.value"
        :disabled="!!block.answer"
        class="question-opt"
        :class="[
          isSelected(opt.value)
            ? 'question-opt--selected'
            : block.answer
              ? 'question-opt--dimmed'
              : 'question-opt--idle'
        ]"
        @click="select(opt)"
      >
        <span class="question-opt__label">{{ opt.label }}</span>
        <span v-if="opt.description && !isSelected(opt.value)" class="question-opt__desc">{{ opt.description }}</span>
      </button>
    </div>

    <p v-if="selectedDescription()" class="mt-2.5 text-xs text-app-muted">
      {{ selectedDescription() }}
    </p>
  </div>
</template>

<style scoped>
.question-block {
  background: color-mix(in srgb, var(--app-foreground) 2%, transparent);
}

.question-opt {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.125rem;
  border-radius: 0.625rem;
  padding: 0.5rem 0.875rem;
  font-size: 0.75rem;
  border: 1px solid;
  transition: all 0.15s;
  cursor: pointer;
  text-align: left;
}
.question-opt:disabled {
  cursor: default;
}

.question-opt__label {
  font-weight: 500;
  line-height: 1.25rem;
}
.question-opt__desc {
  font-size: 0.625rem;
  opacity: 0.6;
  line-height: 1rem;
}

.question-opt--selected {
  border-color: var(--app-accent);
  background: color-mix(in srgb, var(--app-accent) 12%, transparent);
  color: var(--app-accent);
}

.question-opt--dimmed {
  border-color: color-mix(in srgb, var(--app-border) 50%, transparent);
  color: var(--app-muted);
  opacity: 0.5;
}

.question-opt--idle {
  border-color: var(--app-border);
  color: var(--app-foreground);
}
.question-opt--idle:hover {
  border-color: color-mix(in srgb, var(--app-accent) 50%, transparent);
  background: color-mix(in srgb, var(--app-accent) 5%, transparent);
}
</style>
