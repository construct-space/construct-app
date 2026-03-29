<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useOperator } from '@/operator/client'
import type { ToolActivity } from '@/operator/useStreamStatus'
import { Target, CheckCircle2, Circle, Loader2 } from 'lucide-vue-next'

const props = defineProps<{
  projectPath: string
  toolHistory: readonly ToolActivity[]
  isRunning: boolean
}>()

interface GoalCriterion {
  text: string
  done: boolean
}

interface GoalData {
  title: string
  plan: string[]
  criteria: GoalCriterion[]
  path: string
}

const goal = ref<GoalData | null>(null)
const loading = ref(false)

// Created/read files from tool history
function extractPath(t: ToolActivity): string {
  if (!t.input) return ''
  try {
    const parsed = JSON.parse(t.input)
    return (parsed.path as string) || ''
  } catch { return '' }
}

const createdFiles = computed(() => {
  const files = new Set<string>()
  for (const t of props.toolHistory) {
    if (t.tool === 'write_file') {
      const p = extractPath(t)
      if (p) files.add(p.replace(props.projectPath + '/', ''))
    }
  }
  return [...files]
})

const readFiles = computed(() => {
  const files = new Set<string>()
  for (const t of props.toolHistory) {
    if (t.tool === 'read_file' || t.tool === 'list_dir') {
      const p = extractPath(t)
      if (p) files.add(p.replace(props.projectPath + '/', ''))
    }
  }
  return [...files]
})

const doneCount = computed(() => goal.value?.criteria.filter(c => c.done).length || 0)
const totalCount = computed(() => goal.value?.criteria.length || 0)
const progressPercent = computed(() => totalCount.value > 0 ? (doneCount.value / totalCount.value) * 100 : 0)

// Load goal from project
async function loadGoal() {
  if (!props.projectPath) return
  loading.value = true

  try {
    const operator = useOperator()
    const goalsDir = `${props.projectPath}/docs/goals`
    const result = await operator.send('tool.execute', { name: 'list_dir', input: JSON.stringify({ path: goalsDir }) })
    const data = result?.data as Record<string, unknown> | undefined
    if (!data?.content) { loading.value = false; return }

    const files = (data.content as string).split('\n').filter(f => f.includes('goal-')).sort()
    if (files.length === 0) { loading.value = false; return }

    // Read most recent goal
    const goalFile = files[files.length - 1].trim()
    const goalPath = `${goalsDir}/${goalFile}`
    const content = await operator.send('tool.execute', { name: 'read_file', input: JSON.stringify({ path: goalPath }) })
    const contentData = content?.data as Record<string, unknown> | undefined
    if (!contentData?.content) { loading.value = false; return }

    parseGoal(contentData.content as string, goalPath)
  } catch { /* no goals */ }
  loading.value = false
}

