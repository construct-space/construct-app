<script setup lang="ts">
/**
 * VibeChat — Left panel: text narration only.
 * Tool calls are shown in VibeActivity (right panel).
 * Uses markdown rendering for assistant text.
 */
import { ref, computed, watch, nextTick } from 'vue'
import type { ProgressUpdate } from '@/operator/useStreamStatus'
import type { VibeUiMessage } from '../composables/useVibe'
import { useMarkdown } from '@/composables/useMarkdown'
import VibeInput from './VibeInput.vue'

const { renderMarkdown } = useMarkdown()

const props = defineProps<{
  messages: VibeUiMessage[]
  draft: string
  isRunning: boolean
  queueCount: number
  error: string
  goal: string
  toolCount: number
  isDone: boolean
  statusMessage: string
  statusUpdate: string
  statusState: string
  sessionStatus: string
  projectPath: string
  isConstructSpace: boolean
  previewUrl: string
  previewStarting: boolean
  previewRunning: boolean
  spaceActionStarting: boolean
  completionActionError: string
  progressUpdates: readonly ProgressUpdate[]
}>()

const isWorking = computed(() => props.isRunning || ['implementing', 'planning', 'setting_up', 'researching', 'verifying', 'reviewing', 'running'].includes(props.sessionStatus))

const emit = defineEmits<{
  'update:draft': [value: string]
  'submit': []
  'preview-start': []
  'preview-open': []
  'preview-stop': []
  'space-open': []
}>()

const scrollRef = ref<HTMLElement>()

// Filter: skip first user message if it matches the goal
const displayMessages = computed(() => {
  const msgs = props.messages
  if (msgs.length > 0 && msgs[0].role === 'user') {
    const goal = props.goal.trim()
    if (goal && msgs[0].content.trim() === goal) {
      return msgs.slice(1)
    }
  }
  return msgs
})

// Status text
const liveStatus = computed(() => {
  const update = props.statusUpdate.trim()
  if (update) return update
  const msg = props.statusMessage.trim()
  if (msg && msg !== 'Done') return msg
  if (isWorking.value) return 'Working...'
  return ''
})

// Auto-scroll on new content
watch(
  () => {
    const len = displayMessages.value.length
    const last = displayMessages.value[len - 1]
    return `${len}-${last?.content.length || 0}-${props.progressUpdates.length}`
  },
  () => {
    nextTick(() => {
      if (scrollRef.value) {
        scrollRef.value.scrollTop = scrollRef.value.scrollHeight
      }
    })
  },
)
</script>

<template>
  <div class="flex flex-col h-full">
    <div
      ref="scrollRef"
      class="flex-1 overflow-y-auto scroll-smooth px-4 py-3 space-y-3"
    >
      <!-- Empty: working but no text yet -->
      <template v-if="displayMessages.length === 0 && isWorking">
        <div class="flex items-center gap-2 text-sm text-app-muted py-2">
          <span class="size-1.5 rounded-full bg-[#00ff41] animate-pulse" />
          <span>{{ liveStatus }}</span>
        </div>
      </template>

      <!-- Empty: done -->
      <template v-else-if="displayMessages.length === 0 && isDone && toolCount > 0">
        <div class="rounded-xl border border-[#00ff41]/15 bg-[#00ff41]/[0.04] p-4">
          <div class="flex items-center gap-2 mb-2">
            <Icon name="i-lucide-check-circle" class="size-4 text-[#00ff41]" />
            <p class="text-sm font-medium text-app">Done</p>
          </div>
          <p class="text-xs text-app-muted/70">{{ toolCount }} tool calls completed.</p>
        </div>
      </template>

      <!-- Messages (text only — tools are in the right panel) -->
      <template v-for="msg in displayMessages" :key="msg.id">
        <!-- User message -->
        <div v-if="msg.role === 'user'" class="flex justify-end">
          <div class="rounded-2xl bg-app-accent/15 text-app px-4 py-2 text-sm max-w-[80%]">
            {{ msg.content }}
          </div>
        </div>

        <!-- Assistant narration -->
        <div v-else class="text-sm leading-relaxed prose prose-sm prose-invert max-w-none" v-html="renderMarkdown(msg.content)" />
      </template>

      <!-- Live progress -->
      <div v-for="update in progressUpdates" :key="update.id" class="flex items-start gap-2 text-sm text-app-muted py-1">
        <span class="size-1.5 rounded-full bg-[#00ff41] animate-pulse mt-1.5 shrink-0" />
        <div>
          <span>{{ update.headline }}</span>
          <span v-if="update.detail" class="text-app-muted/60 ml-1">{{ update.detail }}</span>
        </div>
      </div>

      <!-- Working indicator -->
      <div v-if="isWorking && displayMessages.length > 0" class="flex items-center gap-2 text-xs text-app-muted py-1">
        <span class="size-1.5 rounded-full bg-[#00ff41] animate-pulse" />
        <span>{{ liveStatus }}</span>
      </div>
    </div>

    <!-- Completion controls -->
    <div v-if="isDone && projectPath && !isRunning" class="shrink-0 px-4 py-2 border-t border-app">
      <div class="flex flex-wrap items-center gap-2">
        <template v-if="isConstructSpace">
          <button
            class="rounded-xl bg-[#00ff41] px-4 py-2 text-xs font-semibold text-black transition hover:bg-[#33ff6a] disabled:opacity-50"
            :disabled="spaceActionStarting"
            @click="emit('space-open')"
          >
            {{ spaceActionStarting ? 'Opening...' : 'Open Space' }}
          </button>
        </template>
        <template v-else-if="!previewRunning && !previewUrl">
          <button
            class="rounded-xl bg-[#00ff41] px-4 py-2 text-xs font-semibold text-black transition hover:bg-[#33ff6a] disabled:opacity-50"
            :disabled="previewStarting"
            @click="emit('preview-start')"
          >
            {{ previewStarting ? 'Starting...' : 'Run' }}
          </button>
        </template>
        <template v-else-if="previewUrl">
          <span class="text-xs text-[#00ff41] font-mono">{{ previewUrl }}</span>
          <button class="rounded-xl bg-[#00ff41] px-3 py-2 text-xs font-semibold text-black" @click="emit('preview-open')">Open</button>
          <button class="rounded-lg border border-red-500/20 bg-red-500/10 px-2 py-1.5 text-xs text-red-300" @click="emit('preview-stop')">Stop</button>
        </template>
      </div>
      <p v-if="completionActionError" class="mt-2 text-xs text-red-300">{{ completionActionError }}</p>
    </div>

    <!-- Input -->
    <div class="shrink-0 px-4 py-3 border-t border-app">
      <VibeInput
        :model-value="draft"
        :is-running="isRunning"
        :queue-count="queueCount"
        :placeholder="isDone && !isRunning ? 'Follow up or change direction...' : undefined"
        @update:model-value="emit('update:draft', $event)"
        @submit="emit('submit')"
      />
    </div>
  </div>
</template>
