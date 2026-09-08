<script setup lang="ts">
import ToolbarSlot from '@/components/common/ToolbarSlot.vue'
/**
 * Chat — general chat with session persistence.
 */
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { useBrainSession as useAgentSession } from '@/brain/useBrainSession'
import type { ActionBlock, RequestBlock } from '@/assistant'
import { performHandoff, type HandoffTarget } from '@/lib/agentHandoff'
import AgentView from '@/components/agent/AgentView.vue'
import AgentInput from '@/components/agent/AgentInput.vue'
import { Slideover } from '@construct-space/ui'
import { Plus, Trash2, Sparkles } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { useDevMode } from '@/composables/useDevMode'

const router = useRouter()
const { isEnrolled } = useDevMode()

const session = useAgentSession()
const { turns, isLoading, statusMessage } = session
const showSessions = ref(false)

// Read query param passed from Quick Chat widgets (e.g. ?q=hello)
const route = router.currentRoute

interface SessionEntry { id: string; agentId: string; turnCount: number; createdAt: string; updatedAt: string; preview?: string }
const sessions = ref<SessionEntry[]>([])

const inputPlaceholder = computed(() =>
  turns.value.length === 0 ? 'Ask anything...' : 'Continue...'
)

// Auto-save after each completed turn (only if session has content)
watch(
  () => turns.value.filter(t => t.status === 'done').length,
  (count) => {
    if (count >= 1) session.saveSession()
  },
)

// Load session list when slideover opens
watch(showSessions, async (open) => {
  if (open) await refreshSessions()
})

// Start fresh — don't auto-load old session
// If a ?q= param is present (from Quick Chat widgets), send it immediately
onMounted(async () => {
  session.newSession()
  const q = route.value.query.q
  if (q && typeof q === 'string' && q.trim()) {
    // Remove query param from URL without navigation (clean URL)
    router.replace({ query: {} })
    // Wait a tick so AgentInput is mounted, then send
    await nextTick()
    await handleSend([{ type: 'text', content: q.trim() }])
  }
})

