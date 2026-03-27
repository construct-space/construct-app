<script setup lang="ts">
import { computed, ref } from 'vue'
import { Zap, Square, Play, Loader2, ChevronDown, Box, AppWindow, Plus } from 'lucide-vue-next'
import type { VibeStoredSession } from '../composables/useVibe'
import { vibeStatusBadgeClass } from '../composables/useVibeFormat'

const props = defineProps<{
  projectName: string
  statusLabel: string
  isRunning: boolean
  isConstructSpace: boolean
  previewUrl: string
  previewStarting: boolean
  previewRunning: boolean
  spaceActionStarting: boolean
  projectPath: string
  isDone: boolean
  savedSessions: VibeStoredSession[]
  currentSessionId: string
}>()

const emit = defineEmits<{
  'new-goal': []
  'new-project': []
  'reset': []
  'stop': []
  'preview-start': []
  'preview-open': []
  'preview-stop': []
  'space-open': []
  'switch-session': [sessionId: string]
}>()

const showGoalMenu = ref(false)
const statusBadgeClass = computed(() => vibeStatusBadgeClass(props.statusLabel))

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max).trimEnd() + '…'
}
</script>

<template>
  <div class="flex items-center justify-between px-4 py-2 border-b border-[var(--app-border)]">
    <!-- Left: project + status -->
    <div class="flex items-center gap-2.5 min-w-0">
      <Zap class="size-4 text-[var(--app-accent)] shrink-0" />
      <span v-if="projectName" class="text-sm font-semibold text-[var(--app-foreground)] truncate">{{ projectName }}</span>
      <span class="shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider" :class="statusBadgeClass">
        {{ statusLabel }}
      </span>
    </div>

    <!-- Right: actions -->
    <div class="flex items-center gap-2 shrink-0">
      <!-- Goal switcher -->
      <div v-if="savedSessions.length > 1" class="relative">
        <button
          class="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-[var(--app-muted)] transition hover:text-[var(--app-foreground)] hover:bg-[color-mix(in_srgb,var(--app-foreground)_5%,transparent)]"
          @click="showGoalMenu = !showGoalMenu"
        >
          {{ savedSessions.length }} goals
          <ChevronDown class="size-3" />
        </button>
        <div v-if="showGoalMenu" class="fixed inset-0 z-40" @click="showGoalMenu = false" />
        <div
          v-if="showGoalMenu"
          class="absolute right-0 top-full mt-1 z-50 w-72 rounded-lg border border-[var(--app-border)] bg-[var(--app-background)] shadow-xl overflow-hidden"
        >
          <div
            v-for="s in savedSessions" :key="s.id"
            class="flex items-center gap-2 px-3 py-2 text-xs cursor-pointer transition"
            :class="s.id === currentSessionId ? 'bg-[var(--app-accent)]/10 text-[var(--app-accent)]' : 'text-[var(--app-muted)] hover:bg-[color-mix(in_srgb,var(--app-foreground)_5%,transparent)] hover:text-[var(--app-foreground)]'"
            @click="emit('switch-session', s.id); showGoalMenu = false"
          >
            <span class="truncate flex-1">{{ truncate(s.goal || 'Untitled', 50) }}</span>
            <span v-if="s.id === currentSessionId" class="text-[9px] text-[var(--app-accent)]/60">current</span>
          </div>
        </div>
      </div>

      <button
        class="rounded-md px-2.5 py-1 text-[11px] font-medium text-[var(--app-muted)] transition hover:text-[var(--app-foreground)] hover:bg-[color-mix(in_srgb,var(--app-foreground)_5%,transparent)]"
        :disabled="isRunning"
        @click="emit('new-goal')"
      >
        New Goal
      </button>

      <!-- Stop -->
      <button v-if="isRunning"
        class="rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[11px] font-medium text-red-400 transition hover:bg-red-500/15"
        @click="emit('stop')"
      >
        <Square class="size-3 inline mr-0.5" />
        Stop
      </button>

      <!-- Done actions -->
      <template v-else-if="isDone && projectPath">
        <button v-if="isConstructSpace"
          class="rounded-md bg-[var(--app-accent)] px-2.5 py-1 text-[11px] font-semibold text-black transition hover:opacity-90 disabled:opacity-50"
          :disabled="spaceActionStarting"
          @click="emit('space-open')"
        >
          <Loader2 v-if="spaceActionStarting" class="size-3 inline mr-0.5 animate-spin" />
          <Box v-else class="size-3 inline mr-0.5" />
          {{ spaceActionStarting ? 'Opening...' : 'Open Space' }}
        </button>
        <template v-else-if="previewUrl">
          <span class="text-[11px] text-[var(--app-accent)] font-mono">{{ previewUrl }}</span>
          <button class="rounded-md bg-[var(--app-accent)] px-2.5 py-1 text-[11px] font-semibold text-black transition hover:opacity-90" @click="emit('preview-open')">
            <AppWindow class="size-3 inline mr-0.5" />
            Preview
          </button>
          <button class="rounded-md border border-red-500/20 bg-red-500/10 px-1.5 py-1 text-red-400 transition hover:bg-red-500/15" @click="emit('preview-stop')">
            <Square class="size-3" />
          </button>
        </template>
        <button v-else
          class="rounded-md bg-[var(--app-accent)] px-2.5 py-1 text-[11px] font-semibold text-black transition hover:opacity-90 disabled:opacity-50"
          :disabled="previewStarting"
          @click="emit('preview-start')"
        >
          <Loader2 v-if="previewStarting" class="size-3 inline mr-0.5 animate-spin" />
          <Play v-else class="size-3 inline mr-0.5" />
          {{ previewStarting ? 'Starting...' : 'Run' }}
        </button>
      </template>
    </div>
  </div>
</template>
