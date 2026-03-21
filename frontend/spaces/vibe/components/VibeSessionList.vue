<script setup lang="ts">
import { computed } from 'vue'
import type { VibeStoredSession } from '../composables/useVibe'
import { getVibeSessionProjectKey } from '../utils/sessionProject'

const props = defineProps<{
  sessions: VibeStoredSession[]
  isLoading: boolean
}>()

const emit = defineEmits<{
  'open': [sessionId: string]
  'delete': [sessionId: string]
  'refresh': []
}>()

interface ProjectGroup {
  key: string
  name: string
  goals: VibeStoredSession[]
  latestGoal: string
  updatedAt: string
}

const grouped = computed<ProjectGroup[]>(() => {
  const map = new Map<string, ProjectGroup>()
  for (const s of props.sessions) {
    const key = getVibeSessionProjectKey({
      id: s.id,
      project_id: s.project_id,
      project_path: s.project_path,
      project_name: s.project_name,
    })
    const existing = map.get(key)
    if (existing) {
      existing.goals.push(s)
      continue
    }
    map.set(key, {
      key,
      name: s.project_name || 'Global',
      goals: [s],
      latestGoal: s.goal || 'Untitled',
      updatedAt: s.updated_at || '',
    })
  }
  return Array.from(map.values())
})

function formatTime(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function allComplete(goals: VibeStoredSession[]): boolean {
  return goals.every(g => g.status === 'complete')
}

function hasFailed(goals: VibeStoredSession[]): boolean {
  return goals.some(g => g.status === 'failed' || g.status === 'cancelled' || g.status === 'canceled')
}
</script>

<template>
  <div class="flex flex-col h-full border-l border-app bg-black/10">
    <div class="shrink-0 border-b border-app px-5 py-4">
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-[11px] uppercase tracking-[0.16em] text-app-muted/70">Recent Sessions</p>
          <p class="mt-1 text-xs text-app-muted">Resume a previous Vibe run.</p>
        </div>
        <button
          class="rounded-lg border border-app bg-white/5 px-2.5 py-1 text-[11px] font-medium text-app transition hover:bg-white/8"
          :disabled="isLoading"
          @click="emit('refresh')"
        >
          <Icon name="i-lucide-refresh-cw" class="size-3 inline mr-1" />
          Refresh
        </button>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto px-4 py-4">
      <div v-if="isLoading" class="rounded-2xl border border-dashed border-app bg-black/10 px-4 py-3 text-sm text-app-muted">
        Loading sessions...
      </div>

      <div v-else-if="grouped.length === 0" class="rounded-2xl border border-dashed border-app bg-black/10 px-4 py-3 text-sm text-app-muted">
        No saved sessions yet.
      </div>

      <div v-else class="space-y-3">
        <article
          v-for="group in grouped"
          :key="group.key"
          class="rounded-2xl border border-app bg-black/10 px-4 py-3 transition hover:bg-white/[0.04] cursor-pointer"
          @click="emit('open', group.goals[0]!.id)"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-app">{{ group.name }}</p>
              <p class="mt-0.5 text-[11px] text-app-muted truncate">{{ group.latestGoal }}</p>
              <p class="mt-1 text-[10px] text-app-muted/50">
                {{ group.goals.length }} goal{{ group.goals.length !== 1 ? 's' : '' }} · {{ formatTime(group.updatedAt) }}
              </p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <span
                class="rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em]"
                :class="hasFailed(group.goals) ? 'bg-red-500/10 text-red-300' : allComplete(group.goals) ? 'bg-[#00cc34]/10 text-[#33ff6a]' : 'bg-white/8 text-app-muted'"
              >
                {{ hasFailed(group.goals) ? 'failed' : allComplete(group.goals) ? 'complete' : 'active' }}
              </span>
              <button
                class="rounded-lg border border-red-500/20 bg-red-500/10 p-1 text-red-300 transition hover:bg-red-500/15"
                title="Delete all sessions for this project"
                @click.stop="group.goals.forEach(g => emit('delete', g.id))"
              >
                <Icon name="i-lucide-trash-2" class="size-3" />
              </button>
            </div>
          </div>
        </article>
      </div>
    </div>
  </div>
</template>
