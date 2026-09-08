<script setup lang="ts">
/**
 * AssistantPanel — Ask panel powered by Brain.
 *
 * Uses block-based AgentView for rendering turns with interleaved
 * tool calls, and AgentInput for text + image/file drag-drop.
 * Visibility (showAssistant, openInWindow) is still served by the
 * operator-package useAssistant since those bits are pure UI and don't
 * touch the operator sidecar; the live session lives in useBrainSession.
 */

import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import { useBrainSession, type BrainAgent } from '@/brain/useBrainSession'
import { useAIModel } from '@/composables/useAIModel'
import { useAssistantPanel } from '@/composables/useAssistantPanel'
import { getAssistantConfig } from '@/assistant/runtime'
import type { ActionBlock, RequestBlock } from '@/assistant'
import AgentView from '@/components/agent/AgentView.vue'
import AgentInput from '@/components/agent/AgentInput.vue'
import { useRouter } from 'vue-router'
import { isTauriEnv } from '@/utils/tauri'
import { useAgentSessionStore } from '@/stores/agentSession'
import { onRemoteAssistantEvent, type RemoteAssistantEvent } from '@/composables/useDeviceBus'
import type { Turn, TextBlock } from '@/assistant'

const props = defineProps<{
  docked?: boolean
  standalone?: boolean
  windowTitle?: string
}>()

const emit = defineEmits<{
  'header-mousedown': [event: MouseEvent]
}>()

// Floating-panel drag: any mousedown on the header that isn't on a
// button starts a drag in the parent. Standalone (Tauri window) uses
// data-tauri-drag-region instead — leave that path alone.
function onHeaderMouseDown(e: MouseEvent) {
  if (props.standalone) return
  const target = e.target as HTMLElement | null
  if (target?.closest('button, a, input, [data-no-drag]')) return
  emit('header-mousedown', e)
}

const session = useBrainSession()
const assistant = useAssistantPanel()
const sessionStore = useAgentSessionStore()

const {
  turns,
  isLoading,
  error,
  hasTurns,
  selectedAgent,
  statusMessage,
  send,
  stop,
  clear,
  brain,
} = session

// Open in window — reuse from useAssistant (has the Tauri window logic)
const { openInWindow, close: closeAssistant } = assistant

// Agents
const agents = ref<BrainAgent[]>([])
const brainVersion = ref<string>('')
const inputRef = ref<InstanceType<typeof AgentInput>>()
const executedActionKeys = new Set<string>()

// Load agents on mount
const router = useRouter()

onMounted(async () => {
  try {
    const [info, agentResp] = await Promise.all([
      brain.info().catch(() => null),
      brain.listAgents().catch(() => ({ agents: [] })),
    ])
    if (info?.version) brainVersion.value = info.version
    agents.value = agentResp.agents ?? []
    detectAndSwitch(router.currentRoute.value.path)
  } catch {
    // Brain not running — empty state will reflect "Connecting…"
  }
  inputRef.value?.focus()
})

// Cross-device chat ingestion: when another device emits an
// assistant.ask, the operator runs it and streams back chunks.
// We mirror those into a synthetic Turn here so the user sees the
// conversation as if they typed it themselves. requestId → Turn
// mapping is kept locally; chunks/complete events update the same
// turn in place.
const remoteTurnsByRequest = new Map<string, Turn>()
const offRemote = onRemoteAssistantEvent((ev: RemoteAssistantEvent) => {
  if (ev.kind === 'ask') {
    const turn: Turn = {
      id: `remote-${ev.requestId}`,
      request: [{ type: 'text', content: ev.text }],
      response: [],
      agentId: selectedAgent.value || 'general',
      status: 'streaming',
      timestamp: Date.now(),
    }
    remoteTurnsByRequest.set(ev.requestId, turn)
    turns.value = [...turns.value, turn]
    return
  }
  const turn = remoteTurnsByRequest.get(ev.requestId)
  if (!turn) return
  if (ev.kind === 'chunk') {
    const last = turn.response[turn.response.length - 1]
    if (last?.type === 'text') {
      ;(last as TextBlock).content += ev.delta
    } else {
      turn.response.push({ type: 'text', content: ev.delta })
    }
    // Trigger reactivity — Turn objects in the array have been mutated
    // in place, but Vue sees the array itself unchanged. Recreating
    // the array forces dependents (AgentView) to re-render.
    turns.value = [...turns.value]
    return
  }
  if (ev.kind === 'complete') {
    // If chunks arrived this is a no-op text-wise; if no chunks
    // landed (operator was too fast / proxy buffered), drop the
    // full content in now so the user sees something.
    if (turn.response.length === 0 && ev.content) {
      turn.response.push({ type: 'text', content: ev.content })
    }
    turn.status = ev.stopReason === 'error' ? 'error' : 'done'
    turns.value = [...turns.value]
    remoteTurnsByRequest.delete(ev.requestId)
    return
  }
})
onUnmounted(() => offRemote())

