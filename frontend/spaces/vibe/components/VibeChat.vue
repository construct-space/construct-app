<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue'
import type { ProgressUpdate, ToolActivity } from '@/operator/useStreamStatus'
import type { VibeUiMessage } from '../composables/useVibe'
import VibeMessage from './VibeMessage.vue'
import VibeInput from './VibeInput.vue'

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
  toolHistory: readonly ToolActivity[]
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
const userScrolledUp = ref(false)

// Filter out first user message if it matches the goal (shown in header)
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

const isLastMessageStreaming = computed(() => {
  if (!props.isRunning) return false
  const last = props.messages[props.messages.length - 1]
  return last?.role === 'assistant'
})

const liveProgressUpdates = computed(() => props.progressUpdates)

const fallbackLiveHeadline = computed(() => {
  const operatorUpdate = props.statusUpdate.trim()
  if (operatorUpdate) return operatorUpdate

  const message = props.statusMessage.trim()
  if (message && message !== 'Done' && message !== 'Thinking…' && message !== 'Thinking...') {
    return message
  }

  const normalizedStatus = props.sessionStatus.toLowerCase()
  if (normalizedStatus.includes('plan')) return "I'm planning the next implementation steps."
  if (normalizedStatus.includes('implement')) return "I'm implementing the current milestone."
  if (normalizedStatus.includes('review') || normalizedStatus.includes('verify')) return "I'm reviewing and verifying the latest changes."
  if (props.statusState === 'thinking') return "I'm thinking through the next step."
  if (props.isRunning) return "I'm working through the current goal."
  return ''
})

function onScroll() {
  if (!scrollRef.value) return
  const { scrollTop, scrollHeight, clientHeight } = scrollRef.value
  userScrolledUp.value = scrollHeight - scrollTop - clientHeight > 60
}

watch(() => props.messages.length, () => {
  if (userScrolledUp.value) return
  void nextTick(() => {
    scrollRef.value?.scrollTo({ top: scrollRef.value.scrollHeight, behavior: 'smooth' })
  })
})

watch(() => props.progressUpdates.length, () => {
  if (userScrolledUp.value) return
  void nextTick(() => {
    scrollRef.value?.scrollTo({ top: scrollRef.value.scrollHeight, behavior: 'smooth' })
  })
})

watch(
  () => props.messages[props.messages.length - 1]?.content,
  () => {
    if (userScrolledUp.value) return
    void nextTick(() => {
      scrollRef.value?.scrollTo({ top: scrollRef.value.scrollHeight, behavior: 'smooth' })
    })
  },
)
</script>

