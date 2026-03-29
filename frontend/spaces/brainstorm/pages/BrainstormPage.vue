<script setup lang="ts">
/**
 * Chat — general chat with session persistence.
 */
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useAgentSession } from '@/operator/useAgentSession'
import type { RequestBlock } from '@/assistant'
import AgentView from '@/components/agent/AgentView.vue'
import AgentInput from '@/components/agent/AgentInput.vue'
import { Slideover } from '@construct-space/ui'
import { Cookie, Plus, PanelRight, Trash2 } from 'lucide-vue-next'

const session = useAgentSession()
const { turns, isLoading, statusMessage } = session

const showSessions = ref(false)

interface SessionEntry { id: string; agentId: string; turnCount: number; createdAt: string; updatedAt: string; preview?: string }
const sessions = ref<SessionEntry[]>([])

const inputPlaceholder = computed(() =>
  turns.value.length === 0 ? 'Ask anything...' : 'Continue...'
)

// Auto-save after each completed turn (only if session has content)
watch(
  () => turns.value.filter(t => t.status === 'done').length,
  (count) => {
    if (count >= 1) session.saveSession('brainstorm')
  },
)

// Load session list when slideover opens
watch(showSessions, async (open) => {
  if (open) await refreshSessions()
})

// Start fresh — don't auto-load old session
onMounted(() => {
  session.newSession()
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

function handleQuestionAnswer(questionId: string, answer: string | string[]) {
  const text = Array.isArray(answer) ? answer.join(', ') : answer
  handleSend([{ type: 'text', content: questionId ? `[${questionId}]: ${text}` : text }])
}

async function handleSend(blocks: RequestBlock[]) {
  const text = blocks
    .filter(b => b.type === 'text')
    .map(b => b.content)
    .join('\n')
  if (!text.trim()) return
  await session.send(blocks, { agentId: 'brainstorm', assistantType: 'brainstorm' })
}

// ─── Cookie crumbs animation ───
const crumbsCanvas = ref<HTMLCanvasElement>()
let crumbsRaf = 0

interface Crumb {
  x: number; y: number; size: number; speed: number; drift: number; opacity: number; rot: number; rotSpeed: number
}

function initCrumbs() {
  const canvas = crumbsCanvas.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')!
  if (!ctx) return

  const resize = () => {
    canvas.width = canvas.offsetWidth * window.devicePixelRatio
    canvas.height = canvas.offsetHeight * window.devicePixelRatio
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio)
  }
  resize()
  window.addEventListener('resize', resize)

  const w = () => canvas.offsetWidth
  const h = () => canvas.offsetHeight

  // Sparse crumbs — not overwhelming
  const crumbs: Crumb[] = Array.from({ length: 18 }, () => ({
    x: Math.random() * w(),
    y: Math.random() * h(),
    size: 1.5 + Math.random() * 3,
    speed: 0.15 + Math.random() * 0.3,
    drift: (Math.random() - 0.5) * 0.3,
    opacity: 0.15 + Math.random() * 0.25,
    rot: Math.random() * Math.PI * 2,
    rotSpeed: (Math.random() - 0.5) * 0.01,
  }))

  function draw() {
    ctx.clearRect(0, 0, w(), h())

    for (const c of crumbs) {
      c.y += c.speed
      c.x += c.drift
      c.rot += c.rotSpeed

      // Reset when off bottom
      if (c.y > h() + 10) {
        c.y = -10
        c.x = Math.random() * w()
      }

      ctx.save()
      ctx.translate(c.x, c.y)
      ctx.rotate(c.rot)
      ctx.fillStyle = `rgba(160, 90, 30, ${c.opacity})`
      // Irregular crumb shape
      ctx.beginPath()
      ctx.ellipse(0, 0, c.size, c.size * 0.7, 0, 0, Math.PI * 2)
      ctx.fill()
      // Smaller chip
      ctx.fillStyle = `rgba(130, 70, 20, ${c.opacity * 0.6})`
      ctx.beginPath()
      ctx.ellipse(c.size * 0.8, -c.size * 0.3, c.size * 0.35, c.size * 0.25, 0.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    crumbsRaf = requestAnimationFrame(draw)
  }

  draw()
}

onMounted(() => {
  // Delay canvas init to avoid layout flash
  setTimeout(initCrumbs, 100)
})
onUnmounted(() => {
  cancelAnimationFrame(crumbsRaf)
})

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
  <div class="flex flex-col h-full bg-app chat-bg">
    <!-- Toolbar right actions -->
    <Teleport to="#toolbar-right">
      <Tooltip text="New chat">
        <Button icon="i-lucide-plus" variant="ghost" color="neutral" size="xs" class="text-app-muted hover:text-app"
          @click="startNewChat" />
      </Tooltip>
      <Tooltip text="Sessions">
        <Button icon="i-lucide-panel-right" variant="ghost" color="neutral" size="xs"
          :class="showSessions ? 'text-app-accent' : 'text-app-muted hover:text-app'"
          @click="showSessions = !showSessions" />
      </Tooltip>
    </Teleport>

    <!-- Chat area -->
    <div class="flex-1 min-h-0 flex justify-center overflow-hidden">
      <div class="w-full max-w-2xl">
        <AgentView :turns="turns" :is-loading="isLoading" :status-message="statusMessage"
          @question-answer="handleQuestionAnswer">
          <template #empty>
            <Cookie class="size-12 text-orange-700/30 mb-4" />
            <h2 class="text-xl font-semibold text-orange-200/50 mb-1">Chat</h2>
            <p class="text-sm text-orange-400/25">Ask anything</p>
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
          New chat
        </button>

        <div v-if="sessions.length === 0" class="text-xs text-app-muted text-center py-8">
          No sessions yet
        </div>

        <div v-for="s in sessions" :key="s.id"
          class="relative w-full rounded-lg px-3 py-2.5 text-left transition group cursor-pointer"
          :class="session.sessionId.value === s.id ? 'bg-orange-500/10 border border-orange-500/20' : 'hover:bg-white/5'"
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

    <!-- Cookie crumbs background -->
    <canvas ref="crumbsCanvas" class="pointer-events-none absolute inset-0 z-0 opacity-40" />
  </div>
</template>

<style scoped>
.chat-bg {
  position: relative;
  background: radial-gradient(ellipse at 50% 120%, rgba(120, 60, 10, 0.08) 0%, transparent 60%);
}
</style>
