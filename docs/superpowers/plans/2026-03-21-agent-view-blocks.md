# Agent View — Block-Based Session Model

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace flat text message bubbles with a block-based turn model where each turn shows the user's request and the agent's response as interleaved text explanations and collapsible tool cards.

**Architecture:** A `Turn` contains `RequestBlock[]` (what the user sent) and `ResponseBlock[]` (what the agent did). The `useAgentSession` composable parses operator stream events into blocks in real-time. `AgentView.vue` renders turns using sub-components `RequestBubble`, `ResponseBlocks`, and `ToolCard`. `AssistantPanel.vue` becomes a thin wrapper: header + input + AgentView.

**Tech Stack:** Vue 3 (script setup + TypeScript), Tailwind CSS, existing operator client (`useOperator`, `dispatchStream`), existing stream event types from `streamEvents.ts`.

---

## File Structure

```
src/operator/
  useAgentSession.ts      ← NEW: Turn/block types + stream-to-blocks parser
  useAssistant.ts          ← KEEP (deprecated, useAgentSession replaces it)
  useStreamStatus.ts       ← KEEP (reused internally by useAgentSession)
  streamEvents.ts          ← KEEP (event type constants)
  client.ts                ← KEEP (operator client)
  types.ts                 ← KEEP (operator protocol types)
  index.ts                 ← UPDATE: export useAgentSession

src/components/agent/
  AgentView.vue            ← NEW: Renders Turn[] — the reusable core
  RequestBubble.vue        ← NEW: Renders request blocks (text, image, file)
  ResponseBlocks.vue       ← NEW: Renders response blocks (text, tool, code, error)
  ToolCard.vue             ← NEW: Collapsible tool call card
  AgentInput.vue           ← NEW: Text input + drag-drop zone for images/files

src/components/ai/
  AssistantPanel.vue       ← REWRITE: thin shell around AgentView + AgentInput
```

### What each file does

| File | Responsibility |
|------|---------------|
| `useAgentSession.ts` | Manages `Turn[]` state. Parses stream events into ResponseBlocks. Creates RequestBlocks from user input. Handles send/clear/agent switching. |
| `AgentView.vue` | Scrollable list of turns. Each turn = RequestBubble + ResponseBlocks. Auto-scrolls on new content. Status indicator at bottom. |
| `RequestBubble.vue` | Right-aligned bubble. Renders text, image thumbnails, file chips. |
| `ResponseBlocks.vue` | Left-aligned block list. Iterates ResponseBlock[] and renders text (whitespace-pre-wrap), ToolCard, code (pre+code), SVG (v-html), image (img), error (red card). |
| `ToolCard.vue` | Collapsible card: header shows tool name + title + state icon. Body shows input + result (truncated, expandable). |
| `AgentInput.vue` | Input field + send button. Drag-drop zone for images/files. Emits `send(blocks: RequestBlock[])`. |
| `AssistantPanel.vue` | Header (agent name, connection status, window controls) + AgentView + AgentInput. |

---

## Chunk 1: Types and Composable

### Task 1: Define block types and Turn interface

**Files:**
- Create: `src/operator/useAgentSession.ts`

- [ ] **Step 1: Create the file with type definitions**

```ts
// src/operator/useAgentSession.ts
/**
 * useAgentSession — Block-based agent session
 *
 * Replaces useAssistant's flat text messages with structured turns.
 * Each turn = request blocks (from user) + response blocks (from agent).
 * Stream events are parsed into blocks in real-time.
 */

import { ref, computed, triggerRef } from 'vue'
import { useOperator } from './client'
import { useStreamStatus } from './useStreamStatus'
import { useAIModel } from '@/composables/useAIModel'
import { StreamType } from './streamEvents'
import type { StreamEvent, DispatchResult } from './types'

// ─── Block Types ───

export interface TextBlock {
  type: 'text'
  content: string
}

export interface ImageBlock {
  type: 'image'
  src: string
  alt?: string
}

export interface FileBlock {
  type: 'file'
  name: string
  path?: string
  size?: number
}

export interface ToolBlock {
  type: 'tool'
  tool: string
  title: string
  callId: string
  input?: string
  result?: string
  state: 'running' | 'done' | 'error'
}

export interface CodeBlock {
  type: 'code'
  language: string
  content: string
}

export interface SvgBlock {
  type: 'svg'
  content: string
}

export interface ErrorBlock {
  type: 'error'
  message: string
}

export interface StatusBlock {
  type: 'status'
  state: string
  message: string
  turn?: number
  maxTurns?: number
}

export type RequestBlock = TextBlock | ImageBlock | FileBlock
export type ResponseBlock = TextBlock | ToolBlock | CodeBlock | SvgBlock | ImageBlock | ErrorBlock | StatusBlock

export interface Turn {
  id: string
  request: RequestBlock[]
  response: ResponseBlock[]
  agentId: string
  status: 'pending' | 'streaming' | 'done' | 'error'
  timestamp: number
  turns?: number
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd /Users/flakerim/Construct/construct && npx tsc --noEmit src/operator/useAgentSession.ts 2>&1 | head -10`

