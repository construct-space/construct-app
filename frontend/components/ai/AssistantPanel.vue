<script setup lang="ts">
/**
 * AssistantPanel — AI chat panel powered by Operator
 *
 * Uses block-based AgentView for rendering turns with interleaved
 * tool calls, and AgentInput for text + image/file drag-drop.
 * Keeps backward compat: useAssistant still used by DefaultLayout/AppMenu
 * for visibility toggling; useAgentSession provides the session state.
 */

import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import { useAgentSession } from '@/operator'
import { useAssistant } from '@/operator'
import type { OperatorAgent } from '@/operator'
import type { RequestBlock } from '@/operator/useAgentSession'
import AgentView from '@/components/agent/AgentView.vue'
import AgentInput from '@/components/agent/AgentInput.vue'
import { useRouter } from 'vue-router'
import { isTauriEnv } from '@/utils/tauri'

const props = defineProps<{
  docked?: boolean
  standalone?: boolean
  windowTitle?: string
}>()

const session = useAgentSession()
const assistant = useAssistant()

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
  setAgent,
  operator,
} = session

// Open in window — reuse from useAssistant (has the Tauri window logic)
const { openInWindow, close: closeAssistant } = assistant

// Agents
const agents = ref<OperatorAgent[]>([])
const inputRef = ref<InstanceType<typeof AgentInput>>()

// Load agents on mount
const router = useRouter()

onMounted(async () => {
  try {
    await operator.connect()
    agents.value = await operator.listAgents()
    detectAndSwitch(router.currentRoute.value.path)
  } catch {
    // Operator not running — will show connection error
  }
  inputRef.value?.focus()
})

// Send from AgentInput
async function handleSend(blocks: RequestBlock[]) {
  await send(blocks)
}

// Keyboard: Escape to stop
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && isLoading.value) {
    e.preventDefault()
    void stop()
  }
}

onMounted(() => window.addEventListener('keydown', handleKeydown))
onUnmounted(() => window.removeEventListener('keydown', handleKeydown))

const currentAgent = computed(() =>
  agents.value.find(a => a.id === selectedAgent.value),
)

// Auto-switch agent based on active space
function findAgentForSpace(spaceName: string): OperatorAgent | undefined {
  return agents.value.find(a =>
    a.id === spaceName
    || a.id === `space:${spaceName}`
    || (a.category === 'space' && a.id.includes(spaceName)),
  )
}

function switchToSpace(space: string) {
  if (!agents.value.length) return
  const match = findAgentForSpace(space)
  setAgent(match ? match.id : 'general')
}

// Detect space from route path
function detectAndSwitch(path: string) {
  // /app/projects/:id/:spaceName -> space agent
  const spaceMatch = path.match(/\/app\/projects\/([^/]+)\/([^/]+)/)
  if (spaceMatch?.[2]) { switchToSpace(spaceMatch[2]); return }
  // /app/projects or /app/projects/:id -> project agent
  if (path.match(/\/app\/projects(\/[^/]+)?$/)) { switchToSpace('project'); return }
  // /app/:spaceName -> space agent
  const directMatch = path.match(/\/app\/([a-z][\w-]*)/)
  if (directMatch?.[1] && !['settings', 'marketplace', 'onboarding'].includes(directMatch[1])) {
    switchToSpace(directMatch[1])
  }
}

watch(() => router.currentRoute.value.path, detectAndSwitch)