function parseGoal(text: string, path: string) {
  const titleMatch = text.match(/^#\s+(?:Goal:\s*)?(.+)/m)
  const planMatch = text.match(/## Plan\n([\s\S]*?)(?=\n##|$)/)
  const criteriaMatch = text.match(/## Acceptance Criteria\n([\s\S]*?)(?=\n##|$)/)

  const plan = planMatch?.[1]?.trim().split('\n').map(l => l.replace(/^\d+\.\s*/, '').trim()).filter(Boolean) || []
  const criteria = criteriaMatch?.[1]?.trim().split('\n').map(line => {
    const done = line.includes('[x]')
    const text = line.replace(/^-\s*\[.\]\s*/, '').trim()
    return text ? { text, done } : null
  }).filter(Boolean) as GoalCriterion[] || []

  goal.value = {
    title: titleMatch?.[1] || 'Goal',
    plan,
    criteria,
    path,
  }
}

// Reload goal when tool history changes (coder might update it)
watch(() => props.toolHistory.length, () => {
  // Check if the goal file was just written
  const last = props.toolHistory[props.toolHistory.length - 1]
  if (last?.tool === 'write_file' && extractPath(last).includes('goals/goal-')) {
    setTimeout(loadGoal, 500) // small delay for file write to complete
  }
})

watch(() => props.projectPath, loadGoal, { immediate: true })
</script>

<template>
  <div class="h-full flex flex-col text-[var(--app-foreground)]">
    <!-- Goal section -->
    <div v-if="goal" class="shrink-0 border-b border-[var(--app-border)]">
      <div class="px-3 py-2 flex items-center gap-2">
        <Target class="size-3.5 text-[var(--app-accent)]" />
        <span class="text-[11px] font-semibold uppercase tracking-wider text-[var(--app-muted)]">Goal</span>
      </div>
      <div class="px-3 pb-2">
        <p class="text-xs font-medium text-[var(--app-foreground)]">{{ goal.title }}</p>
      </div>

      <!-- Progress bar -->
      <div class="px-3 pb-2">
        <div class="flex items-center gap-2 mb-1">
          <div class="flex-1 h-1.5 rounded-full bg-[var(--app-border)]/30 overflow-hidden">
            <div
              class="h-full rounded-full bg-[var(--app-accent)] transition-all duration-500"
              :style="{ width: progressPercent + '%' }"
            />
          </div>
          <span class="text-[10px] text-[var(--app-muted)] tabular-nums">{{ doneCount }}/{{ totalCount }}</span>
        </div>
      </div>

      <!-- Criteria -->
      <div class="px-3 pb-3 space-y-1">
        <div
          v-for="(c, i) in goal.criteria"
          :key="i"
          class="flex items-start gap-1.5 text-[11px] leading-relaxed"
        >
          <CheckCircle2 v-if="c.done" class="size-3.5 text-green-500 mt-0.5 shrink-0" />
          <Loader2 v-else-if="isRunning && i === doneCount" class="size-3.5 text-[var(--app-accent)] mt-0.5 shrink-0 animate-spin" />
          <Circle v-else class="size-3.5 text-[var(--app-muted)]/40 mt-0.5 shrink-0" />
          <span :class="c.done ? 'text-[var(--app-muted)] line-through' : (isRunning && i === doneCount ? 'text-[var(--app-foreground)]' : 'text-[var(--app-muted)]')">
            {{ c.text }}
          </span>
        </div>
      </div>
    </div>

    <!-- Files section -->
    <div class="flex-1 overflow-auto">
      <div class="px-3 py-2 flex items-center justify-between">
        <span class="text-[11px] font-semibold uppercase tracking-wider text-[var(--app-muted)]">Files</span>
        <span class="text-[10px] text-[var(--app-muted)]">{{ createdFiles.length + readFiles.length }}</span>
      </div>

      <div v-if="createdFiles.length > 0" class="px-3 pb-2">
        <div class="text-[10px] font-semibold uppercase tracking-wider text-green-500 mb-1">Created</div>
        <div v-for="f in createdFiles" :key="f" class="text-[11px] text-green-400 py-0.5 flex items-center gap-1">
          <span class="text-green-500">+</span> {{ f }}
        </div>
      </div>

      <div v-if="readFiles.length > 0" class="px-3 pb-2">
        <div class="text-[10px] font-semibold uppercase tracking-wider text-[var(--app-muted)] mb-1">Read</div>
        <div v-for="f in readFiles" :key="f" class="text-[11px] text-[var(--app-muted)] py-0.5 flex items-center gap-1">
          <span class="text-[var(--app-muted)]/50">&bull;</span> {{ f }}
        </div>
      </div>

      <div v-if="createdFiles.length === 0 && readFiles.length === 0" class="px-3 py-8 text-center">
        <p class="text-xs text-[var(--app-muted)]/50">Files touched by Coder will appear here.</p>
      </div>
    </div>

    <!-- Status -->
    <div v-if="isRunning" class="shrink-0 px-3 py-2 border-t border-[var(--app-border)]">
      <div class="flex items-center gap-1.5 text-[11px] text-[var(--app-accent)]">
        <span class="size-1.5 rounded-full bg-[var(--app-accent)] animate-pulse" />
        Running
      </div>
    </div>
  </div>
</template>