(May have path alias issues — that's fine, we'll verify with the full build later.)

- [ ] **Step 3: Commit**

```bash
git add src/operator/useAgentSession.ts
git commit -m "feat(agent): add block types for Turn-based session model"
```

### Task 2: Implement useAgentSession composable

**Files:**
- Modify: `src/operator/useAgentSession.ts`

- [ ] **Step 1: Add the composable function after the types**

```ts
// ─── Session State ───

let turnCounter = 0
const nextTurnId = () => `turn-${++turnCounter}`

// Global visibility — matches useAssistant pattern
const showAssistant = ref(false)

export function useAgentSession() {
  const operator = useOperator()
  const streamStatus = useStreamStatus()
  const { defaultModelId } = useAIModel()

  const turns = ref<Turn[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const selectedAgent = ref('general')
  const selectedModel = ref<string | undefined>(undefined)

  let unlisten: (() => void) | null = null

  const hasTurns = computed(() => turns.value.length > 0)
  const effectiveModel = computed(() => selectedModel.value || defaultModelId.value)
  const activeTurn = computed(() => {
    const last = turns.value[turns.value.length - 1]
    return last?.status === 'streaming' ? last : null
  })

  // ─── Stream → Blocks parser ───

  function appendTextToResponse(turn: Turn, text: string) {
    const lastBlock = turn.response[turn.response.length - 1]
    if (lastBlock?.type === 'text') {
      lastBlock.content += text
    } else {
      turn.response.push({ type: 'text', content: text })
    }
  }

  function handleStreamChunk(turn: Turn, chunk: StreamEvent) {
    streamStatus.handleChunk(chunk)
    const type = chunk.type
    const data = chunk.data || {}

    // Text content — append to current or new text block
    const text = chunk.content || (data.text as string) || ''
    if (text && type !== 'tool.call' && type !== 'tool.result' && type !== 'status') {
      appendTextToResponse(turn, text)
      triggerRef(turns)
      return
    }

    // Tool call — insert tool block
    if (type === StreamType.ToolCall) {
      turn.response.push({
        type: 'tool',
        tool: (data.tool as string) || 'unknown',
        title: (data.title as string) || `Running ${data.tool}`,
        callId: (data.call_id as string) || '',
        input: typeof data.input === 'string' ? data.input : JSON.stringify(data.input || ''),
        state: 'running',
      })
      triggerRef(turns)
      return
    }

    // Tool result — update existing tool block
    if (type === StreamType.ToolResult) {
      const callId = data.call_id as string
      const toolBlock = turn.response.find(
        (b): b is ToolBlock => b.type === 'tool' && b.callId === callId,
      )
      if (toolBlock) {
        toolBlock.state = (data.is_error as boolean) ? 'error' : 'done'
        toolBlock.title = (data.title as string) || toolBlock.title
        const content = data.content as string | undefined
        if (content) {
          toolBlock.result = content.length > 3000 ? content.slice(0, 3000) + '…' : content
        }
      }
      triggerRef(turns)
      return
    }

    // Turn start — status indicator
    if (type === StreamType.TurnStart) {
      // Don't add visible status block, just update stream status
      return
    }
  }

  // ─── Send ───

  async function send(requestBlocks: RequestBlock[]): Promise<void> {
    if (isLoading.value) return

    // Extract text from request blocks
    const textContent = requestBlocks
      .filter((b): b is TextBlock => b.type === 'text')
      .map(b => b.content)
      .join('\n')
    if (!textContent.trim()) return

    // Create turn
    const turn: Turn = {
      id: nextTurnId(),
      request: requestBlocks,
      response: [],
      agentId: selectedAgent.value,
      status: 'streaming',
      timestamp: Date.now(),
    }
    turns.value.push(turn)

    isLoading.value = true
    error.value = null
    streamStatus.reset()

    // Build task with history context
    const history = turns.value.slice(0, -1).slice(-5) // last 5 turns for context
    let task = textContent.trim()
    if (history.length > 0) {
      const historyStr = history.map(t => {
        const req = t.request.filter((b): b is TextBlock => b.type === 'text').map(b => b.content).join('\n')
        const res = t.response.filter((b): b is TextBlock => b.type === 'text').map(b => b.content).join('\n')
        return `User: ${req}\n\nAssistant: ${res}`
      }).join('\n\n')
      task = `<conversation_history>\n${historyStr}\n</conversation_history>\n\nUser: ${textContent.trim()}`
    }

    try {
      unlisten = await operator.dispatchStream(
        selectedAgent.value,
        task,
        (chunk) => handleStreamChunk(turn, chunk),
        (result) => {
          streamStatus.handleDone()
          turn.status = 'done'
          turn.agentId = result.agent_id || turn.agentId
          turn.turns = result.turns

          // If no text response was streamed, use the final content
          const hasText = turn.response.some(b => b.type === 'text')
          if (!hasText && result.content) {
            turn.response.push({ type: 'text', content: result.content })
          }

          // Check for error in result
          const errMsg = (result as unknown as Record<string, unknown>).error as string | undefined
          if (errMsg) {
            error.value = errMsg
            turn.response.push({ type: 'error', message: errMsg })
          }

          isLoading.value = false
          triggerRef(turns)
          if (unlisten) { unlisten(); unlisten = null }
        },
        (err) => {
          streamStatus.handleError(err)
          error.value = err
          turn.status = 'error'
          turn.response.push({ type: 'error', message: err })
          isLoading.value = false
          triggerRef(turns)
          if (unlisten) { unlisten(); unlisten = null }
        },
        effectiveModel.value,
      )
    } catch {
      // Streaming not available — fall back to sync
      try {
        const result: DispatchResult = await operator.dispatch(
          selectedAgent.value,
          task,
          effectiveModel.value,
        )
        turn.response.push({ type: 'text', content: result.content })
        turn.status = 'done'
        turn.agentId = result.agent_id
        turn.turns = result.turns
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to get response'
        error.value = msg
        turn.response.push({ type: 'error', message: msg })
        turn.status = 'error'
      } finally {
        isLoading.value = false
        triggerRef(turns)
      }
    }
  }

  // ─── Convenience: send text only ───

  async function sendText(text: string): Promise<void> {
    if (!text.trim()) return
    return send([{ type: 'text', content: text.trim() }])
  }

  // ─── Convenience: send text + image ───

  async function sendWithImage(text: string, imageSrc: string): Promise<void> {
    const blocks: RequestBlock[] = []
    if (text.trim()) blocks.push({ type: 'text', content: text.trim() })
    blocks.push({ type: 'image', src: imageSrc })
    return send(blocks)
  }

  // ─── Controls ───

  function clear() {
    if (unlisten) { unlisten(); unlisten = null }
    turns.value = []
    error.value = null
    isLoading.value = false
    streamStatus.reset()
  }

  function setAgent(agentId: string) { selectedAgent.value = agentId }
  function setModel(model: string) { selectedModel.value = model }
  function toggle() { showAssistant.value = !showAssistant.value }
  function open() { showAssistant.value = true }
  function close() { showAssistant.value = false }

  return {
    // State
    turns,
    isLoading,
    error,
    hasTurns,
    activeTurn,
    selectedAgent,
    selectedModel,
    visible: showAssistant,

    // Stream status (from useStreamStatus)
    status: streamStatus.status,
    statusMessage: streamStatus.statusMessage,
    isAgentActive: streamStatus.isActive,
    toolHistory: streamStatus.toolHistory,

    // Actions
    send,
    sendText,
    sendWithImage,
    clear,
    setAgent,
    setModel,
    toggle,
    open,
    close,

    // Operator access
    operator,
  }
}
```