<template>
  <div class="flex flex-col h-full">
    <div
      ref="scrollRef"
      class="flex-1 overflow-y-auto scroll-smooth px-4 py-3 space-y-3"
      @scroll="onScroll"
    >
      <!-- Working state: no messages yet, session in progress -->
      <template v-if="displayMessages.length === 0 && isWorking && liveProgressUpdates.length === 0">
        <div class="mr-8 rounded-2xl border border-app bg-white/[0.03] px-4 py-3">
          <div class="mb-1.5 flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-app-muted/60">
            <span>Vibe</span>
            <span class="size-1.5 rounded-full bg-[#00ff41] animate-pulse" />
            <span class="text-[#66ff93]/80">Live</span>
          </div>
          <p class="text-sm leading-6 text-app">{{ fallbackLiveHeadline || "I'm working through the current goal." }}</p>
          <p v-if="toolCount > 0" class="mt-2 text-xs text-app-muted/45">{{ toolCount }} tool call{{ toolCount === 1 ? '' : 's' }} so far</p>
        </div>
      </template>

      <!-- Done state: no assistant messages, but session completed -->
      <template v-else-if="displayMessages.length === 0 && isDone && toolCount > 0">
        <div class="rounded-2xl border border-[#00ff41]/15 bg-[#00ff41]/[0.04] p-5">
          <div class="flex items-center gap-2 mb-2">
            <Icon name="i-lucide-check-circle" class="size-4 text-[#00ff41]" />
            <p class="text-sm font-medium text-app">Session complete</p>
          </div>
          <p class="text-xs text-app-muted/70">Completed {{ toolCount }} tool calls. Check the activity panel for details.</p>

          <!-- Completion controls -->
          <div v-if="projectPath" class="mt-4 flex flex-wrap items-center gap-2">
            <template v-if="isConstructSpace">
              <button
                class="rounded-xl bg-[#00ff41] px-4 py-2 text-xs font-semibold text-black transition hover:bg-[#33ff6a] disabled:opacity-50"
                :disabled="spaceActionStarting"
                @click="emit('space-open')"
              >
                <Icon v-if="spaceActionStarting" name="i-lucide-loader-2" class="size-3 inline mr-1 animate-spin" />
                <Icon v-else name="i-lucide-box" class="size-3 inline mr-1" />
                {{ spaceActionStarting ? 'Opening...' : 'Open Space in Construct Dev' }}
              </button>
            </template>
            <template v-else-if="!previewRunning && !previewUrl">
              <button
                class="rounded-xl bg-[#00ff41] px-4 py-2 text-xs font-semibold text-black transition hover:bg-[#33ff6a] disabled:opacity-50"
                :disabled="previewStarting"
                @click="emit('preview-start')"
              >
                <Icon v-if="previewStarting" name="i-lucide-loader-2" class="size-3 inline mr-1 animate-spin" />
                <Icon v-else name="i-lucide-play" class="size-3 inline mr-1" />
                {{ previewStarting ? 'Starting...' : 'Run' }}
              </button>
            </template>
            <template v-else-if="previewUrl">
              <span class="text-xs text-[#00ff41] font-mono">{{ previewUrl }}</span>
              <button
                class="rounded-xl bg-[#00ff41] px-3 py-2 text-xs font-semibold text-black transition hover:bg-[#33ff6a]"
                @click="emit('preview-open')"
              >
                <Icon name="i-lucide-app-window" class="size-3 inline mr-1" />
                Open Preview
              </button>
              <button
                class="rounded-lg border border-red-500/20 bg-red-500/10 px-2 py-1.5 text-xs text-red-300 transition hover:bg-red-500/15"
                @click="emit('preview-stop')"
              >
                <Icon name="i-lucide-square" class="size-3" />
              </button>
            </template>
          </div>
          <p v-if="completionActionError" class="mt-2 text-xs text-red-300">{{ completionActionError }}</p>

          <p class="mt-3 text-xs text-app-muted/50">Type a follow-up below to continue working on this project.</p>
        </div>
      </template>

      <!-- Idle: nothing happened -->
      <template v-else-if="displayMessages.length === 0">
        <div class="rounded-2xl border border-dashed border-app bg-white/[0.02] p-5 text-center">
          <p class="text-sm text-app-muted/60">Response will appear here when Vibe finishes.</p>
        </div>
      </template>

      <!-- Messages -->
      <VibeMessage
        v-for="(msg, i) in displayMessages"
        :key="msg.id"
        :role="msg.role"
        :content="msg.content"
        :is-streaming="isLastMessageStreaming && i === displayMessages.length - 1"
      />

      <div
        v-for="update in liveProgressUpdates"
        :key="update.id"
        class="mr-8 rounded-2xl border border-app bg-white/[0.03] px-4 py-3"
      >
        <div class="mb-1.5 flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-app-muted/60">
          <span>Vibe</span>
          <span class="size-1.5 rounded-full bg-[#00ff41] animate-pulse" />
          <span class="text-[#66ff93]/80">Live</span>
        </div>
        <p class="text-sm leading-6 text-app">{{ update.headline }}</p>
        <p v-if="update.detail" class="mt-1 text-xs text-app-muted/60">{{ update.detail }}</p>
      </div>
    </div>

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
