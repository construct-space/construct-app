<script setup lang="ts">
/**
 * AssistantPage — Full-page AI assistant for popout Tauri windows.
 *
 * Frameless window (decorations: false). Traffic lights + drag region
 * handled here. Coder-style rendering: unified stream with interleaved
 * tool calls, markdown text, and user messages.
 *
 * Context (project, space) received via BroadcastChannel from main window.
 */
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useProjectStore } from '@/stores/project'
import { useAgentSession } from '@/operator'
import { useMarkdown } from '@/composables/useMarkdown'
import { isTauriEnv } from '@/utils/tauri'
import AgentInput from '@/components/agent/AgentInput.vue'
import type { RequestBlock, ToolBlock, TextBlock } from '@/assistant'
import { Loader2, Check, X, ChevronUp, ChevronDown, AlertCircle } from 'lucide-vue-next'

const projectStore = useProjectStore()
const ready = ref(false)

const NAMES = ['Tank', 'Dozer', 'Switch', 'Link', 'Apoc', 'Niobe', 'Ghost', 'Sparks']
const windowTitle = `Operator ${NAMES[Math.floor(Math.random() * NAMES.length)]}`

// Session
const session = useAgentSession()
const { turns, isLoading, error, hasTurns, statusMessage, send, stop, clear, setAgent, selectedAgent, operator } = session
const { renderMarkdown } = useMarkdown()

const agentLabel = computed(() => {
  const id = selectedAgent.value
  if (!id || id === 'general') return 'Operator'
  // space:canvas → Canvas
  const name = id.replace(/^space:/, '')
  return name.charAt(0).toUpperCase() + name.slice(1)
})

// BroadcastChannel for cross-window communication
const channel = new BroadcastChannel('construct-assistant')

async function applyContext(data: { project?: { id: string; name: string; path: string } | null; space?: string | null; agent?: string }) {
  if (data.agent) {
    setAgent(data.agent)
  }
  if (data.project?.path) {
    const currentPath = projectStore.currentProject?.path
    if (currentPath !== data.project.path) {
      if (projectStore.projects.length === 0) {
        await projectStore.loadProjects()
      }
      projectStore.openProject(data.project.path)
    }
  } else if ('project' in data) {
    projectStore.clearCurrentProject()
  }
  ready.value = true
}

channel.onmessage = (event) => {
  if (event.data?.type === 'assistant-context') {
    void applyContext(event.data)
  }
}

onMounted(async () => {
  projectStore.clearCurrentProject()
  setTimeout(() => { if (!ready.value) ready.value = true }, 2000)
  try { await operator.connect() } catch { /* will show connection state */ }
})

onUnmounted(() => {
  channel.postMessage({ type: 'assistant-closed' })
  channel.close()
})

// ─── Tool display (coder-style) ───

const TOOL_NAMES: Record<string, string> = {
  bash: 'Bash', write_file: 'Write', edit_file: 'Edit', read_file: 'Read',
  list_dir: 'List', glob: 'Glob', grep: 'Grep', search: 'Search',
  spawn_agent: 'Agent', space_check: 'Check', space_build: 'Build',
  browser_tabs: 'Tabs', browser_open: 'Open', browser_close: 'Close',
  browser_navigate: 'Navigate', browser_snapshot: 'Snapshot',
  browser_click: 'Click', browser_type: 'Type', browser_press_key: 'Key',
  browser_wait_for: 'Wait', browser_screenshot: 'Screenshot',
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
        case 'spawn_agent':
          primaryArg = parsed.agent_id || ''; break
        default: {
          const first = Object.values(parsed).find(v => typeof v === 'string' && (v as string).trim())
          primaryArg = typeof first === 'string' ? first : ''
        }
      }
    }
  } catch { /* ignore parse errors */ }
  return {
    displayName: TOOL_NAMES[block.tool] || block.tool,
    primaryArg,
    shortArg: truncate(primaryArg, 80),
  }
}