- [ ] **Step 2: Export from index.ts**

Add to `src/operator/index.ts`:
```ts
export { useAgentSession } from './useAgentSession'
export type { Turn, RequestBlock, ResponseBlock, ToolBlock, TextBlock, ImageBlock, FileBlock, CodeBlock, SvgBlock, ErrorBlock, StatusBlock } from './useAgentSession'
```

- [ ] **Step 3: Commit**

```bash
git add src/operator/useAgentSession.ts src/operator/index.ts
git commit -m "feat(agent): implement useAgentSession composable with stream-to-blocks parser"
```

---

## Chunk 2: Agent View Components

### Task 3: Create ToolCard component

**Files:**
- Create: `src/components/agent/ToolCard.vue`

- [ ] **Step 1: Create the component**

```vue
<script setup lang="ts">
/**
 * ToolCard — Collapsible tool call visualization
 *
 * Shows: tool name + title in header, input + result in collapsible body.
 * State indicator: spinner (running), check (done), x (error).
 */
import { ref } from 'vue'
import type { ToolBlock } from '@/operator/useAgentSession'

const props = defineProps<{
  block: ToolBlock
}>()

const expanded = ref(false)
</script>

<template>
  <div
    class="rounded-lg border overflow-hidden text-xs my-1.5"
    :class="block.state === 'error' ? 'border-red-500/30' : 'border-app-border'"
  >
    <!-- Header — always visible -->
    <button
      class="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white/5"
      @click="expanded = !expanded"
    >
      <!-- State indicator -->
      <span v-if="block.state === 'running'" class="size-3.5 shrink-0">
        <span class="block size-3.5 rounded-full border-2 border-app-accent border-t-transparent animate-spin" />
      </span>
      <span v-else-if="block.state === 'done'" class="size-3.5 text-emerald-500 shrink-0">
        <svg viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/></svg>
      </span>
      <span v-else class="size-3.5 text-red-500 shrink-0">
        <svg viewBox="0 0 16 16" fill="currentColor"><path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z"/></svg>
      </span>

      <!-- Tool name -->
      <span class="font-mono text-app-muted">{{ block.tool }}</span>

      <!-- Title -->
      <span class="flex-1 truncate text-app-foreground/70">{{ block.title }}</span>

      <!-- Chevron -->
      <svg
        class="size-3 text-app-muted transition-transform shrink-0"
        :class="expanded ? 'rotate-180' : ''"
        viewBox="0 0 16 16" fill="currentColor"
      >
        <path d="M4.22 6.22a.75.75 0 011.06 0L8 8.94l2.72-2.72a.75.75 0 111.06 1.06l-3.25 3.25a.75.75 0 01-1.06 0L4.22 7.28a.75.75 0 010-1.06z"/>
      </svg>
    </button>

    <!-- Body — collapsible -->
    <div v-if="expanded" class="border-t border-app-border">
      <!-- Input -->
      <div v-if="block.input" class="px-3 py-2 bg-black/10 dark:bg-white/3">
        <div class="text-[10px] text-app-muted uppercase tracking-wider mb-1">Input</div>
        <pre class="text-app-foreground/80 whitespace-pre-wrap break-all font-mono text-[11px] max-h-32 overflow-auto">{{ block.input }}</pre>
      </div>
      <!-- Result -->
      <div v-if="block.result" class="px-3 py-2">
        <div class="text-[10px] text-app-muted uppercase tracking-wider mb-1">Result</div>
        <pre class="text-app-foreground/80 whitespace-pre-wrap break-all font-mono text-[11px] max-h-48 overflow-auto">{{ block.result }}</pre>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
mkdir -p src/components/agent
git add src/components/agent/ToolCard.vue
git commit -m "feat(agent): add ToolCard collapsible component"
```

