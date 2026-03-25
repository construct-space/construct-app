<script setup lang="ts">
import { ref, computed } from 'vue'
import type { QuestionBlock } from '@/operator/useAgentSession'

const props = defineProps<{
  block: QuestionBlock
}>()

const emit = defineEmits<{
  answer: [questionId: string, answer: string | string[]]
}>()

const isMulti = computed(() => props.block.questionType === 'multi')
const pendingSelections = ref<Set<string>>(new Set())
const isSubmitted = computed(() => !!props.block.answer)

function isSelected(optValue: string): boolean {
  if (isSubmitted.value) {
    return Array.isArray(props.block.answer)
      ? props.block.answer.includes(optValue)
      : props.block.answer === optValue
  }
  return pendingSelections.value.has(optValue)
}

function toggle(opt: { value: string }) {
  if (isSubmitted.value) return

  if (isMulti.value) {
    const s = new Set(pendingSelections.value)
    if (s.has(opt.value)) s.delete(opt.value)
    else s.add(opt.value)
    pendingSelections.value = s
  } else {
    // Single select — submit immediately
    props.block.answer = opt.value
    emit('answer', props.block.id, opt.value)
  }
}

function submitMulti() {
  if (pendingSelections.value.size === 0) return
  const selected = Array.from(pendingSelections.value)
  props.block.answer = selected
  emit('answer', props.block.id, selected.join(', '))
}

function selectedDescriptions(): string[] {
  const answer = props.block.answer
  if (!answer) return []
  const values = Array.isArray(answer) ? answer : [answer]
  return props.block.options
    .filter(o => values.includes(o.value) && o.description)
    .map(o => o.description!)
}
</script>

<template>
  <div class="question-block my-2 rounded-xl border border-app-border p-4">
    <div class="flex items-start justify-between gap-2 mb-3">
      <p class="text-sm font-medium text-app">{{ block.question }}</p>
      <span v-if="isMulti && !isSubmitted" class="shrink-0 text-[10px] text-app-muted bg-app-accent/10 px-1.5 py-0.5 rounded-full">
        select multiple
      </span>
    </div>

    <div class="flex flex-wrap gap-2">
      <button
        v-for="opt in block.options"
        :key="opt.value"
        :disabled="isSubmitted"
        class="question-opt"
        :class="[
          isSelected(opt.value)
            ? 'question-opt--selected'
            : isSubmitted
              ? 'question-opt--dimmed'
              : 'question-opt--idle'
        ]"
        @click="toggle(opt)"
      >
        <!-- Multi-select checkbox indicator -->
        <div class="flex items-start gap-2">
          <span v-if="isMulti" class="question-check shrink-0 mt-0.5" :class="{ 'question-check--on': isSelected(opt.value) }">
            <svg v-if="isSelected(opt.value)" class="size-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2"><polyline points="2 6 5 9 10 3" /></svg>
          </span>
          <div>
            <span class="question-opt__label">{{ opt.label }}</span>
            <span v-if="opt.description" class="question-opt__desc">{{ opt.description }}</span>
          </div>
        </div>
      </button>
    </div>

    <!-- Multi-select confirm button -->
    <button
      v-if="isMulti && !isSubmitted && pendingSelections.size > 0"
      class="mt-3 px-4 py-1.5 rounded-lg text-xs font-medium transition-colors"
      style="background: var(--app-accent); color: white;"
      @click="submitMulti"
    >
      Confirm ({{ pendingSelections.size }})
    </button>

    <div v-if="isSubmitted && selectedDescriptions().length" class="mt-2.5 space-y-0.5">
      <p v-for="desc in selectedDescriptions()" :key="desc" class="text-xs text-app-muted">{{ desc }}</p>
    </div>
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
  display: block;
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

.question-check {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 0.875rem;
  height: 0.875rem;
  border-radius: 0.25rem;
  border: 1.5px solid var(--app-border);
  transition: all 0.15s;
}
.question-check--on {
  border-color: var(--app-accent);
  background: var(--app-accent);
  color: white;
}
</style>
