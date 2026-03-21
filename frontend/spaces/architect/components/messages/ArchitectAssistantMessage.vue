<script setup lang="ts">
/**
 * ArchitectAssistantMessage - AI assistant message with parsed content
 */
import type { ParsedContent, ParsedQuestion, PRDContent, TaskItem } from '@/types/architect'
import ArchitectQuestion from './ArchitectQuestion.vue'
import ArchitectPRD from './ArchitectPRD.vue'
import ArchitectTasks from './ArchitectTasks.vue'

const props = defineProps<{
  parsed: ParsedContent
  selectedOptions: Record<string, string | string[]>
}>()

const emit = defineEmits<{
  (e: 'selectOption', question: ParsedQuestion, value: string): void
  (e: 'notSure', question: ParsedQuestion): void
  (e: 'savePRD' | 'downloadPRD' | 'generateTasks', prd: PRDContent): void
  (e: 'createProject', prd: PRDContent, tasks: TaskItem[]): void
}>()

const { renderMarkdown } = useMarkdown()

function isOptionSelected(question: ParsedQuestion | null, optionValue: string): boolean {
  if (!question) return false
  const selected = props.selectedOptions[question.id]
  return Array.isArray(selected) ? selected.includes(optionValue) : selected === optionValue
}

function hasAnsweredQuestion(question: ParsedQuestion | null): boolean {
  if (!question) return false
  return !!props.selectedOptions[question.id]
}
</script>

<template>
  <div class="flex gap-3">
    <div class="shrink-0 w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center">
      <Icon name="i-lucide-bot" class="size-3 text-white" />
    </div>
    <div class="flex-1 min-w-0 text-sm">
      <div class="space-y-3">
        <!-- Text before structured content -->
        <!-- eslint-disable vue/no-v-html -->
        <div
          v-if="parsed.textBefore"
          class="prose prose-sm dark:prose-invert max-w-none"
          v-html="renderMarkdown(parsed.textBefore)"
        />
        <!-- eslint-enable vue/no-v-html -->

        <!-- Question UI -->
        <ArchitectQuestion
          v-if="parsed.question"
          :question="parsed.question"
          :answered="hasAnsweredQuestion(parsed.question)"
          :is-selected="(val: string) => isOptionSelected(parsed.question, val)"
          @select="emit('selectOption', parsed.question!, $event)"
          @not-sure="emit('notSure', parsed.question!)"
        />

        <!-- PRD Output -->
        <ArchitectPRD
          v-if="parsed.prd"
          :prd="parsed.prd"
          @save="emit('savePRD', $event)"
          @download="emit('downloadPRD', $event)"
          @generate-tasks="emit('generateTasks', $event)"
        />

        <!-- Tasks Output -->
        <ArchitectTasks
          v-if="parsed.tasks"
          :tasks="parsed.tasks"
          :prd="parsed.prd"
          @create-project="emit('createProject', parsed.prd!, $event)"
        />

        <!-- Text after structured content -->
        <!-- eslint-disable vue/no-v-html -->
        <div
          v-if="parsed.textAfter"
          class="prose prose-sm dark:prose-invert max-w-none"
          v-html="renderMarkdown(parsed.textAfter)"
        />
        <!-- eslint-enable vue/no-v-html -->
      </div>
    </div>
  </div>
</template>