### Task 4: Create ResponseBlocks component

**Files:**
- Create: `src/components/agent/ResponseBlocks.vue`

- [ ] **Step 1: Create the component**

```vue
<script setup lang="ts">
/**
 * ResponseBlocks — Renders an array of ResponseBlock[]
 *
 * Each block type gets its own visual treatment:
 * - text: whitespace-pre-wrap prose
 * - tool: ToolCard (collapsible)
 * - code: pre+code with language label
 * - svg: inline render
 * - image: img tag
 * - error: red card
 * - status: subtle indicator
 */
import type { ResponseBlock } from '@/operator/useAgentSession'
import ToolCard from './ToolCard.vue'

defineProps<{
  blocks: ResponseBlock[]
}>()
</script>

<template>
  <div class="space-y-0">
    <template v-for="(block, i) in blocks" :key="i">
      <!-- Text -->
      <div v-if="block.type === 'text'" class="text-sm leading-relaxed whitespace-pre-wrap py-0.5">
        {{ block.content }}
      </div>

      <!-- Tool -->
      <ToolCard v-else-if="block.type === 'tool'" :block="block" />

      <!-- Code -->
      <div v-else-if="block.type === 'code'" class="my-1.5 rounded-lg overflow-hidden border border-app-border">
        <div class="flex items-center px-3 py-1 bg-black/10 dark:bg-white/5 text-[10px] text-app-muted">
          {{ block.language }}
        </div>
        <pre class="px-3 py-2 text-xs font-mono overflow-x-auto"><code>{{ block.content }}</code></pre>
      </div>

      <!-- SVG -->
      <div v-else-if="block.type === 'svg'" class="my-1.5 flex justify-center p-4 rounded-lg border border-app-border bg-white dark:bg-white/5" v-html="block.content" />

      <!-- Image -->
      <div v-else-if="block.type === 'image'" class="my-1.5">
        <img :src="block.src" :alt="block.alt || ''" class="max-w-full rounded-lg border border-app-border" />
      </div>

      <!-- Error -->
      <div v-else-if="block.type === 'error'" class="my-1.5 px-3 py-2 text-xs text-red-500 bg-red-500/10 rounded-lg border border-red-500/20">
        {{ block.message }}
      </div>

      <!-- Status -->
      <div v-else-if="block.type === 'status'" class="flex items-center gap-2 py-1 text-xs text-app-muted">
        <span class="size-1.5 rounded-full bg-app-accent animate-pulse" />
        {{ block.message }}
      </div>
    </template>
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/agent/ResponseBlocks.vue
git commit -m "feat(agent): add ResponseBlocks renderer"
```

