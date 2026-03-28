<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { useProjectStore } from '@/stores/project'
import { useToolbar } from '@/composables/useToolbar'
import { useMarkdown } from '@/composables/useMarkdown'
import { useCoder } from '../composables/useCoder'
import { getToolDisplay } from '../utils/toolDisplay'
import AgentInput from '@/components/agent/AgentInput.vue'
import FileTree from '../components/FileTree.vue'
import type { RequestBlock } from '@/operator/useAgentSession'
import type { ToolActivity } from '@/operator/useStreamStatus'
import { Terminal } from 'lucide-vue-next'

const route = useRoute()
const projectStore = useProjectStore()
const { setBreadcrumbs } = useToolbar()
const { renderMarkdown } = useMarkdown()
const coder = useCoder()

const projectPath = computed(() => projectStore.currentProject?.local_path || projectStore.currentProject?.path || '')

watch(projectPath, (path) => {
  coder.setProjectPath(path)
}, { immediate: true })

// Breadcrumbs
const isProjectRoute = computed(() => /^\/app\/projects\//.test(route.path))
watch(
  () => projectStore.currentProject?.name,
  (name) => {
    if (isProjectRoute.value || !name) {
      setBreadcrumbs([])
      return
    }
    setBreadcrumbs([
      { label: 'PROJECTS', to: '/app/projects' },
      { label: name.toUpperCase() },
      { label: 'CODER' },
    ])
  },
  { immediate: true },
)

// Split pane
const splitPercent = ref(50)
const isDragging = ref(false)
const containerRef = ref<HTMLElement>()

function onDividerMouseDown(e: MouseEvent) {
  e.preventDefault()
  isDragging.value = true
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

function onMouseMove(e: MouseEvent) {
  if (!isDragging.value || !containerRef.value) return
  const rect = containerRef.value.getBoundingClientRect()
  const pct = ((e.clientX - rect.left) / rect.width) * 100
  splitPercent.value = Math.min(75, Math.max(25, pct))
}

function onMouseUp() {
  isDragging.value = false
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)
}

// Unified stream: interleave messages + tool calls chronologically
interface StreamItem {
  id: string
  type: 'user' | 'assistant' | 'tool'
  timestamp: number
  // text
  content?: string
  // tool
  tool?: ToolActivity
}

const stream = computed<StreamItem[]>(() => {
  const items: StreamItem[] = []

  for (const msg of coder.messages.value) {
    items.push({
      id: msg.id,
      type: msg.role === 'user' ? 'user' : 'assistant',
      timestamp: parseInt(msg.id.split('-').pop() || '0') || 0,
      content: msg.content,
    })
  }

  for (const tc of coder.toolHistory.value) {
    items.push({
      id: `tool-${tc.callId}`,
      type: 'tool',
      timestamp: tc.timestamp,
      tool: tc,
    })
  }

  items.sort((a, b) => a.timestamp - b.timestamp)
  return items
})

// Auto-scroll
const scrollRef = ref<HTMLElement>()
watch(
  () => {
    const s = stream.value
    const last = s[s.length - 1]
    return `${s.length}-${last?.tool?.state || ''}-${(last?.content || '').length}`
  },
  () => {
    nextTick(() => {
      if (scrollRef.value) scrollRef.value.scrollTop = scrollRef.value.scrollHeight
    })
  },
)

// Expandable tool details
const expandedTools = ref(new Set<string>())
function toggleTool(callId: string) {
  if (expandedTools.value.has(callId)) expandedTools.value.delete(callId)
  else expandedTools.value.add(callId)
}

function onSend(blocks: RequestBlock[]) {
  const text = blocks.filter(b => b.type === 'text').map(b => (b as { content: string }).content).join('\n')
  if (text.trim()) coder.send(text.trim())
}
</script>

<template>
  <DashboardPanel :grow="true" :ui="{ body: '!p-0 !overflow-hidden' }">
    <template #body>
      <div class="flex flex-col overflow-hidden" style="height: calc(100vh - 72px)">
        <!-- Empty state: hero only on global route, minimal on project route -->
        <div v-if="!coder.hasMessages.value && !coder.isRunning.value" class="flex-1 flex items-center justify-center px-6 py-6">
          <div class="w-full max-w-2xl space-y-6">
            <div v-if="!isProjectRoute" class="space-y-3">
              <Terminal class="size-10 text-[var(--app-accent)]" />
              <h1 class="text-2xl font-bold text-[var(--app-foreground)]">Coder</h1>
              <p class="text-sm text-[var(--app-muted)]">Describe a task. Coder reads, writes, builds, and verifies.</p>
            </div>
            <AgentInput
              :loading="false"
              :placeholder="isProjectRoute ? (projectStore.currentProject?.name || 'Project') + ' — what should I do?' : 'What should I build?'"
              @send="onSend"
            />
          </div>
        </div>

        <!-- Active session -->
        <template v-else>
          <!-- Toolbar -->
          <Teleport to="#toolbar-left">
            <div class="flex items-center gap-1.5">
              <Terminal class="size-3 text-[var(--app-accent)]" />
              <span v-if="coder.isRunning.value" class="size-1.5 rounded-full bg-[var(--app-accent)] animate-pulse" />
            </div>
          </Teleport>
          <Teleport to="#toolbar-right">
            <button
              class="rounded-md px-2 py-0.5 text-[10px] font-medium text-[var(--app-muted)] transition hover:text-[var(--app-foreground)] hover:bg-[color-mix(in_srgb,var(--app-foreground)_5%,transparent)]"
              :disabled="coder.isRunning.value"
              @click="coder.clear()"
            >
              New
            </button>
          </Teleport>

          <!-- Error banner -->
          <div v-if="coder.error.value" class="shrink-0 flex items-start gap-2 px-4 py-2.5 border-b border-red-500/20 bg-red-500/8">
            <Icon name="i-lucide-alert-circle" class="size-4 text-red-400 mt-0.5 shrink-0" />
            <p class="text-sm text-red-300 flex-1">{{ coder.error.value }}</p>
          </div>

          <!-- Split pane -->
          <div ref="containerRef" class="flex-1 flex min-h-0" :class="isDragging && 'select-none'">
            <!-- LEFT: Conversation (text + tool calls interleaved) -->
            <div class="flex flex-col min-w-0 min-h-0 overflow-hidden" :style="{ width: splitPercent + '%' }">
              <div ref="scrollRef" class="flex-1 overflow-y-auto scroll-smooth px-4 py-3 space-y-2">
                <template v-for="item in stream" :key="item.id">
                  <!-- User message -->
                  <div v-if="item.type === 'user'" class="flex justify-end">
                    <div class="rounded-2xl bg-app-accent/15 text-app px-4 py-2 text-sm max-w-[80%]">{{ item.content }}</div>
                  </div>

                  <!-- Assistant text -->
                  <div v-else-if="item.type === 'assistant'" class="text-[13px] leading-6 text-[var(--app-foreground)]/80 prose prose-sm prose-invert max-w-none [&_code]:bg-white/10 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-[var(--app-accent)]/90 [&_code]:text-[12px]" v-html="renderMarkdown(item.content || '')" />

                  <!-- Tool call (Claude Code style) -->
                  <div v-else-if="item.type === 'tool' && item.tool" class="font-mono text-xs leading-5">
                    <div
                      class="flex items-start gap-2 py-0.5 select-none cursor-pointer hover:bg-white/[0.03] -mx-1 px-1 rounded"
                      @click="toggleTool(item.tool!.callId)"
                    >
                      <Icon
                        :name="item.tool.state === 'running' ? 'i-lucide-loader-2' : item.tool.state === 'done' ? 'i-lucide-check' : 'i-lucide-x'"
                        class="mt-1 size-3 shrink-0"
                        :class="{
                          'text-[var(--app-accent)] animate-spin': item.tool.state === 'running',
                          'text-[var(--app-accent)]': item.tool.state === 'done',
                          'text-red-400': item.tool.state === 'error',
                        }"
                      />
                      <span class="min-w-0 flex-1">
                        <span class="text-[var(--app-accent)]">{{ getToolDisplay(item.tool).displayName }}</span>
                        <span v-if="getToolDisplay(item.tool).primaryArg && !expandedTools.has(item.tool.callId)" class="text-app-muted/70">('{{ getToolDisplay(item.tool).shortArg }}')</span>
                      </span>
                      <Icon :name="expandedTools.has(item.tool.callId) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="size-3 mt-1 shrink-0 text-app-muted/30" />
                    </div>
                    <div v-if="expandedTools.has(item.tool.callId)" class="ml-5 mt-1 mb-1.5 space-y-1.5">
                      <div v-if="getToolDisplay(item.tool).primaryArg" class="rounded-lg bg-black/30 px-3 py-2 text-[11px] text-app-muted/80 whitespace-pre-wrap break-all">{{ getToolDisplay(item.tool).primaryArg }}</div>
                      <div v-if="item.tool.result" class="rounded-lg px-3 py-2 text-[11px] whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto" :class="item.tool.isError ? 'bg-red-500/10 text-red-300/80' : 'bg-[var(--app-accent)]/8 text-[var(--app-accent)]/70'">{{ item.tool.result }}</div>
                    </div>
                  </div>
                </template>

                <!-- Working indicator -->
                <div v-if="coder.isRunning.value && stream.length > 0" class="flex items-center gap-2 text-xs text-app-muted py-1">
                  <span class="size-1.5 rounded-full bg-[var(--app-accent)] animate-pulse" />
                  <span>{{ coder.statusMessage.value || 'Working...' }}</span>
                </div>
              </div>

              <!-- Input -->
              <div class="shrink-0 flex justify-center">
                <div class="w-full max-w-2xl">
                  <AgentInput
                    :loading="coder.isRunning.value"
                    placeholder="Follow up..."
                    @send="onSend"
                    @stop="coder.stop()"
                  />
                </div>
              </div>
            </div>

            <!-- Divider -->
            <div
              class="w-1 shrink-0 cursor-col-resize group relative flex items-center justify-center hover:bg-[var(--app-accent)]/10 transition-colors"
              :class="isDragging && 'bg-[var(--app-accent)]/10'"
              @mousedown="onDividerMouseDown"
              @dblclick="splitPercent = 50"
            >
              <div class="w-px h-full group-hover:w-0.5 rounded-full transition-all" :class="isDragging ? 'w-0.5 bg-[var(--app-accent)]/40' : 'bg-[var(--app-border)]/20 group-hover:bg-[var(--app-accent)]/30'" />
            </div>

            <!-- RIGHT: Files -->
            <div class="min-h-0 overflow-hidden flex-1 flex flex-col bg-black/10">
              <FileTree
                :tool-history="coder.toolHistory.value"
                :is-running="coder.isRunning.value"
              />
            </div>
          </div>
        </template>
      </div>
    </template>
  </DashboardPanel>
</template>
