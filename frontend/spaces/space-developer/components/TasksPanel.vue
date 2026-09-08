<script setup lang="ts">
import { computed } from 'vue'
import { CheckCircle2, Circle, CircleX, Loader2, ListChecks, MinusCircle } from 'lucide-vue-next'

interface WorkflowTask {
  id: number
  title: string
  description?: string
  status: 'pending' | 'in_progress' | 'completed' | 'error' | 'skipped'
}

const props = defineProps<{
  tasks: Map<number, WorkflowTask>
}>()

// Everything — used for the summary count so finished work still shows
// up as "3/5 done" rather than silently vanishing.
const all = computed(() => Array.from(props.tasks.values()))

// Visible rows — completed tasks are removed from the panel so the list
// is always the "what's next" view. Active work sits in `in_progress` +
// `pending` + `error` + `skipped`. Insertion order is preserved (Map
// iteration is insertion-ordered in JS), so the list reads like a runbook.
const ordered = computed(() => all.value.filter(t => t.status !== 'completed'))

const total = computed(() => all.value.length)
const completed = computed(() => all.value.filter(t => t.status === 'completed').length)
const inProgress = computed(() => all.value.find(t => t.status === 'in_progress'))

const summary = computed(() => {
  if (total.value === 0) return ''
  if (inProgress.value) return `${completed.value}/${total.value} · running`
  if (completed.value === total.value) return `${total.value} done`
  return `${completed.value}/${total.value}`
})

function iconFor(status: WorkflowTask['status']) {
  switch (status) {
    case 'completed':   return CheckCircle2
    case 'in_progress': return Loader2
    case 'error':       return CircleX
    case 'skipped':     return MinusCircle
    default:            return Circle
  }
}

function colorFor(status: WorkflowTask['status']): string {
  switch (status) {
    case 'completed':   return 'var(--app-success, #10b981)'
    case 'in_progress': return 'var(--app-accent)'
    case 'error':       return 'var(--app-danger, #ef4444)'
    case 'skipped':     return 'var(--app-muted)'
    default:            return 'var(--app-muted)'
  }
}
</script>

<template>
  <div
    class="border-b flex flex-col min-h-0 shrink-0"
    style="border-color: var(--app-border)"
  >
    <div
      class="px-3 py-2 text-xs font-semibold flex items-center gap-2 sticky top-0 z-10"
      style="color: var(--app-muted); background: var(--app-surface)"
    >
      <ListChecks :size="13" />
      <span class="flex-1">Tasks</span>
      <span
        v-if="total > 0"
        class="text-[10px] font-normal tabular-nums"
        style="color: var(--app-muted)"
      >
        {{ summary }}
      </span>
    </div>
    <div
      v-if="total === 0"
      class="px-3 pb-3 text-[11px] italic"
      style="color: var(--app-muted)"
    >
      No tasks yet — the agent will create them here as it works.
    </div>
    <div
      v-else-if="ordered.length === 0"
      class="px-3 pb-3 text-[11px] italic"
      style="color: var(--app-muted)"
    >
      All {{ total }} {{ total === 1 ? 'task' : 'tasks' }} done.
    </div>
    <ul
      v-else
      class="px-2 pb-2 space-y-0.5"
    >
      <li
        v-for="task in ordered"
        :key="task.id"
        class="flex items-start gap-2 rounded px-2 py-1 text-xs"
        :class="task.status === 'in_progress'
          ? 'bg-[var(--app-accent)]/8'
          : ''"
      >
        <component
          :is="iconFor(task.status)"
          :size="12"
          :class="task.status === 'in_progress' ? 'animate-spin' : ''"
          :style="{ color: colorFor(task.status), flexShrink: 0, marginTop: '2px' }"
        />
        <span
          class="flex-1 leading-tight break-words"
          :style="{
            color: task.status === 'completed'
              ? 'var(--app-muted)'
              : 'var(--app-foreground)',
            textDecoration: task.status === 'completed' ? 'line-through' : 'none',
          }"
        >
          {{ task.title }}
        </span>
      </li>
    </ul>
  </div>
</template>