### Task 5: Create RequestBubble component

**Files:**
- Create: `src/components/agent/RequestBubble.vue`

- [ ] **Step 1: Create the component**

```vue
<script setup lang="ts">
/**
 * RequestBubble — Renders request blocks (what the user sent)
 * Right-aligned bubble with text, image thumbnails, file chips.
 */
import type { RequestBlock } from '@/operator/useAgentSession'

defineProps<{
  blocks: RequestBlock[]
}>()
</script>

<template>
  <div class="flex justify-end">
    <div class="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-br-sm bg-app-accent text-app-accent-foreground">
      <template v-for="(block, i) in blocks" :key="i">
        <!-- Text -->
        <div v-if="block.type === 'text'" class="text-sm leading-relaxed">
          {{ block.content }}
        </div>

        <!-- Image thumbnail -->
        <div v-else-if="block.type === 'image'" class="mt-2">
          <img
            :src="block.src"
            :alt="block.alt || 'Attached image'"
            class="max-w-48 max-h-32 rounded-lg object-cover"
          />
        </div>

        <!-- File chip -->
        <div v-else-if="block.type === 'file'" class="mt-2 inline-flex items-center gap-1.5 px-2 py-1 bg-white/20 rounded-md text-xs">
          <svg class="size-3" viewBox="0 0 16 16" fill="currentColor"><path d="M14 4.5V14a2 2 0 01-2 2H4a2 2 0 01-2-2V2a2 2 0 012-2h5.5L14 4.5zM9.5 1v3.5H13" /></svg>
          {{ block.name }}
        </div>
      </template>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/agent/RequestBubble.vue
git commit -m "feat(agent): add RequestBubble component"
```

### Task 6: Create AgentView component

**Files:**
- Create: `src/components/agent/AgentView.vue`

- [ ] **Step 1: Create the component**

