<script setup lang="ts">
/**
 * ResponseBlocks — Thin dispatcher for ResponseBlock[]
 *
 * Each block type is rendered by its own sub-component.
 * Keeps this file small and lets Vue optimize per-block re-renders.
 */
import type { ResponseBlock } from '@/operator/useAgentSession'
import { useMarkdown } from '@/composables/useMarkdown'
import ToolCard from './ToolCard.vue'
import QuestionBlock from './QuestionBlock.vue'
import PlanBlock from './PlanBlock.vue'
import TaskListBlock from './TaskListBlock.vue'
import CodeBlockCard from './CodeBlockCard.vue'
import ProgressCard from './ProgressCard.vue'
import ActionButtons from './ActionButtons.vue'
import TableBlockVue from './TableBlock.vue'

const { renderMarkdown } = useMarkdown()

const props = defineProps<{
  blocks: ResponseBlock[]
  streaming?: boolean
}>()

function formatError(raw: string): string {
  const lower = raw.toLowerCase()

  // Rate limit
  if (lower.includes('429') || lower.includes('rate-limit') || lower.includes('rate limit')) {
    return 'This model is temporarily rate-limited. Wait a moment and retry, or switch to a different model.'
  }
  // No endpoints / privacy policy
  if (lower.includes('no endpoints') || lower.includes('guardrail') || lower.includes('data policy')) {
    return 'This model is blocked by your OpenRouter privacy settings. Update them at openrouter.ai/settings/privacy.'
  }
  // Auth / key errors
  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('invalid api key') || lower.includes('invalid_api_key')) {
    return 'Authentication failed. Check your API key in Settings → Providers.'
  }
  // Model not found
  if (lower.includes('404') && (lower.includes('model') || lower.includes('not found'))) {
    return 'Model not found. It may have been removed. Choose a different model in Settings → LLMs.'
  }
  // Quota / billing
  if (lower.includes('402') || lower.includes('quota') || lower.includes('insufficient') || lower.includes('billing')) {
    return 'Quota exceeded or billing issue. Check your provider account.'
  }
  // Context length
  if (lower.includes('context length') || lower.includes('too many tokens') || lower.includes('max.*token')) {
    return 'Message too long for this model. Try a shorter prompt or a model with a larger context window.'
  }
  // Server error
  if (lower.includes('500') || lower.includes('internal server error') || lower.includes('502') || lower.includes('503')) {
    return 'Provider server error. Try again in a moment.'
  }
  // Not connected
  if (lower.includes('not connected')) {
    return 'Not connected to the operator service. Restart the app or check Settings → Developer.'
  }
  // Fallback: strip JSON noise, show just the message
  try {
    const parsed = JSON.parse(raw)
    const msg = parsed?.error?.message || parsed?.error || parsed?.message
    if (msg && typeof msg === 'string') return msg
  } catch { /* not JSON */ }

  return raw
}

const emit = defineEmits<{
  action: [actionId: string]
  'question-answer': [questionId: string, answer: string | string[]]
}>()

const OPTION_RE = /^\s*(?:[-*]|\(?[a-z0-9]\)?[.):]\s*\*{0,2}).+$/i

/**
 * While streaming, strip trailing option-like lines from the last text block
 * so the user doesn't see raw markdown options that will become buttons.
 */
function displayText(block: { content: string }, index: number): string {
  if (!props.streaming) return block.content
  const isLastText = (() => {
    for (let i = props.blocks.length - 1; i >= 0; i--) {
      if (props.blocks[i].type === 'text') return i === index
    }
    return false
  })()
  if (!isLastText) return block.content

  const lines = block.content.split('\n')
  let end = lines.length
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line) { if (end < lines.length) end = i; continue }
    if (OPTION_RE.test(line)) { end = i } else break
  }
  return lines.slice(0, end).join('\n')
}

function openUrl(url: string) {
  window.open(url, '_blank')
}
</script>

