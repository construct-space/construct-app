<script setup lang="ts">
import type { TaskListBlock } from '@/assistant'

defineProps<{
  block: TaskListBlock
}>()

function iconName(status: string): string {
  switch (status) {
    case 'done': return 'i-lucide-check-circle'
    case 'running': return 'i-lucide-loader-2'
    case 'error': return 'i-lucide-x-circle'
    default: return 'i-lucide-circle'
  }
}
</script>

<template>
  <div class="my-2 space-y-1">
    <div
      v-for="task in block.tasks"
      :key="task.id"
      class="flex items-center gap-2 rounded-lg px-3 py-2 text-xs border border-app-border"
      :class="{
        'bg-green-500/5 border-green-500/20': task.status === 'done',
        'bg-app-accent/5 border-app-accent/20': task.status === 'running',
        'bg-red-500/5 border-red-500/20': task.status === 'error',
      }"
    >
      <Icon
        :name="iconName(task.status)"
        class="size-3.5 shrink-0"
        :class="{
          'text-green-500': task.status === 'done',
          'text-app-accent animate-spin': task.status === 'running',
          'text-red-500': task.status === 'error',
          'text-app-muted': task.status === 'pending',
        }"
      />
      <span class="text-app">{{ task.title }}</span>
    </div>
  </div>
</template>