// Send from AgentInput. Underlying agent stays "general"; while inside
// a space, we pin its skill via `skills: [spaceSlug]` so brain loads only
// that space's skill at tier-1 for this prompt (and only this prompt —
// no global state on the brain side).
async function handleSend(blocks: RequestBlock[]) {
  // In a space with no explicitly-picked agent, address the space itself as
  // the agent. The brain treats a non-built-in id + space_id as "load this
  // space's agent/config.md" — defaulting to the built-in 'construct' here was
  // short-circuiting that, so spaces always got the generic prompt.
  const agentId = selectedAgent.value || activeSpace.value || 'construct'
  const assistantConfig = getAssistantConfig('assistant-panel')
  await send(blocks, {
    agentId,
    ...(activeSpace.value ? { skills: [activeSpace.value], space_id: activeSpace.value } : {}),
    ...(assistantConfig ? { assistantType: assistantConfig.id } : {}),
    ...(assistantConfig?.finalSchema ? { outputSchema: assistantConfig.finalSchema } : {}),
  })
}

type AssistantAction = ActionBlock['actions'][number]

function lastUserPromptText(): string {
  for (let i = turns.value.length - 1; i >= 0; i -= 1) {
    const t = turns.value[i]
    if (!t || t.request.length === 0) continue
    const text = t.request
      .filter((b): b is { type: 'text'; content: string } => b.type === 'text')
      .map(b => b.content)
      .join('\n')
      .trim()
    if (text) return text
  }
  return ''
}

async function executeAction(action: AssistantAction) {
  console.log('[AssistantPanel] executeAction:', JSON.parse(JSON.stringify(action)))
  // Install a marketplace space. Routed first because it's a one-shot
  // side effect — once it succeeds the user is back in flow and the
  // assistant can spawn the space's agent on the next turn.
  const installId = action.installSpaceId
    || (action.id?.startsWith('install-') ? action.id.slice('install-'.length) : '')
  if (installId) {
    console.log('[AssistantPanel] installing space:', installId)
    try {
      const { useSpaceMarketplace } = await import('@/composables/useSpaceMarketplace')
      const market = useSpaceMarketplace()
      const ok = await market.install(installId)
      console.log('[AssistantPanel] install result:', ok, 'error:', market.error?.value)
      if (!ok) {
        console.warn('[AssistantPanel] install returned false for', installId)
      }
    } catch (err) {
      console.error('[AssistantPanel] installSpace failed:', err)
    }
    return
  }

  // Navigate to an installed Space (openMode:'space' or just spaceId set).
  if (action.spaceId || action.openMode === 'space') {
    if (!action.spaceId) return
    const { navigateToSpace } = await import('@/lib/spaceNavigation')
    // Carry the user's last prompt so the destination Space's agent can
    // pick up where this one left off (matches the existing handoff
    // pattern used by Builder / Space Developer).
    const lastUserPrompt = lastUserPromptText()
    await navigateToSpace({
      spaceId: action.spaceId,
      ...(action.page ? { page: action.page } : {}),
      ...(lastUserPrompt ? { query: { q: lastUserPrompt } } : {}),
    })
    return
  }

  if (!action.url) return

  const mode = action.openMode || 'browser'

  if (isTauriEnv()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('browser_open_host', {
        mode,
        url: action.url,
        title: action.label,
      })
      return
    } catch (err) {
      console.error('[AssistantPanel] browser_open_host failed:', err)
    }
  }

  window.open(action.url, '_blank', 'noopener,noreferrer')
}

async function handleAction(action: AssistantAction) {
  await executeAction(action)
}

// Keyboard: Escape to stop
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && isLoading.value) {
    e.preventDefault()
    void stop()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
  sessionStore.register(session)
})
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
  sessionStore.unregister()
})

