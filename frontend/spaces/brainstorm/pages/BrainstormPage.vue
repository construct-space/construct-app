<script setup lang="ts">
/**
 * Oracle — general chat with session persistence.
 */
import { ref, computed, watch, onMounted } from 'vue'
import { useAgentSession, type RequestBlock } from '@/operator/useAgentSession'
import AgentView from '@/components/agent/AgentView.vue'
import AgentInput from '@/components/agent/AgentInput.vue'
import Slideover from '@/components/ui/Slideover.vue'

const session = useAgentSession()
const { turns, isLoading, statusMessage } = session

const showSessions = ref(false)

interface SessionEntry { id: string; agentId: string; turnCount: number; createdAt: string; updatedAt: string; preview?: string }
const sessions = ref<SessionEntry[]>([])

const inputPlaceholder = computed(() =>
  turns.value.length === 0 ? 'Ask anything...' : 'Continue...'
)

// Auto-save after each completed turn
watch(
  () => turns.value.filter(t => t.status === 'done').length,
  (count) => {
    if (count > 0) session.saveSession('brainstorm')
  },
)

// Load session list when slideover opens
watch(showSessions, async (open) => {
  if (open) await refreshSessions()
})

// Load most recent session on mount
onMounted(async () => {
  const list = await session.listSessions()
  const oracleSessions = list.filter(s => s.agentId === 'brainstorm')
  if (oracleSessions.length > 0) {
    await session.loadSession(oracleSessions[0].id)
  }
})

async function refreshSessions() {
  const list = await session.listSessions()
  sessions.value = list
    .filter(s => s.agentId === 'brainstorm')
    .map(s => ({ ...s, preview: '' }))
}

async function openSession(id: string) {
  await session.loadSession(id)
  showSessions.value = false
}

async function deleteSessionEntry(id: string) {
  await session.deleteSession(id)
  await refreshSessions()
}

function startNewChat() {
  session.newSession()
  showSessions.value = false
}

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

function formatTime(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH}h ago`
  const diffD = Math.floor(diffH / 24)
  return `${diffD}d ago`
}
</script>

<template>
  <div class="flex flex-col h-full bg-app">
    <!-- Toolbar right actions -->
    <Teleport to="#toolbar-right">
      <Tooltip text="New chat">
        <Button icon="i-lucide-plus" variant="ghost" color="neutral" size="xs" class="text-app-muted hover:text-app" @click="startNewChat" />
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
          <AgentInput :placeholder="inputPlaceholder" @send="handleSend" />
        </div>
      </div>
    </div>

    <!-- Sessions slideover -->
    <Slideover v-model:open="showSessions" title="Sessions" side="right">
      <div class="p-3 space-y-1">
        <button
          class="w-full rounded-lg px-3 py-2.5 text-xs font-medium text-app hover:bg-white/5 transition flex items-center gap-2 border border-dashed border-app-border"
          @click="startNewChat"
        >
          <Icon name="i-lucide-plus" class="size-3.5" />
          New chat
        </button>

        <div v-if="sessions.length === 0" class="text-xs text-app-muted text-center py-8">
          No sessions yet
        </div>

        <button
          v-for="s in sessions"
          :key="s.id"
          class="w-full rounded-lg px-3 py-2.5 text-left transition group"
          :class="session.sessionId.value === s.id ? 'bg-app-accent/10 border border-app-accent/20' : 'hover:bg-white/5'"
          @click="openSession(s.id)"
        >
          <div class="flex items-center justify-between">
            <span class="text-xs font-medium text-app truncate">{{ s.turnCount }} turns</span>
            <span class="text-[10px] text-app-muted">{{ formatTime(s.updatedAt) }}</span>
          </div>
          <button
            class="absolute top-1 right-1 p-0.5 rounded text-app-muted/0 group-hover:text-app-muted hover:!text-red-400 transition"
            @click.stop="deleteSessionEntry(s.id)"
          >
            <Icon name="i-lucide-trash-2" class="size-3" />
          </button>
        </button>
      </div>
    </Slideover>
  </div>
</template>
