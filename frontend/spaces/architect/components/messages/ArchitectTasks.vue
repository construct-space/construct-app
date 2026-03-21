<script setup lang="ts">
/**
 * ArchitectTasks - Task list display with project creation
 */
import type { TaskItem, PRDContent } from '@/types/architect'

const props = defineProps<{
  tasks: TaskItem[]
  prd?: PRDContent | null
}>()

const emit = defineEmits<{
  (e: 'createProject' | 'addToKanban', tasks: TaskItem[]): void
}>()

const selectedTasks = ref<Set<number>>(new Set())
const allSelected = computed(() => selectedTasks.value.size === props.tasks.length)

function toggleTask(idx: number) {
  if (selectedTasks.value.has(idx)) {
    selectedTasks.value.delete(idx)
  } else {
    selectedTasks.value.add(idx)
  }
}

function toggleAll() {
  if (allSelected.value) {
    selectedTasks.value.clear()
  } else {
    props.tasks.forEach((_, idx) => selectedTasks.value.add(idx))
  }
}

function getSelectedTasks(): TaskItem[] {
  return props.tasks.filter((_, idx) => selectedTasks.value.has(idx))
}

const priorityColors: Record<string, string> = {
  high: 'text-red-500',
  medium: 'text-yellow-500',
  low: 'text-green-500'
}
</script>

<template>
  <div class="mt-3">
    <div class="rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div class="px-3 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <input
            type="checkbox"
            :checked="allSelected"
            class="rounded border-gray-300 dark:border-gray-600"
            @change="toggleAll"
          >
          <span class="text-xs font-medium text-app-muted">
            Tasks ({{ selectedTasks.size }}/{{ tasks.length }} selected)
          </span>
        </div>
        <div class="flex gap-1">
          <Button
            size="xs"
            variant="outline"
            icon="i-lucide-list-todo"
            :disabled="selectedTasks.size === 0"
            @click="emit('addToKanban', getSelectedTasks())"
          >
            Add to Kanban
          </Button>
          <Button
            size="xs"
            color="primary"
            @click="emit('createProject', tasks)"
          >
            Create Project
          </Button>
        </div>
      </div>
      <div class="p-2 space-y-1 max-h-80 overflow-y-auto">
        <div
          v-for="(task, tidx) in tasks"
          :key="tidx"
          class="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
          @click="toggleTask(tidx)"
        >
          <input
            type="checkbox"
            :checked="selectedTasks.has(tidx)"
            class="mt-1 rounded border-gray-300 dark:border-gray-600"
            @click.stop
            @change="toggleTask(tidx)"
          >
          <span class="text-xs text-app-muted w-4">{{ tidx + 1 }}.</span>
          <div class="flex-1 min-w-0">
            <p class="text-app text-sm">{{ task.title }}</p>
            <p v-if="task.description" class="text-xs text-app-muted">{{ task.description }}</p>
            <div v-if="task.subtasks?.length" class="mt-1 pl-2 border-l border-gray-200 dark:border-gray-700">
              <p v-for="(sub, sidx) in task.subtasks" :key="sidx" class="text-xs text-app-muted">
                {{ sub }}
              </p>
            </div>
          </div>
          <span
            v-if="task.priority"
            class="text-xs capitalize"
            :class="priorityColors[task.priority] || 'text-app-muted'"
          >
            {{ task.priority }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
