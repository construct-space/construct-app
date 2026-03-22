<script setup lang="ts">
/**
 * Oracle — general chat page with centered content and sessions slideover.
 */
import { ref, computed } from 'vue'
import { useAgentSession, type RequestBlock } from '@/operator/useAgentSession'
import AgentView from '@/components/agent/AgentView.vue'
import AgentInput from '@/components/agent/AgentInput.vue'
import Slideover from '@/components/ui/Slideover.vue'

const session = useAgentSession()
const { turns, isLoading, statusMessage } = session

const showSessions = ref(false)

const inputPlaceholder = computed(() =>
  turns.value.length === 0 ? 'Ask anything...' : 'Continue...'
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

  await session.send(blocks, { agentId: 'brainstorm' })
}
</script>

<template>
  <div class="flex flex-col h-full bg-app">
    <!-- Toolbar right actions -->
    <Teleport to="#toolbar-right">
      <Tooltip text="New chat">
        <Button icon="i-lucide-plus" variant="ghost" color="neutral" size="xs" class="text-app-muted hover:text-app" @click="session.clear()" />
      </Tooltip>
      <Tooltip text="Sessions">
        <Button icon="i-lucide-panel-right" variant="ghost" color="neutral" size="xs" :class="showSessions ? 'text-app-accent' : 'text-app-muted hover:text-app'" @click="showSessions = !showSessions" />
      </Tooltip>
    </Teleport>
    <!-- Chat area (centered) -->
    <div class="flex-1 min-h-0 flex justify-center">
      <div class="w-full max-w-2xl flex flex-col h-full">
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
                <h2 class="text-lg font-semibold text-app mb-2">Oracle</h2>
                <p class="text-sm text-app-muted max-w-xs">Ask anything</p>
              </div>
            </template>
          </AgentView>
        </div>

        <!-- Input -->
        <div class="shrink-0 px-4 py-3">
          <AgentInput
            :placeholder="inputPlaceholder"
            @send="handleSend"
          />
        </div>
      </div>
    </div>

    <!-- Sessions slideover -->
    <Slideover v-model:open="showSessions" title="Sessions" side="right">
      <div class="p-3 space-y-2">
        <button
          class="w-full rounded-lg px-3 py-2 text-xs font-medium text-app hover:bg-white/5 transition flex items-center gap-2 border border-dashed border-app-border"
          @click="session.clear(); showSessions = false"
        >
          <Icon name="i-lucide-plus" class="size-3.5" />
          New chat
        </button>
      </div>
      <div class="flex-1 px-3">
        <p class="text-xs text-app-muted text-center py-8">No saved sessions yet</p>
      </div>
    </Slideover>
  </div>
</template>