// Standalone window: listen for space-changed events from main window
let unlistenSpace: (() => void) | null = null
if (props.standalone && isTauriEnv()) {
  import('@tauri-apps/api/event').then(({ listen }) => {
    listen<{ space: string }>('space-changed', (event) => {
      switchToSpace(event.payload.space)
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
  <div
    :class="[
      'flex flex-col bg-white/80 dark:bg-gray-950/90 backdrop-blur-xl text-app',
      docked ? 'h-full' : 'w-[420px] rounded-2xl shadow-2xl border border-white/20 dark:border-white/10 overflow-hidden',
    ]"
  >
    <!-- Header -->
    <div
      class="flex items-center gap-3 px-4 py-3 border-b border-gray-200/30 dark:border-gray-800/30 shrink-0"
      :class="standalone && 'select-none'"
      :data-tauri-drag-region="standalone || undefined"
    >
      <!-- Traffic lights (standalone only) -->
      <div v-if="standalone" class="flex items-center gap-2 mr-1">
        <button class="size-3 rounded-full bg-[#ff5f57] hover:brightness-110 transition" @click="winClose" />
        <button class="size-3 rounded-full bg-[#febc2e] hover:brightness-110 transition" @click="winMinimize" />
        <button class="size-3 rounded-full bg-[#28c840] hover:brightness-110 transition" @click="winMaximize" />
      </div>

      <!-- Active agent indicator -->
      <div class="flex items-center gap-2 px-2.5 py-1 text-xs font-medium rounded-lg bg-white/50 dark:bg-white/10">
        <span class="size-2 rounded-full" :class="operator.connected.value ? 'bg-green-500' : 'bg-red-500'" />
        <span>{{ currentAgent?.name || 'General' }}</span>
      </div>

      <div class="flex-1" :data-tauri-drag-region="standalone || undefined">
        <span v-if="standalone" class="text-xs text-white/40 pointer-events-none" :data-tauri-drag-region="true">{{ windowTitle }}</span>
      </div>

      <!-- Stop button (while loading) -->
      <button
        v-if="isLoading"
        class="p-1.5 text-red-400 hover:text-red-300 rounded-lg hover:bg-red-500/10 transition-colors"
        title="Stop (Escape)"
        @click="stop()"
      >
        <svg class="size-4" viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" /></svg>
      </button>

      <!-- Clear -->
      <button
        v-if="hasTurns"
        class="p-1.5 text-app-muted hover:text-app rounded-lg hover:bg-white/50 dark:hover:bg-white/10 transition-colors"
        title="Clear chat"
        @click="clear"
      >
        <svg class="size-4" viewBox="0 0 16 16"><path d="M2 2h12M4 6h8M6 10h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
      </button>
      <!-- Open in window (not in standalone) -->
      <button
        v-if="!standalone"
        class="p-1.5 text-app-muted hover:text-app rounded-lg hover:bg-white/50 dark:hover:bg-white/10 transition-colors"
        title="Open in Window"
        @click="openInWindow"
      >
        <svg class="size-4" viewBox="0 0 16 16"><path d="M14 6l-4-4m0 0L6 6m4-4v14m0-14l4 4M6 10l4 4m0 0l4-4m-4 4V2" stroke="currentColor" stroke-width="1.5" /></svg>
      </button>
      <!-- Close (not in standalone — traffic lights handle it) -->
      <button
        v-if="!standalone"
        class="p-1.5 text-app-muted hover:text-app rounded-lg hover:bg-white/50 dark:hover:bg-white/10 transition-colors"
        title="Close (Shift+Shift)"
        @click="closeAssistant"
      >
        <svg class="size-4" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" /></svg>
      </button>
    </div>

    <!-- Agent view: renders turns with blocks -->
    <AgentView
      :turns="turns"
      :is-loading="isLoading"
      :status-message="statusMessage"
    >
      <template #empty>
        <div class="size-12 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
          <svg class="size-6 text-app-muted" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" fill="currentColor" opacity="0.3" /></svg>
        </div>
        <p class="text-sm text-app-muted mb-1">Ask anything</p>
        <p class="text-xs text-app-muted/60">
          {{ operator.connected.value ? `Connected to Operator v${operator.version.value}` : 'Connecting to Operator...' }}
        </p>
      </template>
    </AgentView>

    <!-- Error -->
    <div v-if="error" class="mx-3 mb-1 px-3 py-2 text-xs text-red-500 bg-red-500/10 rounded-xl">
      {{ error }}
    </div>

    <!-- Input with drag-drop support -->
    <AgentInput
      ref="inputRef"
      :disabled="!operator.connected.value"
      placeholder="Ask anything..."
      @send="handleSend"
    />
  </div>
</template>
