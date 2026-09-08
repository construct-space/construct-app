<script setup lang="ts">
/**
 * DetachShell — Unified shell for detached windows.
 *
 * Dual-mode: discriminated by route:
 *  - /detach/assistant          → assistant mode (Phase 5 fully wired)
 *  - /detach/space/:spaceId/*   → space mode (Phase 5b placeholder)
 *
 * Bootstraps via useUniversalBootstrap() + bootstrapDetach().
 */

import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useUniversalBootstrap } from '@/composables/useUniversalBootstrap'
import { bootstrapDetach, type DetachTarget } from '@/lib/window/bootstrapDetach'
import { startChildMirror } from '@/lib/crossWindow/childMirror'
import { emitTo, channels } from '@/lib/crossWindow/sync'
import { useBrainSession } from '@/brain/useBrainSession'
import type { OperatorAgent } from '@/brain/types'
import type { PermissionRequestEvent } from '@/composables/useStreamStatus'
import { useAgentSessionStore } from '@/stores/agentSession'
import { useMarkdown } from '@/composables/useMarkdown'
import { isTauriEnv } from '@/utils/tauri'
import AgentInput from '@/components/agent/AgentInput.vue'
import PermissionModal from '@/components/agent/PermissionModal.vue'
import RuntimeToolbar from '@/components/agent/RuntimeToolbar.vue'
import type { RequestBlock, ToolBlock, TextBlock } from '@/assistant'
import type { PermissionModeValue } from '@/brain/types'
import { Loader2, Check, X, ChevronUp, ChevronDown, AlertCircle } from 'lucide-vue-next'

useUniversalBootstrap()

const route = useRoute()

// ─── Mode resolution ──────────────────────────────────────────────────────────

const isAssistantMode = computed(() => route.path === '/detach/assistant' || route.path.startsWith('/detach/assistant'))
const spaceId = computed(() => route.params.spaceId as string | undefined)
const sessionId = computed(() => (route.query.session as string) ?? '')

const target = computed<DetachTarget>(() => {
  if (isAssistantMode.value) {
    return { mode: 'assistant', sessionId: sessionId.value }
  }
  return { mode: 'space', spaceId: spaceId.value ?? '', sessionId: sessionId.value }
})

// ─── Bootstrap ───────────────────────────────────────────────────────────────

let cleanupDetach: (() => void) | null = null
let mirrorUnlistens: (() => void)[] = []

// ─── Assistant session (only used in assistant mode) ─────────────────────────

const session = useBrainSession()
const sessionStore = useAgentSessionStore()

const {
  turns, isLoading, error, hasTurns, statusMessage,
  send, stop, clear, selectedAgent, setAgent, brain,
} = session

// Operator-runtime affordances brain doesn't expose yet. Stubbed so the
// detach window typechecks; rewiring these to brain (permission flow,
// cost/context tracking, permission-mode toggle) is a follow-up task.
// `operator` is aliased to `brain` for the connection-dot + listAgents
// usage further down — brain exposes the same `connected` + `listAgents`
// surface those call sites need.
const operator = {
  connected: brain.connected,
  connect: async () => { /* brain auto-connects on first request */ },
  listAgents: async (): Promise<OperatorAgent[]> => {
    try {
      const resp = await brain.listAgents()
      return (resp?.agents ?? []) as unknown as OperatorAgent[]
    } catch { return [] }
  },
}

const pendingPermission = ref<PermissionRequestEvent | null>(null)
const respondToPermission = async (
  _requestId: string,
  _tool: string,
  _action: 'allow' | 'deny',
  _remember: boolean,
): Promise<void> => { /* brain: permission UI lives in <PermissionGate> */ }
const setPermissionMode = async (_mode: PermissionModeValue): Promise<void> => { /* brain: yolo */ }
const contextInfo = ref<{
  totalChars: number; charLimit: number; charPct: number;
  estimatedTokens: number; tokenLimit: number; tokenPct: number;
  totalMessages: number; wastedChars: number;
  warning: boolean; critical: boolean;
} | null>(null)
const costInfo = ref<{
  costUSD: number; budgetUSD: number; usedPct: number;
  warning: boolean; exceeded: boolean;
  totalTokens: number; inputTokens: number; outputTokens: number;
  cacheRead: number; cacheWrite: number; cacheHitRate: number;
  inputCostUSD: number; outputCostUSD: number;
  cacheReadCostUSD: number; cacheWriteCostUSD: number;
} | null>(null)
const permissionMode = ref<PermissionModeValue>('yolo')
const isAgentActive = computed(() => isLoading.value)