// Active space context. Underlying agent stays "general"; the chip just
// relabels and the prompt carries `skills: [spaceSlug]` so brain pins
// only that space's skill at tier-1. Cleared when the user leaves the
// space — so re-entering re-loads the skill on the next prompt.
const activeSpace = ref<string | null>(null)

// Pretty label for the chip. We don't yet have a space-config lookup
// here, so capitalize the slug; agent registry name takes priority when
// a real space-agent of that id exists (legacy / migration window).
function spaceLabel(slug: string): string {
  const matchAgent = agents.value.find(a => a.id === slug || a.id === `space:${slug}`)
  if (matchAgent) return matchAgent.name
  if (!slug) return ''
  // "pages" → "Pages" (we display the space name, not the skill name —
  // singular is a downstream concern when the skill ID is registered).
  return slug.charAt(0).toUpperCase() + slug.slice(1)
}

const currentAgent = computed<{ name: string } | undefined>(() => {
  if (activeSpace.value) return { name: spaceLabel(activeSpace.value) }
  return agents.value.find(a => a.id === selectedAgent.value)
})

// Session tier — read from the user's currently selected model. The
// model's `tierHint` ('small'|'medium'|'large') is what the gateway
// will route by when this assistant turn fires.
const aiModel = useAIModel()
const sessionTier = computed<'small' | 'medium' | 'large'>(() => {
  const m = aiModel.currentModel.value
  const hint = (m as { tierHint?: 'small' | 'medium' | 'large' } | null)?.tierHint
  return hint || 'medium'
})
const sessionModelLabel = computed<string>(() => {
  const m = aiModel.currentModel.value
  if (!m) return ''
  const prov = aiModel.currentProvider.value
  const provLabel = prov?.label || prov?.id || ''
  const modelId = (m as { id: string }).id?.split('/').slice(-1)[0] || ''
  return provLabel ? `${provLabel} · ${modelId}` : modelId
})

// Detect space from route path. Stores the slug; never swaps agent.
function detectAndSwitch(path: string) {
  // /app/projects/:id/:spaceName -> space
  const spaceMatch = path.match(/\/app\/projects\/([^/]+)\/([^/]+)/)
  if (spaceMatch?.[2]) { activeSpace.value = spaceMatch[2]; return }
  // /app/projects or /app/projects/:id -> project space
  if (path.match(/\/app\/projects(\/[^/]+)?$/)) { activeSpace.value = 'project'; return }
  // /app/:spaceName -> space
  const directMatch = path.match(/\/app\/([a-z][\w-]*)/)
  if (directMatch?.[1] && !['settings', 'marketplace', 'onboarding'].includes(directMatch[1])) {
    activeSpace.value = directMatch[1]
    return
  }
  activeSpace.value = null
}

watch(() => router.currentRoute.value.path, detectAndSwitch)

watch(turns, async (nextTurns) => {
  const lastTurn = nextTurns[nextTurns.length - 1]
  if (!lastTurn || lastTurn.status !== 'done') return

  const autoActions = lastTurn.response
    .filter((block): block is ActionBlock => block.type === 'action')
    .flatMap(block => block.actions)
    .filter(action => action.auto && (action.url || action.spaceId))

  for (const action of autoActions) {
    const key = `${lastTurn.id}:${action.id}:${action.url ?? action.spaceId ?? ''}`
    if (executedActionKeys.has(key)) continue
    executedActionKeys.add(key)
    await executeAction(action)
  }
}, { deep: true })

// Standalone window: listen for space-changed events from main window
let unlistenSpace: (() => void) | null = null
if (props.standalone && isTauriEnv()) {
  import('@tauri-apps/api/event').then(({ listen }) => {
    listen<{ space: string }>('space-changed', (event) => {
      activeSpace.value = event.payload.space || null
    }).then(fn => { unlistenSpace = fn })
  })
}
onUnmounted(() => unlistenSpace?.())

// Standalone window controls
async function winClose() {
  if (isTauriEnv()) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().hide()
  } else {
    window.close()
  }
}

async function winMinimize() {
  if (isTauriEnv()) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().minimize()
  }
}

async function winMaximize() {
  if (isTauriEnv()) {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const win = getCurrentWindow()
    if (await win.isMaximized()) {
      await win.unmaximize()
    } else {
      await win.maximize()
    }
  }
}
</script>