async function refreshSessions() {
  const list = await session.listSessions()
  sessions.value = list
    .filter(s => s.agentId === 'ask')
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

function handleAction(action: ActionBlock['actions'][number]) {
  // Handoff to another space
  if (action.id?.startsWith('handoff:')) {
    const target = action.id.slice('handoff:'.length) as HandoffTarget
    const lastUserTurn = [...turns.value].reverse().find(t => t.request.length > 0)
    const prompt = lastUserTurn?.request
      .filter((b): b is { type: 'text'; content: string } => b.type === 'text')
      .map(b => b.content)
      .join('\n')
      .trim()
    performHandoff(target, { prompt: prompt || undefined })
    return
  }

  // Install a marketplace space. Fall back to deriving the id from
  // `install-<spaceId>` if the model omits installSpaceId (Flash drops
  // it sometimes despite the prompt rule).
  const installId = action.installSpaceId
    || (action.id?.startsWith('install-') ? action.id.slice('install-'.length) : '')
  if (installId) {
    void import('@/composables/useSpaceMarketplace').then(({ useSpaceMarketplace }) => {
      const market = useSpaceMarketplace()
      void market.install(installId).catch(err =>
        console.error('[AskPage] installSpace failed:', err),
      )
    })
    return
  }

  // Open an installed Space (model emits openMode:'space' or spaceId).
  if (action.spaceId || action.openMode === 'space') {
    if (!action.spaceId) return
    void import('@/lib/spaceNavigation').then(({ navigateToSpace }) =>
      navigateToSpace({
        spaceId: action.spaceId!,
        ...(action.page ? { page: action.page } : {}),
      }),
    )
    return
  }

  // Choice button — send the label as a user message
  if (action.id?.startsWith('choice-')) {
    handleSend([{ type: 'text', content: action.label }])
    return
  }
}

function handleQuestionAnswer(questionId: string, answer: string | string[]) {
  const text = Array.isArray(answer) ? answer.join(', ') : answer
  handleSend([{ type: 'text', content: questionId ? `[${questionId}]: ${text}` : text }])
}

async function handleSend(blocks: RequestBlock[]) {
  const hasContent = blocks.some(b =>
    (b.type === 'text' && b.content.trim())
    || (b.type === 'file' && !!(b as RequestBlock & { path?: string }).path)
    || b.type === 'image'
  )
  if (!hasContent) return
  await session.send(blocks, { agentId: 'ask', assistantType: 'ask' })
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
  <div class="flex flex-col h-full bg-app-canvas">
    <!-- Matched skills indicator -->
    <div v-if="session.matchedSkills.value.length > 0 && isLoading"
      class="flex items-center justify-center gap-1.5 py-1">
      <span v-for="skill in session.matchedSkills.value" :key="skill.id"
        class="inline-flex items-center gap-1 rounded-full bg-[var(--app-accent)]/10 px-2 py-0.5 text-[10px] text-[var(--app-accent)]/70">
        <Sparkles class="size-3" />
        {{ skill.name }}
      </span>
    </div>

    <!-- Toolbar right actions -->
    <ToolbarSlot name="right">
      <Tooltip text="New thread">
        <Button icon="i-lucide-plus" variant="ghost" color="neutral" size="xs" class="text-app-muted hover:text-app"
          @click="startNewChat" />
      </Tooltip>
      <Tooltip text="Sessions">
        <Button icon="i-lucide-panel-right" variant="ghost" color="neutral" size="xs"
          :class="showSessions ? 'text-app-accent' : 'text-app-muted hover:text-app'"
          @click="showSessions = !showSessions" />
      </Tooltip>
    </ToolbarSlot>

    <!-- Chat area -->
    <div class="flex-1 min-h-0 flex justify-center overflow-hidden">
      <div class="w-full max-w-2xl">
        <AgentView :turns="turns" :is-loading="isLoading" :status-message="statusMessage"
          @question-answer="handleQuestionAnswer" @action="handleAction">
          <template #empty>
            <div class="w-full max-w-xl px-6 flex flex-col items-center text-center">
              <Sparkles class="size-10 text-app-muted/50 mb-4" />
              <h2 class="text-2xl font-semibold text-app mb-2">What's on your mind?</h2>
              <p class="text-sm text-app-muted leading-relaxed">
                Ask anything — this is your general thinking space.
              </p>
              <p class="mt-4 text-[11px] text-app-muted/80 leading-relaxed max-w-sm">
                Think, research, brainstorm, or just talk.
                <template v-if="isEnrolled">
                  I don't touch your code, files, or environment — for that, use
                  <span class="text-app">Builder</span> or <span class="text-app">Space Developer</span>.
                </template>
              </p>
            </div>
          </template>
        </AgentView>
      </div>
    </div>

    <!-- Input (pinned bottom, centered) -->
    <div class="shrink-0 flex justify-center">
      <div class="w-full max-w-2xl">
        <AgentInput :placeholder="inputPlaceholder" :loading="isLoading" @send="handleSend" @stop="session.stop()" />
      </div>
    </div>

    <!-- Sessions slideover -->
    <Slideover v-model:open="showSessions" title="Sessions" side="right">
      <div class="p-3 space-y-1">
        <button
          class="w-full rounded-lg px-3 py-2.5 text-xs font-medium text-app hover:bg-white/5 transition flex items-center gap-2 border border-dashed border-app-border"
          @click="startNewChat">
          <Plus class="size-3.5" />
          New thread
        </button>

        <div v-if="sessions.length === 0" class="text-xs text-app-muted text-center py-8">
          No sessions yet
        </div>

        <div v-for="s in sessions" :key="s.id"
          class="relative w-full rounded-lg px-3 py-2.5 text-left transition group cursor-pointer"
          :class="session.sessionId.value === s.id ? 'bg-[var(--app-accent)]/10 border border-[var(--app-accent)]/20' : 'hover:bg-white/5'"
          @click="openSession(s.id)">
          <div class="flex items-center justify-between">
            <span class="text-xs font-medium text-app truncate">{{ s.turnCount }} turns</span>
            <span class="text-[10px] text-app-muted">{{ formatTime(s.updatedAt) }}</span>
          </div>
          <span
            class="absolute top-1 right-1 p-0.5 rounded text-transparent group-hover:text-app-muted hover:!text-red-400 transition cursor-pointer"
            @click.stop="deleteSessionEntry(s.id)">
            <Trash2 class="size-3" />
          </span>
        </div>
      </div>
    </Slideover>
  </div>
</template>