// List of agents available on the operator — populated after connect.
const agents = ref<OperatorAgent[]>([])

function findAgentForSpace(spaceName: string) {
  return agents.value.find(a =>
    a.id === spaceName
    || a.id === `space:${spaceName}`
    || (a.category === 'space' && a.id.includes(spaceName)),
  )
}

function switchToSpace(space: string) {
  if (!agents.value.length) return
  const match = findAgentForSpace(space)
  setAgent(match ? match.id : 'construct')
}

const { renderMarkdown } = useMarkdown()

const agentLabel = computed(() => {
  const id = selectedAgent.value
  if (!id || id === 'construct') return 'Construct'
  const name = id.replace(/^space:/, '')
  return name.charAt(0).toUpperCase() + name.slice(1)
})

// ─── Lifecycle ────────────────────────────────────────────────────────────────

// Listen for the main window's space changes and auto-switch the
// agent so a detached assistant tracks "boards" → "/app/board"
// navigation, etc. Held until unmount.
let unlistenSpaceChange: (() => void) | null = null

onMounted(async () => {
  // Register session in store so handoff contract can access it
  sessionStore.register(session)

  // Connect operator + load agent list (so switchToSpace can resolve)
  try {
    await operator.connect()
    agents.value = await operator.listAgents()
  } catch { /* show connection state */ }

  // Bootstrap detach (claim session + register close handler)
  cleanupDetach = await bootstrapDetach(target.value)

  // Hydrate state from main window
  mirrorUnlistens = await startChildMirror()

  // Track main window's space.
  if (isAssistantMode.value && isTauriEnv()) {
    try {
      const { listen } = await import('@tauri-apps/api/event')
      unlistenSpaceChange = await listen<{ space: string }>('space-changed', (e) => {
        const space = e.payload?.space || ''
        if (space) switchToSpace(space)
        else setAgent('construct')
      })
    } catch { /* best-effort */ }
  }
})

// Forward pending permission requests to main window modal
watch(pendingPermission, async (perm) => {
  if (!perm) return
  try {
    await emitTo('main', channels.permission, perm)
    // Clear local pending so this window doesn't also show the modal
    pendingPermission.value = null
  } catch (err) {
    console.warn('[DetachShell] Failed to forward permission to main:', err)
    // Leave pendingPermission set so local modal can show as fallback
  }
})

onUnmounted(() => {
  cleanupDetach?.()
  sessionStore.unregister()
  for (const fn of mirrorUnlistens) fn()
  mirrorUnlistens = []
  unlistenSpaceChange?.()
  unlistenSpaceChange = null
})

// ─── Tool display helpers (assistant mode) ───────────────────────────────────

const TOOL_NAMES: Record<string, string> = {
  bash: 'Bash', write_file: 'Write', edit_file: 'Edit', read_file: 'Read',
  list_dir: 'List', glob: 'Glob', grep: 'Grep', search: 'Search',
  spawn_agent: 'Agent', space_check: 'Check', space_build: 'Build',
}

function truncate(text: string, max: number) {
  const t = text.trim()
  return t.length <= max ? t : t.slice(0, max).trimEnd() + '\u2026'
}

function getToolDisplay(block: ToolBlock) {
  let primaryArg = ''
  try {
    const parsed = typeof block.input === 'string' ? JSON.parse(block.input) : block.input
    if (parsed && typeof parsed === 'object') {
      switch (block.tool) {
        case 'bash': primaryArg = parsed.command || ''; break
        case 'write_file': case 'edit_file': case 'read_file': case 'list_dir':
          primaryArg = parsed.path || ''; break
        case 'glob': case 'grep': case 'search':
          primaryArg = parsed.pattern || ''; break
        default: {
          const first = Object.values(parsed).find(v => typeof v === 'string' && (v as string).trim())
          primaryArg = typeof first === 'string' ? first : ''
        }
      }
    }
  } catch { /* ignore */ }
  return {
    displayName: TOOL_NAMES[block.tool] || block.tool,
    primaryArg,
    shortArg: truncate(primaryArg, 80),
  }
}

// ─── Stream view (assistant mode) ────────────────────────────────────────────

interface StreamItem {
  id: string
  type: 'user' | 'assistant' | 'tool' | 'error'
  content?: string
  toolBlock?: ToolBlock
}

