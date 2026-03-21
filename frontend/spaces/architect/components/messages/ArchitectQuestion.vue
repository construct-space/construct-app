<script setup lang="ts">
/**
 * ArchitectQuestion - Interactive question with option buttons
 */
import type { ParsedQuestion } from '@/types/architect'

defineProps<{
  question: ParsedQuestion
  answered: boolean
  isSelected: (value: string) => boolean
}>()

const emit = defineEmits<{
  (e: 'select', value: string): void
  (e: 'notSure'): void
}>()
</script>

<template>
  <div class="mt-3">
    <p class="text-app font-medium mb-3">{{ question.question }}</p>
    <div class="flex flex-wrap gap-2">
      <button
        v-for="opt in question.options"
        :key="opt.value"
        class="px-3 py-1.5 rounded-md border text-sm transition-all"
        :class="[
          isSelected(opt.value)
            ? 'border-blue-500 bg-blue-500/10 text-blue-500'
            : 'border-gray-200 dark:border-gray-700 hover:border-blue-500 text-app'
        ]"
        :disabled="answered"
        @click="emit('select', opt.value)"
      >
        <Icon v-if="opt.icon" :name="opt.icon" class="size-3 mr-1" />
        {{ opt.label }}
      </button>
    </div>
    <button
      v-if="!answered"
      class="mt-2 text-xs text-app-muted hover:text-blue-500 transition-colors"
      @click="emit('notSure')"
    >
      Not sure? I can recommend
    </button>
  </div>
</template>
