<script setup lang="ts">
/**
 * ArchitectPRD - PRD document display with actions
 */
import type { PRDContent } from '@/types/architect'

defineProps<{
  prd: PRDContent
  saving?: boolean
}>()

const emit = defineEmits<{
  (e: 'save' | 'download' | 'generateTasks', prd: PRDContent): void
}>()

const { renderMarkdown } = useMarkdown()
</script>

<template>
  <div class="mt-3">
    <div class="rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div class="px-3 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <span class="text-xs font-medium text-app-muted">PRD: {{ prd.name }}</span>
        <div class="flex gap-1">
          <Button
            size="xs"
            variant="ghost"
            icon="i-lucide-save"
            :loading="saving"
            @click="emit('save', prd)"
          />
          <Button
            size="xs"
            variant="ghost"
            icon="i-lucide-download"
            @click="emit('download', prd)"
          />
          <Button
            size="xs"
            color="primary"
            @click="emit('generateTasks', prd)"
          >
            Generate Tasks
          </Button>
        </div>
      </div>
      <!-- eslint-disable vue/no-v-html -->
      <div
        class="p-3 prose prose-sm dark:prose-invert max-w-none"
        v-html="renderMarkdown(prd.markdown || '')"
      />
      <!-- eslint-enable vue/no-v-html -->
    </div>
  </div>
</template>