<template>
  <div :class="[
    'flex flex-col bg-[var(--app-background)]/90 backdrop-blur-xl text-app',
    docked ? 'h-full' : 'w-[420px] rounded-2xl shadow-2xl border border-white/20 dark:border-white/10 overflow-hidden',
  ]">
    <!-- Header — draggable when floating (docked + non-standalone). -->
    <div class="flex items-center gap-3 px-4 py-3 border-b border-[var(--app-border)]/30 shrink-0 select-none"
      :class="[docked && !standalone ? 'cursor-move' : '']" :data-tauri-drag-region="standalone || undefined"
      @mousedown="onHeaderMouseDown">
      <!-- Traffic lights (standalone only) -->
      <div v-if="standalone" class="flex items-center gap-2 mr-1">
        <button class="size-3 rounded-full bg-[#ff5f57] hover:brightness-110 transition" @click="winClose" />
        <button class="size-3 rounded-full bg-[#febc2e] hover:brightness-110 transition" @click="winMinimize" />
        <button class="size-3 rounded-full bg-[#28c840] hover:brightness-110 transition" @click="winMaximize" />
      </div>

      <!-- Active agent indicator -->
      <div class="flex items-center gap-2 px-2.5 py-1 text-xs font-medium rounded-lg bg-white/50 dark:bg-white/10">
        <span class="size-2 rounded-full" :class="brain.connected.value ? 'bg-green-500' : 'bg-red-500'" />
        <span>{{ currentAgent?.name || 'General' }}</span>
      </div>

      <!-- Tier chip — which model bucket this turn will route through -->
      <div
        v-if="sessionModelLabel"
        class="px-2 py-0.5 text-[11px] font-medium rounded-md bg-white/40 dark:bg-white/5 text-app-foreground/70"
        :title="`Tier: ${sessionTier} · ${sessionModelLabel}`"
      >
        {{ sessionTier }}
      </div>

      <div class="flex-1" :data-tauri-drag-region="standalone || undefined">
        <span v-if="standalone" class="text-xs text-white/40 pointer-events-none" :data-tauri-drag-region="true">{{
          windowTitle }}</span>
      </div>

      <!-- Stop button (while loading) -->
      <button v-if="isLoading"
        class="p-1.5 text-red-400 hover:text-red-300 rounded-lg hover:bg-red-500/10 transition-colors"
        title="Stop (Escape)" @click="stop()">
        <svg class="size-4" viewBox="0 0 16 16">
          <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" />
        </svg>
      </button>

      <!-- Clear -->
      <button v-if="hasTurns"
        class="p-1.5 text-app-muted hover:text-app rounded-lg hover:bg-white/50 dark:hover:bg-white/10 transition-colors"
        title="Clear chat" @click="clear">
        <svg class="size-4" viewBox="0 0 16 16">
          <path d="M2 2h12M4 6h8M6 10h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
        </svg>
      </button>
      <!-- Open in window (not in standalone) -->
      <button v-if="!standalone"
        class="p-1.5 text-app-muted hover:text-app rounded-lg hover:bg-white/50 dark:hover:bg-white/10 transition-colors"
        title="Open in Window" @click="openInWindow">
        <svg class="size-4" viewBox="0 0 16 16">
          <path d="M14 6l-4-4m0 0L6 6m4-4v14m0-14l4 4M6 10l4 4m0 0l4-4m-4 4V2" stroke="currentColor"
            stroke-width="1.5" />
        </svg>
      </button>
      <!-- Close (not in standalone — traffic lights handle it) -->
      <button v-if="!standalone"
        class="p-1.5 text-app-muted hover:text-app rounded-lg hover:bg-white/50 dark:hover:bg-white/10 transition-colors"
        title="Close (Shift+Shift)" @click="closeAssistant">
        <svg class="size-4" viewBox="0 0 16 16">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" />
        </svg>
      </button>
    </div>

    <!-- Agent view: renders turns with blocks -->
    <AgentView :turns="turns" :is-loading="isLoading" :status-message="statusMessage" @action="handleAction">
      <template #empty>
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
          {{ brain.connected.value ? `Connected to Brain${brainVersion ? ` v${brainVersion}` : ''}` : 'Connecting to Brain…' }}
        </p>
      </template>
    </AgentView>

    <!-- Error -->
    <div v-if="error" class="mx-3 mb-1 px-3 py-2 text-xs text-red-500 bg-red-500/10 rounded-xl">
      {{ error }}
    </div>

    <!-- Input with drag-drop support -->
    <AgentInput ref="inputRef" :disabled="false" placeholder="Ask anything..." @send="handleSend" />
  </div>
</template>