const stream = computed<StreamItem[]>(() => {
  const items: StreamItem[] = []
  for (const turn of turns.value) {
    const text = turn.request
      .filter((b): b is TextBlock => b.type === 'text')
      .map(b => b.content)
      .join('\n')
    if (text.trim()) items.push({ id: `${turn.id}-req`, type: 'user', content: text })
    for (let i = 0; i < turn.response.length; i++) {
      const block = turn.response[i]
      if (block.type === 'text') {
        items.push({ id: `${turn.id}-res-${i}`, type: 'assistant', content: (block as TextBlock).content })
      } else if (block.type === 'tool') {
        items.push({ id: `${turn.id}-res-${i}`, type: 'tool', toolBlock: block as ToolBlock })
      } else if (block.type === 'error') {
        items.push({ id: `${turn.id}-res-${i}`, type: 'error', content: (block as unknown as { message: string }).message })
      }
    }
  }
  return items
})

// Auto-scroll
const scrollRef = ref<HTMLElement>()
watch(
  () => {
    const s = stream.value
    const last = s[s.length - 1]
    return `${s.length}-${last?.toolBlock?.state || ''}-${(last?.content || '').length}`
  },
  () => nextTick(() => {
    if (scrollRef.value) scrollRef.value.scrollTop = scrollRef.value.scrollHeight
  }),
)

// Expandable tools
const expandedTools = ref(new Set<string>())
function toggleTool(id: string) {
  if (expandedTools.value.has(id)) expandedTools.value.delete(id)
  else expandedTools.value.add(id)
}

// Permission
function onPermissionRespond(payload: { requestId: string; tool: string; action: 'allow' | 'deny'; remember: boolean }) {
  void respondToPermission(payload.requestId, payload.tool, payload.action, payload.remember)
}

function onPermissionModeChange(mode: PermissionModeValue) {
  void setPermissionMode(mode)
}

// Input
function onSend(blocks: RequestBlock[]) {
  const agentId = selectedAgent.value || 'construct'
  void send(blocks, { agentId })
}

// Keyboard: Escape to stop
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && isLoading.value) { e.preventDefault(); void stop() }
}
onMounted(() => window.addEventListener('keydown', handleKeydown))
onUnmounted(() => window.removeEventListener('keydown', handleKeydown))

// Window controls handled by macOS native traffic lights — no in-app
// implementations needed since we removed the fake traffic-light row.
</script>