```vue
<script setup lang="ts">
/**
 * AgentView — Reusable turn-based agent conversation renderer
 *
 * Renders Turn[] as request bubbles + response blocks.
 * Auto-scrolls on new content. Shows status at bottom.
 * Used by AssistantPanel, Vibe, and any space embedding AI.
 */
import { ref, watch, nextTick } from 'vue'
import type { Turn } from '@/operator/useAgentSession'
import RequestBubble from './RequestBubble.vue'
import ResponseBlocks from './ResponseBlocks.vue'

const props = defineProps<{
  turns: Turn[]
  isLoading?: boolean
  statusMessage?: string
}>()

const scrollRef = ref<HTMLDivElement>()

// Auto-scroll when turns change or content streams
watch(
  () => {
    const len = props.turns.length
    const lastTurn = props.turns[len - 1]
    // Watch both turn count and last turn's response block count for streaming
    return `${len}-${lastTurn?.response.length || 0}`
  },
  () => {
    nextTick(() => {
      if (scrollRef.value) {
        scrollRef.value.scrollTop = scrollRef.value.scrollHeight
      }
    })
  },
)
</script>

<template>
  <div ref="scrollRef" class="flex-1 overflow-y-auto p-4 space-y-4">
    <!-- Empty state -->
    <div v-if="!turns.length" class="flex flex-col items-center justify-center h-full text-center px-8">
      <slot name="empty">
        <div class="size-12 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
          <svg class="size-6 text-app-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </div>
        <p class="text-sm text-app-muted">Ask anything</p>
      </slot>
    </div>

    <!-- Turns -->
    <div v-for="turn in turns" :key="turn.id" class="space-y-2">
      <!-- Request -->
      <RequestBubble :blocks="turn.request" />

      <!-- Response -->
      <div v-if="turn.response.length" class="max-w-[90%]">
        <ResponseBlocks :blocks="turn.response" />
      </div>
    </div>

    <!-- Loading indicator -->
    <div v-if="isLoading" class="flex items-center gap-2 text-app-muted px-1">
      <span class="flex gap-1">
        <span class="size-1.5 rounded-full bg-app-muted animate-bounce" style="animation-delay: 0ms" />
        <span class="size-1.5 rounded-full bg-app-muted animate-bounce" style="animation-delay: 150ms" />
        <span class="size-1.5 rounded-full bg-app-muted animate-bounce" style="animation-delay: 300ms" />
      </span>
      <span class="text-xs">{{ statusMessage || 'Thinking...' }}</span>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/agent/AgentView.vue
git commit -m "feat(agent): add AgentView turn renderer"
```

### Task 7: Create AgentInput component

**Files:**
- Create: `src/components/agent/AgentInput.vue`

- [ ] **Step 1: Create the component**

```vue
<script setup lang="ts">
/**
 * AgentInput — Text input with drag-drop for images/files
 *
 * Emits send(blocks) with text + any dropped images/files.
 */
import { ref } from 'vue'
import type { RequestBlock } from '@/operator/useAgentSession'

defineProps<{
  disabled?: boolean
  placeholder?: string
}>()

const emit = defineEmits<{
  send: [blocks: RequestBlock[]]
}>()

const input = ref('')
const inputRef = ref<HTMLInputElement>()
const attachments = ref<RequestBlock[]>([])
const isDragOver = ref(false)

function handleSend() {
  const blocks: RequestBlock[] = []
  if (input.value.trim()) {
    blocks.push({ type: 'text', content: input.value.trim() })
  }
  blocks.push(...attachments.value)
  if (blocks.length === 0) return

  emit('send', blocks)
  input.value = ''
  attachments.value = []
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}

function handleDrop(e: DragEvent) {
  e.preventDefault()
  isDragOver.value = false
  if (!e.dataTransfer?.files) return

  for (const file of e.dataTransfer.files) {
    if (file.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = () => {
        attachments.value.push({
          type: 'image',
          src: reader.result as string,
          alt: file.name,
        })
      }
      reader.readAsDataURL(file)
    } else {
      attachments.value.push({
        type: 'file',
        name: file.name,
        size: file.size,
      })
    }
  }
}

function removeAttachment(index: number) {
  attachments.value.splice(index, 1)
}

function focus() {
  inputRef.value?.focus()
}

defineExpose({ focus })
</script>

<template>
  <div
    class="p-3 border-t border-gray-200/30 dark:border-gray-800/30 shrink-0"
    :class="isDragOver ? 'bg-app-accent/5' : ''"
    @dragover.prevent="isDragOver = true"
    @dragleave="isDragOver = false"
    @drop="handleDrop"
  >
    <!-- Attachment previews -->
    <div v-if="attachments.length" class="flex flex-wrap gap-2 mb-2">
      <div v-for="(att, i) in attachments" :key="i" class="relative group">
        <img
          v-if="att.type === 'image'"
          :src="(att as any).src"
          class="size-12 rounded-lg object-cover border border-app-border"
        />
        <div
          v-else
          class="flex items-center gap-1 px-2 py-1 rounded-md bg-white/10 text-xs text-app-muted"
        >
          {{ (att as any).name }}
        </div>
        <button
          class="absolute -top-1 -right-1 size-4 rounded-full bg-red-500 text-white flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
          @click="removeAttachment(i)"
        >×</button>
      </div>
    </div>

    <!-- Input row -->
    <div class="flex items-center gap-2">
      <input
        ref="inputRef"
        v-model="input"
        type="text"
        :placeholder="placeholder || 'Ask anything...'"
        class="flex-1 px-4 py-2.5 text-sm bg-white/40 dark:bg-white/8 rounded-xl border-0 focus:ring-2 focus:ring-(--app-accent)/50 outline-none text-app placeholder-app-muted/50"
        :disabled="disabled"
        @keydown="handleKeydown"
      >
      <button
        class="p-2.5 rounded-xl bg-(--app-accent) text-app-accent-foreground hover:opacity-90 transition-opacity disabled:opacity-40"
        :disabled="(!input.trim() && !attachments.length) || disabled"
        @click="handleSend"
      >
        <svg class="size-4" viewBox="0 0 16 16"><path d="M3 13V3l10 5-10 5z" fill="currentColor" /></svg>
      </button>
    </div>

    <!-- Drop hint -->
    <div v-if="isDragOver" class="mt-2 text-center text-xs text-app-accent">
      Drop images or files here
    </div>
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/agent/AgentInput.vue
git commit -m "feat(agent): add AgentInput with drag-drop support"
```

