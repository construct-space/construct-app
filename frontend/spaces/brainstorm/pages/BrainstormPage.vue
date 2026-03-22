<script setup lang="ts">
/**
 * Oracle — general chat page with centered content and sessions sidebar.
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useAgentSession, type RequestBlock } from '@/operator/useAgentSession'
import { useToolbar } from '@/composables/useToolbar'
import AgentView from '@/components/agent/AgentView.vue'
import AgentInput from '@/components/agent/AgentInput.vue'

const session = useAgentSession()
const { turns, isLoading, statusMessage } = session
const { setPageItems, clearPageItems } = useToolbar()

const showSessions = ref(false)

onMounted(() => {
  setPageItems([
    { id: 'oracle-new', icon: 'lucide:plus', label: 'New chat', type: 'action', onClick: () => session.clear() },
    { id: 'oracle-sessions', icon: 'lucide:panel-right', label: 'Sessions', type: 'action', onClick: () => { showSessions.value = !showSessions.value }, active: showSessions.value },
  ])
})
onUnmounted(() => clearPageItems())

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
  <div class="flex h-full bg-app">
    <!-- Main chat area -->
    <div class="flex-1 flex flex-col min-w-0">
      <div class="flex-1 min-h-0 flex justify-center">
        <div class="w-full max-w-2xl flex flex-col h-full">
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
    </div>

    <!-- Sessions sidebar -->
    <Transition
      enter-active-class="transition-all duration-200 ease-out"
      enter-from-class="w-0 opacity-0"
      enter-to-class="w-[280px] opacity-100"
      leave-active-class="transition-all duration-150 ease-in"
      leave-from-class="w-[280px] opacity-100"
      leave-to-class="w-0 opacity-0"
    >
      <div
        v-if="showSessions"
        class="w-[280px] shrink-0 border-l border-app overflow-hidden flex flex-col"
      >
        <div class="flex items-center justify-between px-3 py-2 border-b border-app">
          <span class="text-xs font-medium text-app-muted uppercase tracking-wider">Sessions</span>
          <button
            class="p-1 rounded text-app-muted hover:text-app hover:bg-white/5 transition"
            @click="showSessions = false"
          >
            <Icon name="i-lucide-x" class="size-3.5" />
          </button>
        </div>
        <div class="flex-1 overflow-y-auto p-2">
          <p class="text-xs text-app-muted text-center py-8">No saved sessions yet</p>
        </div>
        <div class="shrink-0 p-2 border-t border-app">
          <button
            class="w-full rounded-lg px-3 py-2 text-xs font-medium text-app-muted hover:text-app hover:bg-white/5 transition flex items-center gap-2"
            @click="session.clear()"
          >
            <Icon name="i-lucide-plus" class="size-3.5" />
            New chat
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>