<template>
  <div class="space-y-0">
    <template v-for="(block, i) in blocks" :key="i">
      <!-- Text (markdown) -->
      <div v-if="block.type === 'text'" class="response-prose text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none py-0.5" v-html="renderMarkdown(displayText(block, i))" />

      <!-- Tool -->
      <ToolCard v-else-if="block.type === 'tool'" :block="block" />

      <!-- Code -->
      <CodeBlockCard v-else-if="block.type === 'code'" :block="block" />

      <!-- Question (interactive) -->
      <QuestionBlock v-else-if="block.type === 'question'" :block="block" @answer="(qId, answer) => emit('question-answer', qId, answer)" />

      <!-- Plan -->
      <PlanBlock v-else-if="block.type === 'plan'" :block="block" />

      <!-- TaskList -->
      <TaskListBlock v-else-if="block.type === 'tasklist'" :block="block" />

      <!-- Progress -->
      <ProgressCard v-else-if="block.type === 'progress'" :block="block" />

      <!-- Action buttons -->
      <ActionButtons v-else-if="block.type === 'action'" :block="block" @action="(id) => emit('action', id)" />

      <!-- Table -->
      <TableBlockVue v-else-if="block.type === 'table'" :block="block" />

      <!-- SVG -->
      <div v-else-if="block.type === 'svg'" class="my-1.5 flex justify-center p-4 rounded-lg border border-app-border bg-white dark:bg-white/5" v-html="block.content" />

      <!-- Image -->
      <div v-else-if="block.type === 'image'" class="my-1.5">
        <img :src="block.src" :alt="block.alt || ''" class="max-w-full rounded-lg border border-app-border" />
      </div>

      <!-- Error -->
      <div v-else-if="block.type === 'error'" class="my-1.5 px-3 py-2.5 rounded-lg border border-red-500/20 bg-red-500/10">
        <p class="text-xs font-medium text-red-400">{{ formatError(block.message) }}</p>
        <details v-if="formatError(block.message) !== block.message" class="mt-1.5">
          <summary class="text-[10px] text-red-400/50 cursor-pointer hover:text-red-400/80">Raw error</summary>
          <pre class="mt-1 text-[10px] text-red-400/40 whitespace-pre-wrap break-all">{{ block.message }}</pre>
        </details>
      </div>

      <!-- Status -->
      <div v-else-if="block.type === 'status'" class="flex items-center gap-2 py-1 text-xs text-app-muted">
        <span class="size-1.5 rounded-full bg-app-accent animate-pulse" />
        {{ block.message }}
      </div>

      <!-- JSON -->
      <div v-else-if="block.type === 'json'" class="my-1.5 rounded-lg overflow-hidden border border-app-border">
        <div v-if="block.label" class="px-3 py-1 bg-black/10 dark:bg-white/5 text-[10px] text-app-muted">
          {{ block.label }}
        </div>
        <pre class="px-3 py-2 text-xs font-mono overflow-x-auto"><code>{{ JSON.stringify(block.data, null, 2) }}</code></pre>
      </div>

      <!-- Link -->
      <div v-else-if="block.type === 'link'" class="my-1.5 flex items-center gap-2 rounded-lg border border-app-border px-3 py-2 hover:bg-white/5 transition cursor-pointer" @click="openUrl(block.url)">
        <img v-if="block.favicon" :src="block.favicon" class="size-4 rounded" />
        <Icon v-else name="i-lucide-external-link" class="size-3.5 text-app-muted" />
        <div class="min-w-0">
          <p class="text-xs font-medium text-app truncate">{{ block.title || block.url }}</p>
          <p v-if="block.description" class="text-[10px] text-app-muted truncate">{{ block.description }}</p>
        </div>
      </div>

      <!-- Diff -->
      <div v-else-if="block.type === 'diff'" class="my-1.5 rounded-lg overflow-hidden border border-app-border">
        <div class="px-3 py-1 bg-black/10 dark:bg-white/5 text-[10px] text-app-muted font-mono">
          {{ block.filename }}
        </div>
        <pre class="px-3 py-2 text-xs font-mono overflow-x-auto"><code>{{ block.hunks }}</code></pre>
      </div>

      <!-- Unknown block fallback -->
      <div v-else class="my-1 px-3 py-2 text-xs text-app-muted bg-white/[0.02] rounded-lg border border-dashed border-app-border">
        <span class="font-mono text-[10px]">{{ (block as any).type }}</span>
        <pre class="mt-1 text-[10px] overflow-x-auto">{{ JSON.stringify(block, null, 2) }}</pre>
      </div>
    </template>
  </div>
</template>

<style scoped>
.response-prose {
  --tw-prose-body: var(--app-foreground);
  --tw-prose-headings: var(--app-foreground);
  --tw-prose-bold: var(--app-foreground);
  --tw-prose-links: var(--app-accent);
  --tw-prose-code: var(--app-foreground);
}
</style>