// ─── Unified stream (flatten turns into chronological items) ───

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
    if (text.trim()) {
      items.push({ id: `${turn.id}-req`, type: 'user', content: text })
    }
    for (let i = 0; i < turn.response.length; i++) {
      const block = turn.response[i]
      if (block.type === 'text') {
        items.push({ id: `${turn.id}-res-${i}`, type: 'assistant', content: block.content })
      } else if (block.type === 'tool') {
        items.push({ id: `${turn.id}-res-${i}`, type: 'tool', toolBlock: block as ToolBlock })
      } else if (block.type === 'error') {
        items.push({ id: `${turn.id}-res-${i}`, type: 'error', content: (block as any).message })
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

// Input
function onSend(blocks: RequestBlock[]) {
  const agentId = selectedAgent.value || 'general'
  void send(blocks, { agentId })
}

// Keyboard: Escape to stop
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && isLoading.value) { e.preventDefault(); void stop() }
}
onMounted(() => window.addEventListener('keydown', handleKeydown))
onUnmounted(() => window.removeEventListener('keydown', handleKeydown))

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
    if (await win.isMaximized()) await win.unmaximize()
    else await win.maximize()
  }
}
</script>

<template>
  <div v-if="ready" class="h-screen w-screen overflow-hidden bg-app flex flex-col text-app">
    <!-- Header: traffic lights + status -->
    <div
      class="flex items-center gap-3 px-4 py-3 border-b border-[var(--app-border)]/30 shrink-0 select-none"
      data-tauri-drag-region
    >
      <div class="flex items-center gap-2 mr-1">
        <button class="size-3 rounded-full bg-[#ff5f57] hover:brightness-110 transition" @click="winClose" />
        <button class="size-3 rounded-full bg-[#febc2e] hover:brightness-110 transition" @click="winMinimize" />
        <button class="size-3 rounded-full bg-[#28c840] hover:brightness-110 transition" @click="winMaximize" />
      </div>

      <div class="flex items-center gap-2 px-2.5 py-1 text-xs font-medium rounded-lg bg-white/50 dark:bg-white/10">
        <span class="size-2 rounded-full" :class="operator.connected.value ? 'bg-green-500' : 'bg-red-500'" />
        <span>{{ agentLabel }}</span>
      </div>

      <div class="flex-1" data-tauri-drag-region>
        <span class="text-xs text-white/40 pointer-events-none" data-tauri-drag-region>{{ windowTitle }}</span>
      </div>

      <!-- Stop -->
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
    </div>

    <!-- Error banner -->
    <div v-if="error" class="shrink-0 flex items-start gap-2 px-4 py-2.5 border-b border-red-500/20 bg-red-500/8">
      <AlertCircle class="size-4 text-red-400 mt-0.5 shrink-0" />
      <p class="text-sm text-red-300 flex-1">{{ error }}</p>
    </div>

    <!-- Conversation stream (coder-style) -->
    <div ref="scrollRef" class="flex-1 overflow-y-auto scroll-smooth px-4 py-3 space-y-2">
      <!-- Empty state -->
      <div v-if="!stream.length && !isLoading" class="flex flex-col items-center justify-center h-full text-center">
        <div class="size-12 rounded-2xl bg-[color-mix(in_srgb,var(--app-foreground)_5%,transparent)] flex items-center justify-center mb-4">
          <svg class="size-6 text-app-muted" viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" fill="currentColor" opacity="0.3" />
          </svg>
        </div>
        <p class="text-sm text-app-muted mb-1">Ask anything</p>
        <p class="text-xs text-app-muted/60">
          {{ operator.connected.value ? 'Connected to Operator' : 'Connecting to Operator...' }}
        </p>
      </div>

      <!-- Stream items -->
      <template v-for="item in stream" :key="item.id">
        <!-- User message -->
        <div v-if="item.type === 'user'" class="flex justify-end">
          <div class="rounded-2xl bg-app-accent/15 text-app px-4 py-2 text-sm max-w-[80%]">{{ item.content }}</div>
        </div>

        <!-- Assistant text (markdown) -->
        <div
          v-else-if="item.type === 'assistant'"
          class="text-[13px] leading-6 text-[var(--app-foreground)]/80 prose prose-sm dark:prose-invert max-w-none [&_code]:bg-[var(--app-foreground)]/10 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[var(--app-accent)]/90 [&_code]:text-[12px] [&_h1]:text-[var(--app-foreground)] [&_h2]:text-[var(--app-foreground)] [&_h3]:text-[var(--app-foreground)] [&_h4]:text-[var(--app-foreground)] [&_strong]:text-[var(--app-foreground)] [&_hr]:border-[var(--app-border)]"
          v-html="renderMarkdown(item.content || '')"
        />

        <!-- Tool call (Claude Code style) -->
        <div v-else-if="item.type === 'tool' && item.toolBlock" class="font-mono text-xs leading-5">
          <div
            class="flex items-start gap-2 py-0.5 select-none cursor-pointer hover:bg-white/[0.03] -mx-1 px-1 rounded"
            @click="toggleTool(item.id)"
          >
            <Loader2 v-if="item.toolBlock.state === 'running'" class="mt-1 size-3 shrink-0 text-[var(--app-accent)] animate-spin" />
            <Check v-else-if="item.toolBlock.state === 'done'" class="mt-1 size-3 shrink-0 text-[var(--app-accent)]" />
            <X v-else class="mt-1 size-3 shrink-0 text-red-400" />
            <span class="min-w-0 flex-1">
              <span class="text-[var(--app-accent)]">{{ getToolDisplay(item.toolBlock).displayName }}</span>
              <span v-if="getToolDisplay(item.toolBlock).primaryArg && !expandedTools.has(item.id)" class="text-app-muted/70">
                ('{{ getToolDisplay(item.toolBlock).shortArg }}')
              </span>
            </span>
            <ChevronUp v-if="expandedTools.has(item.id)" class="size-3 mt-1 shrink-0 text-app-muted/30" />
            <ChevronDown v-else class="size-3 mt-1 shrink-0 text-app-muted/30" />
          </div>
          <div v-if="expandedTools.has(item.id)" class="ml-5 mt-1 mb-1.5 space-y-1.5">
            <div v-if="getToolDisplay(item.toolBlock).primaryArg" class="rounded-lg bg-black/30 px-3 py-2 text-[11px] text-app-muted/80 whitespace-pre-wrap break-all">
              {{ getToolDisplay(item.toolBlock).primaryArg }}
            </div>
            <div
              v-if="item.toolBlock.result"
              class="rounded-lg px-3 py-2 text-[11px] whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto"
              :class="item.toolBlock.state === 'error' ? 'bg-red-500/10 text-red-300/80' : 'bg-[var(--app-accent)]/8 text-[var(--app-accent)]/70'"
            >
              {{ item.toolBlock.result }}
            </div>
          </div>
        </div>

        <!-- Error -->
        <div v-else-if="item.type === 'error'" class="px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/10 text-xs text-red-500">
          {{ item.content }}
        </div>
      </template>

      <!-- Working indicator -->
      <div v-if="isLoading && stream.length > 0" class="flex items-center gap-2 text-xs text-app-muted py-1">
        <span class="size-1.5 rounded-full bg-[var(--app-accent)] animate-pulse" />
        <span>{{ statusMessage || 'Working...' }}</span>
      </div>
    </div>

    <!-- Input -->
    <div class="shrink-0 px-4 pb-3">
      <AgentInput
        :loading="isLoading"
        :disabled="!operator.connected.value"
        :placeholder="isLoading ? 'Redirect or steer...' : 'Ask anything...'"
        @send="onSend"
        @stop="stop()"
      />
    </div>
  </div>
</template>
