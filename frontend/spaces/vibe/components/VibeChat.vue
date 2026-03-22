<script setup lang="ts">
/**
 * VibeChat — block-based chat view for Vibe sessions.
 * Uses AgentView for rendering turns with tool cards, text blocks, etc.
 * Converts Vibe's flat messages + tool history into Turn[] structure.
 */
import { computed } from 'vue'
import type { ProgressUpdate, ToolActivity } from '@/operator/useStreamStatus'
import type { Turn, TextBlock, ToolBlock, StatusBlock, ResponseBlock } from '@/operator/useAgentSession'
import type { VibeUiMessage } from '../composables/useVibe'
import AgentView from '@/components/agent/AgentView.vue'
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

/**
 * Convert Vibe's flat messages + tool history into Turn[] for AgentView.
 * Groups consecutive user→assistant messages into turns.
 * Interleaves tool calls from toolHistory into response blocks.
 */
const turns = computed<Turn[]>(() => {
  const result: Turn[] = []
  const msgs = props.messages

  // Skip first user message if it matches the goal (shown in header)
  let startIdx = 0
  if (msgs.length > 0 && msgs[0].role === 'user') {
    const goal = props.goal.trim()
    if (goal && msgs[0].content.trim() === goal) {
      startIdx = 1
    }
  }

  let i = startIdx
  while (i < msgs.length) {
    const msg = msgs[i]

    if (msg.role === 'user') {
      // Start a new turn with user request
      const requestBlocks: TextBlock[] = [{ type: 'text', content: msg.content }]
      const responseBlocks: ResponseBlock[] = []
      i++

      // Collect all following assistant messages as response
      while (i < msgs.length && msgs[i].role === 'assistant') {
        responseBlocks.push({ type: 'text', content: msgs[i].content })
        i++
      }

      result.push({
        id: msg.id,
        request: requestBlocks,
        response: responseBlocks,
        agentId: 'vibe',
        status: (i >= msgs.length && props.isRunning) ? 'streaming' : 'done',
        timestamp: Date.now(),
      })
    } else {
      // Assistant message without preceding user message (continuation)
      const responseBlocks: ResponseBlock[] = [{ type: 'text', content: msg.content }]
      i++

      while (i < msgs.length && msgs[i].role === 'assistant') {
        responseBlocks.push({ type: 'text', content: msgs[i].content })
        i++
      }

      result.push({
        id: msg.id,
        request: [],
        response: responseBlocks,
        agentId: 'vibe',
        status: (i >= msgs.length && props.isRunning) ? 'streaming' : 'done',
        timestamp: Date.now(),
      })
    }
  }

  // If running with tool calls but no messages yet, create a synthetic turn
  // showing tool activity
  if (result.length === 0 && isWorking.value && props.toolHistory.length > 0) {
    const toolBlocks: ToolBlock[] = props.toolHistory.map(t => ({
      type: 'tool' as const,
      tool: t.tool,
      title: t.tool,
      callId: t.callId || `tool-${t.tool}-${t.startTime}`,
      input: t.input,
      result: t.result,
      state: t.endTime ? (t.error ? 'error' : 'done') : 'running',
    }))
    result.push({
      id: 'vibe-tools',
      request: [],
      response: toolBlocks,
      agentId: 'vibe',
      status: 'streaming',
      timestamp: Date.now(),
    })
  }

  // Inject tool blocks from toolHistory into the last turn's response
  // (only if we have turns and tools that aren't already shown)
  if (result.length > 0 && props.toolHistory.length > 0) {
    const lastTurn = result[result.length - 1]
    const existingToolIds = new Set(
      lastTurn.response.filter((b): b is ToolBlock => b.type === 'tool').map(b => b.callId)
    )
    const newTools: ToolBlock[] = props.toolHistory
      .filter(t => !existingToolIds.has(t.callId || ''))
      .map(t => ({
        type: 'tool' as const,
        tool: t.tool,
        title: t.tool,
        callId: t.callId || `tool-${t.tool}-${t.startTime}`,
        input: t.input,
        result: t.result,
        state: t.endTime ? (t.error ? 'error' : 'done') : 'running',
      }))

    if (newTools.length > 0) {
      // Insert tool blocks before the last text block
      const textBlocks = lastTurn.response.filter(b => b.type === 'text')
      const otherBlocks = lastTurn.response.filter(b => b.type !== 'text')
      lastTurn.response = [...otherBlocks, ...newTools, ...textBlocks]
    }
  }

  // Add progress updates as status blocks in the last turn
  if (result.length > 0 && props.progressUpdates.length > 0) {
    const lastTurn = result[result.length - 1]
    for (const update of props.progressUpdates) {
      lastTurn.response.push({
        type: 'status',
        state: 'thinking',
        message: update.headline + (update.detail ? ` — ${update.detail}` : ''),
      } as StatusBlock)
    }
  }

  return result
})

const vibeStatusMessage = computed(() => {
  if (!isWorking.value) return ''
  const update = props.statusUpdate.trim()
  if (update) return update
  const msg = props.statusMessage.trim()
  if (msg && msg !== 'Done') return msg
  return 'Working...'
})
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Block-based turn renderer -->
    <div class="flex-1 overflow-hidden">
      <AgentView
        :turns="turns"
        :is-loading="isWorking"
        :status-message="vibeStatusMessage"
      />

      <!-- Empty states (when no turns) -->
      <div v-if="turns.length === 0" class="px-4 py-3">
        <!-- Done: no messages but session completed -->
        <div v-if="isDone && toolCount > 0" class="rounded-2xl border border-[#00ff41]/15 bg-[#00ff41]/[0.04] p-5">
          <div class="flex items-center gap-2 mb-2">
            <Icon name="i-lucide-check-circle" class="size-4 text-[#00ff41]" />
            <p class="text-sm font-medium text-app">Session complete</p>
          </div>
          <p class="text-xs text-app-muted/70">Completed {{ toolCount }} tool calls. Check the activity panel for details.</p>
          <p class="mt-3 text-xs text-app-muted/50">Type a follow-up below to continue working on this project.</p>
        </div>

        <!-- Idle -->
        <div v-else-if="!isWorking" class="rounded-2xl border border-dashed border-app bg-white/[0.02] p-5 text-center">
          <p class="text-sm text-app-muted/60">Response will appear here when Vibe finishes.</p>
        </div>
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
            <Icon v-if="spaceActionStarting" name="i-lucide-loader-2" class="size-3 inline mr-1 animate-spin" />
            <Icon v-else name="i-lucide-box" class="size-3 inline mr-1" />
            {{ spaceActionStarting ? 'Opening...' : 'Open Space' }}
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
