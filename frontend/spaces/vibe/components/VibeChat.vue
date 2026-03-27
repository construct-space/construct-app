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
import AgentInput from '@/components/agent/AgentInput.vue'
import type { RequestBlock } from '@/operator/useAgentSession'

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
  'stop': []
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

// Interleave messages + progress updates into one stream
interface StreamItem {
  id: string
  type: 'user' | 'assistant' | 'status'
  content: string
}

const streamedItems = computed<StreamItem[]>(() => {
  const items: StreamItem[] = []

  for (const msg of displayMessages.value) {
    items.push({
      id: msg.id,
      type: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content,
    })
  }

  // Append progress updates as inline status items
  for (const update of props.progressUpdates) {
    items.push({
      id: `progress-${update.id}`,
      type: 'status',
      content: update.headline + (update.detail ? ` — ${update.detail}` : ''),
    })
  }

  return items
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

// Auto-scroll on new content (messages + progress + text streaming)
watch(
  () => {
    const items = streamedItems.value
    const last = items[items.length - 1]
    return `${items.length}-${last?.content.length || 0}`
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
          <span class="size-1.5 rounded-full bg-[var(--app-accent)] animate-pulse" />
          <span>{{ liveStatus }}</span>
        </div>
      </template>

      <!-- Empty: done -->
      <template v-else-if="displayMessages.length === 0 && isDone && toolCount > 0">
        <div class="rounded-xl border border-[var(--app-accent)]/15 bg-[var(--app-accent)]/[0.04] p-4">
          <div class="flex items-center gap-2 mb-2">
            <Icon name="i-lucide-check-circle" class="size-4 text-[var(--app-accent)]" />
            <p class="text-sm font-medium text-app">Done</p>
          </div>
          <p class="text-xs text-app-muted/70">{{ toolCount }} tool calls completed.</p>
        </div>
      </template>

      <!-- Interleaved messages + progress — everything streams in order -->
      <template v-for="item in streamedItems" :key="item.id">
        <!-- User message -->
        <div v-if="item.type === 'user'" class="flex justify-end">
          <div class="rounded-2xl bg-app-accent/15 text-app px-4 py-2 text-sm max-w-[80%]">
            {{ item.content }}
          </div>
        </div>

        <!-- Assistant narration (markdown) -->
        <div v-else-if="item.type === 'assistant'" class="text-sm leading-relaxed prose prose-sm prose-invert max-w-none" v-html="renderMarkdown(item.content)" />

        <!-- Progress/status update (streams inline) -->
        <div v-else-if="item.type === 'status'" class="flex items-start gap-2 text-xs text-app-muted/70 py-0.5">
          <span class="size-1.5 rounded-full bg-[var(--app-accent)]/60 mt-1 shrink-0" />
          <span>{{ item.content }}</span>
        </div>
      </template>

      <!-- Live working indicator -->
      <div v-if="isWorking" class="flex items-center gap-2 text-xs text-app-muted py-1">
        <span class="size-1.5 rounded-full bg-[var(--app-accent)] animate-pulse" />
        <span>{{ liveStatus }}</span>
      </div>
    </div>

    <!-- Completion controls -->
    <div v-if="isDone && projectPath && !isRunning" class="shrink-0 px-4 py-2 border-t border-app">
      <div class="flex flex-wrap items-center gap-2">
        <template v-if="isConstructSpace">
          <button
            class="rounded-xl bg-[var(--app-accent)] px-4 py-2 text-xs font-semibold text-black transition hover:bg-[var(--app-accent)] disabled:opacity-50"
            :disabled="spaceActionStarting"
            @click="emit('space-open')"
          >
            {{ spaceActionStarting ? 'Opening...' : 'Open Space' }}
          </button>
        </template>
        <template v-else-if="!previewRunning && !previewUrl">
          <button
            class="rounded-xl bg-[var(--app-accent)] px-4 py-2 text-xs font-semibold text-black transition hover:bg-[var(--app-accent)] disabled:opacity-50"
            :disabled="previewStarting"
            @click="emit('preview-start')"
          >
            {{ previewStarting ? 'Starting...' : 'Run' }}
          </button>
        </template>
        <template v-else-if="previewUrl">
          <span class="text-xs text-[var(--app-accent)] font-mono">{{ previewUrl }}</span>
          <button class="rounded-xl bg-[var(--app-accent)] px-3 py-2 text-xs font-semibold text-black" @click="emit('preview-open')">Open</button>
          <button class="rounded-lg border border-red-500/20 bg-red-500/10 px-2 py-1.5 text-xs text-red-300" @click="emit('preview-stop')">Stop</button>
        </template>
      </div>
      <p v-if="completionActionError" class="mt-2 text-xs text-red-300">{{ completionActionError }}</p>
    </div>

    <!-- Input -->
    <div class="shrink-0 flex justify-center">
      <div class="w-full max-w-2xl">
        <AgentInput
          :loading="isRunning"
          :placeholder="isDone && !isRunning ? 'Follow up or change direction...' : 'Describe what to build...'"
          @send="(blocks: RequestBlock[]) => { const text = blocks.filter((b: RequestBlock) => b.type === 'text').map((b: RequestBlock) => (b as any).content).join('\n'); emit('update:draft', text); nextTick(() => emit('submit')) }"
          @stop="emit('stop')"
        />
      </div>
    </div>
  </div>
</template>
