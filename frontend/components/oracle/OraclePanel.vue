<script setup lang="ts">
/**
 * ChatPanel — Right slideover chat panel.
 * Persistent across navigation. Uses useAgentSession for streaming.
 */
import { ref, computed, watch } from 'vue'
import { useAgentSession, type RequestBlock } from '@/operator/useAgentSession'
import AgentView from '@/components/agent/AgentView.vue'
import AgentInput from '@/components/agent/AgentInput.vue'

const session = useAgentSession()
const { turns, isLoading, statusMessage } = session

const inputPlaceholder = computed(() =>
  turns.value.length === 0
    ? 'Ask anything...'
    : 'Continue...'
)

function handleQuestionAnswer(_questionId: string, answer: string) {
  handleSend([{ type: 'text', content: answer }])
}

async function handleSend(blocks: RequestBlock[]) {
  const text = blocks
    .filter(b => b.type === 'text')
    .map(b => b.content)
    .join('\n')
  if (!text.trim()) return

  await session.send(blocks, {
    agentId: 'brainstorm',
  })
}

const emit = defineEmits<{
  close: []
}>()
</script>

<template>
  <div class="flex flex-col h-full bg-app">
    <!-- Header -->
    <div class="shrink-0 flex items-center justify-between px-4 py-2 border-b border-app">
      <div class="flex items-center gap-2">
        <Icon name="i-lucide-cookie" class="size-4 text-purple-400" />
        <span class="text-sm font-medium text-app">Chat</span>
      </div>
      <div class="flex items-center gap-1">
        <button
          v-if="turns.length > 0"
          class="p-1.5 rounded-md text-app-muted hover:text-app hover:bg-white/5 transition"
          title="New chat"
          @click="session.clear()"
        >
          <Icon name="i-lucide-plus" class="size-3.5" />
        </button>
        <button
          class="p-1.5 rounded-md text-app-muted hover:text-app hover:bg-white/5 transition"
          title="Close"
          @click="emit('close')"
        >
          <Icon name="i-lucide-x" class="size-3.5" />
        </button>
      </div>
    </div>

    <!-- Chat -->
    <div class="flex-1 min-h-0">
      <AgentView
        :turns="turns"
        :is-loading="isLoading"
        :status-message="statusMessage"
        @question-answer="handleQuestionAnswer"
      >
        <template v-if="turns.length === 0">
          <div class="flex flex-col items-center justify-center h-full px-8 text-center">
            <Icon name="i-lucide-cookie" class="size-10 text-purple-400/30 mb-4" />
            <h2 class="text-lg font-semibold text-app mb-2">Chat</h2>
            <p class="text-sm text-app-muted max-w-xs">
              Ask anything. Brainstorm ideas, get explanations, debug your thinking.
            </p>
          </div>
        </template>
      </AgentView>
    </div>

    <!-- Input -->
    <div class="shrink-0 px-4 py-3 border-t border-app">
      <AgentInput
        :placeholder="inputPlaceholder"
        @send="handleSend"
      />
    </div>
  </div>
</template>