---

## Chunk 3: AssistantPanel Rewrite

### Task 8: Rewrite AssistantPanel to use AgentView

**Files:**
- Rewrite: `src/components/ai/AssistantPanel.vue`

- [ ] **Step 1: Rewrite the component**

Replace the entire file. The new version is a thin wrapper: header (agent selector, connection, window controls) + AgentView + AgentInput.

```vue
<script setup lang="ts">
/**
 * AssistantPanel — AI assistant panel powered by Operator
 *
 * Thin wrapper around AgentView + AgentInput.
 * Manages: agent auto-switching, window mode, connection status.
 * All rendering delegated to AgentView.
 */
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import { useAgentSession } from '@/operator'
import type { OperatorAgent, RequestBlock } from '@/operator'
import { useRouter } from 'vue-router'
import { isTauriEnv } from '@/utils/tauri'
import AgentView from '@/components/agent/AgentView.vue'
import AgentInput from '@/components/agent/AgentInput.vue'

const props = defineProps<{
  docked?: boolean
  standalone?: boolean
  windowTitle?: string
}>()

const {
  turns,
  isLoading,
  error,
  hasTurns,
  selectedAgent,
  statusMessage,
  send,
  clear,
  setAgent,
  close: closeAssistant,
  operator,
} = useAgentSession()

const inputRef = ref<InstanceType<typeof AgentInput>>()

// Agents
const agents = ref<OperatorAgent[]>([])

onMounted(async () => {
  try {
    await operator.connect()
    agents.value = await operator.listAgents()
    detectAndSwitch(router.currentRoute.value.path)
  } catch (_) {
    // Operator not running
  }
  inputRef.value?.focus()
})

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

const router = useRouter()

function detectAndSwitch(path: string) {
  const spaceMatch = path.match(/\/app\/projects\/([^/]+)\/([^/]+)/)
  if (spaceMatch?.[2]) { switchToSpace(spaceMatch[2]); return }
  if (path.match(/\/app\/projects(\/[^/]+)?$/)) { switchToSpace('project'); return }
  const directMatch = path.match(/\/app\/([a-z][\w-]*)/)
  if (directMatch?.[1] && !['settings', 'marketplace', 'onboarding'].includes(directMatch[1])) {
    switchToSpace(directMatch[1])
  }
}

watch(() => router.currentRoute.value.path, detectAndSwitch)

// Standalone window: listen for space-changed events
let unlistenSpace: (() => void) | null = null
if (props.standalone && isTauriEnv()) {
  import('@tauri-apps/api/event').then(({ listen }) => {
    listen<{ space: string }>('space-changed', (event) => {
      switchToSpace(event.payload.space)
    }).then(fn => { unlistenSpace = fn })
  })
}
onUnmounted(() => unlistenSpace?.())

// Handle send from AgentInput
function handleSend(blocks: RequestBlock[]) {
  send(blocks)
}

// Window controls (standalone)
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

async function openInWindow() {
  if (!isTauriEnv()) {
    window.open('/assistant', 'assistant-popout', 'width=480,height=700')
    return
  }
  try {
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
    const win = await WebviewWindow.getByLabel('standalone-assistant')
    if (win) { await win.show(); await win.setFocus() }
    closeAssistant()
  } catch (e) {
    console.error('[AssistantPanel] Failed to open window:', e)
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

      <!-- Clear -->
      <button
        v-if="hasTurns"
        class="p-1.5 text-app-muted hover:text-app rounded-lg hover:bg-white/50 dark:hover:bg-white/10 transition-colors"
        title="Clear"
        @click="clear"
      >
        <svg class="size-4" viewBox="0 0 16 16"><path d="M2 2h12M4 6h8M6 10h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg>
      </button>
      <!-- Open in window -->
      <button
        v-if="!standalone"
        class="p-1.5 text-app-muted hover:text-app rounded-lg hover:bg-white/50 dark:hover:bg-white/10 transition-colors"
        title="Open in Window"
        @click="openInWindow"
      >
        <svg class="size-4" viewBox="0 0 16 16"><path d="M14 6l-4-4m0 0L6 6m4-4v14m0-14l4 4M6 10l4 4m0 0l4-4m-4 4V2" stroke="currentColor" stroke-width="1.5" /></svg>
      </button>
      <!-- Close -->
      <button
        v-if="!standalone"
        class="p-1.5 text-app-muted hover:text-app rounded-lg hover:bg-white/50 dark:hover:bg-white/10 transition-colors"
        title="Close (Shift+Shift)"
        @click="closeAssistant"
      >
        <svg class="size-4" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" /></svg>
      </button>
    </div>

    <!-- Agent View — renders all turns -->
    <AgentView
      :turns="turns"
      :is-loading="isLoading"
      :status-message="statusMessage"
    >
      <template #empty>
        <div class="size-12 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
          <svg class="size-6 text-app-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </div>
        <p class="text-sm text-app-muted mb-1">Ask anything</p>
        <p class="text-xs text-app-muted/60">
          {{ operator.connected.value ? `Connected to Operator v${operator.version.value}` : 'Connecting to Operator...' }}
        </p>
      </template>
    </AgentView>

    <!-- Input -->
    <AgentInput
      ref="inputRef"
      :disabled="!operator.connected.value"
      @send="handleSend"
    />
  </div>
</template>
```

