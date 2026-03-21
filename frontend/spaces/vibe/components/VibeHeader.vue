<script setup lang="ts">
import { computed, ref } from 'vue'
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
  if (text.length <= max) return text
  return text.slice(0, max).trimEnd() + '…'
}
</script>

<template>
  <div class="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-app bg-black/10">
    <div class="flex items-center gap-3 min-w-0">
      <div class="flex items-center gap-1.5 rounded-full border border-[#00ff41]/20 bg-[#00ff41]/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#33ff6a]">
        <Icon name="i-lucide-zap" class="size-3" />
        Vibe
      </div>
      <span v-if="projectName" class="text-sm font-medium text-app truncate">{{ projectName }}</span>
      <span class="shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em]" :class="statusBadgeClass">
        {{ statusLabel }}
      </span>

      <!-- Goal switcher (when multiple sessions exist) -->
      <template v-if="savedSessions.length > 1">
        <div class="relative">
          <button
            class="flex items-center gap-1 rounded-lg border border-app bg-white/5 px-2 py-1 text-[10px] text-app-muted transition hover:bg-white/8 hover:text-app"
            @click="showGoalMenu = !showGoalMenu"
          >
            <Icon name="i-lucide-list" class="size-3" />
            {{ savedSessions.length }} goals
            <Icon name="i-lucide-chevron-down" class="size-3" />
          </button>
          <div
            v-if="showGoalMenu"
            class="absolute left-0 top-full mt-1 z-50 w-72 rounded-xl border border-app bg-[var(--app-background)] shadow-xl overflow-hidden"
          >
            <div
              v-for="s in savedSessions"
              :key="s.id"
              class="flex items-center gap-2 px-3 py-2 text-xs cursor-pointer transition"
              :class="s.id === currentSessionId ? 'bg-[#00ff41]/10 text-[#66ff93]' : 'text-app-muted hover:bg-white/5 hover:text-app'"
              @click="emit('switch-session', s.id); showGoalMenu = false"
            >
              <Icon
                :name="s.status === 'complete' ? 'i-lucide-check-circle' : s.status === 'failed' || s.status === 'cancelled' || s.status === 'canceled' ? 'i-lucide-x-circle' : 'i-lucide-circle'"
                class="size-3 shrink-0"
                :class="s.status === 'complete' ? 'text-[#00ff41]' : s.status === 'failed' || s.status === 'cancelled' || s.status === 'canceled' ? 'text-red-400' : 'text-app-muted/50'"
              />
              <span class="truncate flex-1">{{ truncate(s.goal || 'Untitled', 50) }}</span>
              <span v-if="s.id === currentSessionId" class="text-[9px] text-[#33ff6a]/60">current</span>
            </div>
          </div>
        </div>
        <!-- Click-outside to close -->
        <div v-if="showGoalMenu" class="fixed inset-0 z-40" @click="showGoalMenu = false" />
      </template>

      <button
        class="rounded-lg border border-app bg-white/5 px-2.5 py-1 text-[11px] font-medium text-app transition hover:bg-white/8"
        :disabled="isRunning"
        @click="emit('new-goal')"
      >
        New Goal
      </button>
      <button
        class="rounded-lg border border-app bg-white/5 px-2 py-1 text-[11px] text-app-muted transition hover:bg-white/8"
        :disabled="isRunning"
        title="Start a new project"
        @click="emit('new-project')"
      >
        <Icon name="i-lucide-folder-plus" class="size-3" />
      </button>
    </div>

    <!-- Right side: completion actions -->
    <div class="flex items-center gap-2 shrink-0">
      <template v-if="isRunning">
        <button
          class="rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-[11px] font-semibold text-red-200 transition hover:bg-red-500/15"
          @click="emit('stop')"
        >
          <Icon name="i-lucide-square" class="size-3 inline mr-0.5" />
          Stop
        </button>
      </template>
      <template v-else-if="isDone && projectPath">
        <button
          v-if="isConstructSpace"
          class="rounded-lg bg-[#00ff41] px-2.5 py-1 text-[11px] font-semibold text-black transition hover:bg-[#33ff6a] disabled:opacity-50"
          :disabled="spaceActionStarting"
          @click="emit('space-open')"
        >
          <Icon v-if="spaceActionStarting" name="i-lucide-loader-2" class="size-3 inline mr-0.5 animate-spin" />
          <Icon v-else name="i-lucide-box" class="size-3 inline mr-0.5" />
          {{ spaceActionStarting ? 'Opening...' : 'Open Space in Construct Dev' }}
        </button>
        <template v-else-if="previewUrl">
          <span class="text-[11px] text-[#00ff41] font-mono">{{ previewUrl }}</span>
          <button
            class="rounded-lg bg-[#00ff41] px-2.5 py-1 text-[11px] font-semibold text-black transition hover:bg-[#33ff6a]"
            @click="emit('preview-open')"
          >
            <Icon name="i-lucide-app-window" class="size-3 inline mr-0.5" />
            Open Preview
          </button>
          <button
            class="rounded-lg border border-red-500/20 bg-red-500/10 px-1.5 py-1 text-red-300 transition hover:bg-red-500/15"
            @click="emit('preview-stop')"
          >
            <Icon name="i-lucide-square" class="size-3" />
          </button>
        </template>
        <button
          v-else
          class="rounded-lg bg-[#00ff41] px-2.5 py-1 text-[11px] font-semibold text-black transition hover:bg-[#33ff6a] disabled:opacity-50"
          :disabled="previewStarting"
          @click="emit('preview-start')"
        >
          <Icon v-if="previewStarting" name="i-lucide-loader-2" class="size-3 inline mr-0.5 animate-spin" />
          <Icon v-else name="i-lucide-play" class="size-3 inline mr-0.5" />
          {{ previewStarting ? 'Starting...' : 'Run' }}
        </button>
      </template>
    </div>
  </div>
</template>