<template>
  <!-- ── Assistant mode ───────────────────────────────────────────────────── -->
  <div v-if="isAssistantMode" class="h-screen w-screen overflow-hidden bg-app flex flex-col text-app">
    <!-- Header: status + runtime toolbar. macOS already provides
         traffic lights (decorations: true on the window), so we don't
         draw fake ones here — that produced a duplicate title bar. -->
    <div class="flex items-center gap-3 px-4 py-3 border-b border-[var(--app-border)]/30 shrink-0 select-none"
      data-tauri-drag-region>
      <div class="flex items-center gap-2 px-2.5 py-1 text-xs font-medium rounded-lg bg-white/50 dark:bg-white/10">
        <span class="size-2 rounded-full" :class="operator.connected.value ? 'bg-green-500' : 'bg-red-500'" />
        <span>{{ agentLabel }}</span>
      </div>


      <RuntimeToolbar :context-info="contextInfo" :cost-info="costInfo" :permission-mode="permissionMode"
        :is-active="isAgentActive" @update:permission-mode="onPermissionModeChange" />

      <button v-if="isLoading"
        class="p-1.5 text-red-400 hover:text-red-300 rounded-lg hover:bg-red-500/10 transition-colors"
        title="Stop (Escape)" @click="stop()">
        <svg class="size-4" viewBox="0 0 16 16">
          <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" />
        </svg>
      </button>

      <button v-if="hasTurns"
        class="p-1.5 text-app-muted hover:text-app rounded-lg hover:bg-white/50 dark:hover:bg-white/10 transition-colors"
        title="Clear chat" @click="clear">
        <svg class="size-4" viewBox="0 0 16 16">
          <path d="M2 2h12M4 6h8M6 10h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
      </button>
    </div>

    <!-- Error banner -->
    <div v-if="error" class="shrink-0 flex items-start gap-2 px-4 py-2.5 border-b border-red-500/20 bg-red-500/8">
      <AlertCircle class="size-4 text-red-400 mt-0.5 shrink-0" />
      <p class="text-sm text-red-300 flex-1">{{ error }}</p>
    </div>

    <!-- Conversation stream -->
    <div ref="scrollRef" class="flex-1 overflow-y-auto scroll-smooth px-4 py-3 space-y-2">
      <div v-if="!stream.length && !isLoading" class="flex flex-col items-center justify-center h-full text-center">
        <div
          class="size-12 rounded-2xl bg-[color-mix(in_srgb,var(--app-foreground)_5%,transparent)] flex items-center justify-center mb-4">
          <svg class="size-6 text-app-muted" viewBox="0 0 24 24">
            <path
              d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
              fill="currentColor" opacity="0.3" />
          </svg>
        </div>
        <p class="text-sm text-app-muted mb-1">Ask anything</p>
        <p class="text-xs text-app-muted/60">
          {{ operator.connected.value ? 'Connected to Operator' : 'Connecting to Operator...' }}
        </p>
      </div>

      <template v-for="item in stream" :key="item.id">
        <div v-if="item.type === 'user'" class="flex justify-end">
          <div class="rounded-2xl bg-app-accent/15 text-app px-4 py-2 text-sm max-w-[80%]">{{ item.content }}</div>
        </div>

        <div v-else-if="item.type === 'assistant'"
          class="text-[13px] leading-6 text-[var(--app-foreground)]/80 prose prose-sm dark:prose-invert max-w-none [&_code]:bg-[var(--app-foreground)]/10 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[var(--app-accent)]/90 [&_code]:text-[12px] [&_strong]:text-[var(--app-foreground)] [&_hr]:border-[var(--app-border)]"
          v-html="renderMarkdown(item.content || '')" />

        <div v-else-if="item.type === 'tool' && item.toolBlock" class="font-mono text-xs leading-5">
          <div class="flex items-start gap-2 py-0.5 select-none cursor-pointer hover:bg-white/[0.03] -mx-1 px-1 rounded"
            @click="toggleTool(item.id)">
            <Loader2 v-if="item.toolBlock.state === 'running'"
              class="mt-1 size-3 shrink-0 text-[var(--app-accent)] animate-spin" />
            <Check v-else-if="item.toolBlock.state === 'done'" class="mt-1 size-3 shrink-0 text-[var(--app-accent)]" />
            <X v-else class="mt-1 size-3 shrink-0 text-red-400" />
            <span class="min-w-0 flex-1">
              <span class="text-[var(--app-accent)]">{{ getToolDisplay(item.toolBlock).displayName }}</span>
              <span v-if="getToolDisplay(item.toolBlock).primaryArg && !expandedTools.has(item.id)"
                class="text-app-muted/70">
                ('{{ getToolDisplay(item.toolBlock).shortArg }}')
              </span>
            </span>
            <ChevronUp v-if="expandedTools.has(item.id)" class="size-3 mt-1 shrink-0 text-app-muted/30" />
            <ChevronDown v-else class="size-3 mt-1 shrink-0 text-app-muted/30" />
          </div>
          <div v-if="expandedTools.has(item.id)" class="ml-5 mt-1 mb-1.5 space-y-1.5">
            <div v-if="getToolDisplay(item.toolBlock).primaryArg"
              class="rounded-lg bg-black/30 px-3 py-2 text-[11px] text-app-muted/80 whitespace-pre-wrap break-all">
              {{ getToolDisplay(item.toolBlock).primaryArg }}
            </div>
            <div v-if="item.toolBlock.result"
              class="rounded-lg px-3 py-2 text-[11px] whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto"
              :class="item.toolBlock.state === 'error' ? 'bg-red-500/10 text-red-300/80' : 'bg-[var(--app-accent)]/8 text-[var(--app-accent)]/70'">
              {{ item.toolBlock.result }}
            </div>
          </div>
        </div>

        <div v-else-if="item.type === 'error'"
          class="px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/10 text-xs text-red-500">
          {{ item.content }}
        </div>
      </template>

      <div v-if="isLoading && stream.length > 0" class="flex items-center gap-2 text-xs text-app-muted py-1">
        <span class="size-1.5 rounded-full bg-[var(--app-accent)] animate-pulse" />
        <span>{{ statusMessage || 'Working...' }}</span>
      </div>
    </div>

    <!-- Input -->
    <div class="shrink-0 px-4 pb-3">
      <AgentInput :loading="isLoading" :disabled="!operator.connected.value"
        :placeholder="isLoading ? 'Redirect or steer...' : 'Ask anything...'" @send="onSend" @stop="stop()" />
    </div>

    <PermissionModal v-if="pendingPermission" :pending-permission="pendingPermission" @respond="onPermissionRespond" />
  </div>

  <!-- ── Space mode (Phase 5b placeholder) ────────────────────────────────── -->
  <div v-else class="h-screen w-screen overflow-hidden bg-app flex items-center justify-center text-app">
    <div class="text-center text-app-muted text-sm">
      <p class="font-medium mb-1">Space detach: Phase 5b</p>
      <p class="text-xs opacity-60">Space popout not yet wired ({{ spaceId }})</p>
    </div>
  </div>
</template>