- [ ] **Step 2: Verify the app still loads**

Run: `cd /Users/flakerim/Construct/construct && bun run dev`

Open the app, toggle the assistant panel (Shift+Shift), verify it renders. Send a message and confirm:
- User request shows as right-aligned bubble
- Agent response shows text blocks + collapsible tool cards
- Streaming updates in real-time
- Images can be drag-dropped onto the input area

- [ ] **Step 3: Commit**

```bash
git add src/components/ai/AssistantPanel.vue
git commit -m "feat(agent): rewrite AssistantPanel with block-based AgentView

Replaces flat text bubbles with Turn-based rendering:
- Text blocks show agent explanations
- ToolCard shows collapsible tool calls with input/result
- AgentInput supports drag-drop for images/files
- AgentView is reusable by any space (Vibe, etc.)"
```

---

## Summary

| Task | File | What |
|------|------|------|
| 1 | `useAgentSession.ts` | Block type definitions |
| 2 | `useAgentSession.ts` + `index.ts` | Composable: stream→blocks parser, send, history |
| 3 | `agent/ToolCard.vue` | Collapsible tool call card |
| 4 | `agent/ResponseBlocks.vue` | Response block renderer (text, tool, code, svg, image, error) |
| 5 | `agent/RequestBubble.vue` | User request bubble (text, image, file) |
| 6 | `agent/AgentView.vue` | Reusable turn renderer with auto-scroll |
| 7 | `agent/AgentInput.vue` | Text input + drag-drop |
| 8 | `ai/AssistantPanel.vue` | Thin wrapper: header + AgentView + AgentInput |

Total: 7 new files, 1 rewrite, 1 export update. `useAssistant.ts` stays for backward compat but `useAgentSession` is the new standard.
