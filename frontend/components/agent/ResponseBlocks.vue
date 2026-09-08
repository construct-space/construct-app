<script setup lang="ts">
/**
 * ResponseBlocks — Thin dispatcher for ResponseBlock[]
 *
 * Each block type is rendered by its own sub-component.
 * Keeps this file small and lets Vue optimize per-block re-renders.
 */
import { ref, watch, onUnmounted } from 'vue'
import type { ResponseBlock } from '@/assistant'
import { resolveBlockRenderer } from '@/assistant'
import { useMarkdown } from '@/composables/useMarkdown'
import ToolCard from './ToolCard.vue'
import VideoEmbed from './VideoEmbed.vue'
import QuestionBlock from './QuestionBlock.vue'
import PlanBlock from './PlanBlock.vue'
import TaskListBlock from './TaskListBlock.vue'
import CodeBlockCard from './CodeBlockCard.vue'
import ProgressCard from './ProgressCard.vue'
import ActionButtons from './ActionButtons.vue'
import TableBlockVue from './TableBlock.vue'
import { ExternalLink } from 'lucide-vue-next'
import type { ActionBlock } from '@/assistant'

const { renderMarkdownParts, renderStreamingMarkdownParts } = useMarkdown()

// ── Image lightbox ──
const lightbox = ref<{ src: string; alt?: string } | null>(null)

function openLightbox(src: string, alt?: string) {
  lightbox.value = { src, alt }
}

function closeLightbox() {
  lightbox.value = null
}

function onLightboxKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && lightbox.value) closeLightbox()
}

watch(lightbox, (v) => {
  if (v) document.addEventListener('keydown', onLightboxKeydown)
  else document.removeEventListener('keydown', onLightboxKeydown)
})

onUnmounted(() => document.removeEventListener('keydown', onLightboxKeydown))

// Make prose images clickable for lightbox
function handleProseClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (target.tagName === 'IMG' && target instanceof HTMLImageElement) {
    e.preventDefault()
    openLightbox(target.src, target.alt)
  }
}

// SVG sanitizer — strips scripts, event handlers, and unsafe elements
const sanitizedSvgs = ref<Record<number, string>>({})

let _dompurify: typeof import('dompurify').default | null = null
function getSanitizedSvg(index: number, raw: string): string {
  if (sanitizedSvgs.value[index]) return sanitizedSvgs.value[index]
  // Kick off async sanitization, return empty until ready
  if (!_dompurify) {
    import('dompurify').then(m => {
      _dompurify = m.default
      sanitizedSvgs.value[index] = _dompurify.sanitize(raw, {
        USE_PROFILES: { svg: true, svgFilters: true },
        FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'object', 'embed'],
        FORBID_ATTR: ['onload', 'onerror', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
      })
    })
    return ''
  }
  sanitizedSvgs.value[index] = _dompurify.sanitize(raw, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'foreignObject', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['onload', 'onerror', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
  })
  return sanitizedSvgs.value[index]
}

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
  // Fallback: try to extract message from JSON
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0])
      const msg = parsed?.error?.message || parsed?.error || parsed?.message
      if (msg && typeof msg === 'string') return msg
    } catch { /* not JSON */ }
  }

  return raw
}

function parseErrorDetails(raw: string): Array<{ key: string; value: string }> | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null
  try {
    const parsed = JSON.parse(jsonMatch[0])
    const entries: Array<{ key: string; value: string }> = []
    const flatten = (obj: Record<string, unknown>, prefix = '') => {
      for (const [k, v] of Object.entries(obj)) {
        const key = prefix ? `${prefix}.${k}` : k
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          flatten(v as Record<string, unknown>, key)
        } else {
          entries.push({ key, value: String(v) })
        }
      }
    }
    flatten(parsed)
    return entries.length > 0 ? entries : null
  } catch { return null }
}

const emit = defineEmits<{
  action: [action: ActionBlock['actions'][number]]
  'question-answer': [questionId: string, answer: string | string[]]
}>()

// Matches a single LETTERED choice-option line — `a) …`, `(a) …`, `a. …`,
// `a: …` — the kind that gets converted to clickable buttons. Deliberately
// NOT markdown bullets (`-`/`*`) or numbered lists (`1.`): those are normal
// answer content. The old, broader regex stripped every trailing list line
// during streaming, so any list-shaped answer froze at its pre-list text
// until the stream finished and then dumped whole — reading as a hang.
const OPTION_RE = /^\s*\(?[a-z][).:]\s+.+$/i

/**
 * While streaming, strip a trailing run of lettered choice-options from the
 * last text block so the user doesn't see raw `a) …` lines flicker before they
 * become buttons. Normal prose, bullet lists and numbered lists are left
 * intact so they stream incrementally.
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

function renderTextBlockParts(block: { content: string }, index: number) {
  const content = displayText(block, index)
  return props.streaming ? renderStreamingMarkdownParts(content) : renderMarkdownParts(content)
}

function openUrl(url: string) {
  window.open(url, '_blank')
}

/**
 * Look up a custom renderer for namespaced block types (e.g. "architect:plan").
 * Returns the Vue component if registered, undefined otherwise.
 */
function getCustomRenderer(block: ResponseBlock) {
  const blockType = (block as unknown as { type: string }).type
  if (blockType.includes(':')) {
    return resolveBlockRenderer(blockType)
  }
  return undefined
}
</script>

<template>
  <div class="space-y-0">
    <template v-for="(block, i) in blocks" :key="i">
      <!-- Text (markdown) -->
      <div v-if="block.type === 'text'" class="response-prose text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none py-0.5" @click="handleProseClick">
        <div v-for="part in renderTextBlockParts(block, i)" :key="part.key" v-html="part.html" />
      </div>
      <!-- Video embeds detected in text -->
      <VideoEmbed v-if="block.type === 'text'" :content="(block as any).content" />

      <!-- Tool -->
      <ToolCard v-else-if="block.type === 'tool'" :block="block" @image-click="openLightbox" />

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
      <ActionButtons v-else-if="block.type === 'action'" :block="block" @action="(action) => emit('action', action)" />

      <!-- Table -->
      <TableBlockVue v-else-if="block.type === 'table'" :block="block" />

      <!-- SVG (sanitized) -->
      <div v-else-if="block.type === 'svg'" class="my-1.5 flex justify-center p-4 rounded-lg border border-app-border bg-white dark:bg-white/5" v-html="getSanitizedSvg(i, block.content)" />

      <!-- Image -->
      <div v-else-if="block.type === 'image'" class="my-1.5">
        <img
          :src="block.src"
          :alt="block.alt || ''"
          class="max-w-full max-h-[400px] object-contain rounded-lg border border-app-border cursor-pointer hover:brightness-110 transition"
          loading="lazy"
          @click="openLightbox(block.src, block.alt)"
        />
        <p v-if="block.alt" class="mt-1 text-[10px] text-app-muted">{{ block.alt }}</p>
      </div>

      <!-- Error -->
      <div v-else-if="block.type === 'error'" class="my-1.5 px-3 py-2.5 rounded-lg border border-red-500/30 bg-red-500/10">
        <p class="text-xs font-medium text-red-500">{{ formatError(block.message) }}</p>
        <details v-if="formatError(block.message) !== block.message" class="mt-2">
          <summary class="text-[11px] text-red-400 cursor-pointer hover:text-red-300">Details</summary>
          <div v-if="parseErrorDetails(block.message)" class="mt-1.5 space-y-0.5">
            <div v-for="entry in parseErrorDetails(block.message)" :key="entry.key"
              class="flex gap-2 text-[11px] leading-relaxed">
              <span class="text-red-500/70 shrink-0">{{ entry.key }}:</span>
              <span class="text-red-400 break-all">{{ entry.value }}</span>
            </div>
          </div>
          <pre v-else class="mt-1 text-[11px] text-red-400 whitespace-pre-wrap break-all">{{ block.message }}</pre>
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
        <ExternalLink v-else class="size-3.5 text-app-muted" />
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

      <!-- Custom block renderer (namespaced types like "architect:plan") -->
      <component
        v-else-if="getCustomRenderer(block)"
        :is="getCustomRenderer(block)!"
        :data="(block as any).data"
        :block="block"
        @answer="(qId: string, answer: string | string[]) => emit('question-answer', qId, answer)"
        @action="(action: ActionBlock['actions'][number]) => emit('action', action)"
      />

      <!-- Unknown block fallback -->
      <div v-else class="my-1 px-3 py-2 text-xs text-app-muted bg-white/2 rounded-lg border border-dashed border-app-border">
        <span class="font-mono text-[10px]">{{ (block as any).type }}</span>
        <pre class="mt-1 text-[10px] overflow-x-auto">{{ JSON.stringify(block, null, 2) }}</pre>
      </div>
    </template>
  </div>

  <!-- Image lightbox -->
  <Teleport to="body">
    <div
      v-if="lightbox"
      role="dialog"
      aria-modal="true"
      :aria-label="lightbox.alt || 'Image preview'"
      tabindex="-1"
      class="fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 cursor-pointer"
      @click="closeLightbox"
    >
      <img
        :src="lightbox.src"
        :alt="lightbox.alt || ''"
        class="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
        @click.stop
      />
      <p v-if="lightbox.alt" class="absolute bottom-6 text-sm text-white/70 text-center max-w-lg">
        {{ lightbox.alt }}
      </p>
    </div>
  </Teleport>
</template>

<style scoped>
.response-prose {
  --tw-prose-body: var(--app-foreground);
  --tw-prose-headings: var(--app-foreground);
  --tw-prose-bold: var(--app-foreground);
  --tw-prose-links: var(--app-accent);
  --tw-prose-code: var(--app-foreground);
}

/* Images inside prose (rendered from markdown ![](url)) */
.response-prose :deep(img) {
  max-width: 100%;
  max-height: 400px;
  object-fit: contain;
  border-radius: 8px;
  border: 1px solid var(--app-border);
  cursor: pointer;
  transition: filter 0.15s;
}
.response-prose :deep(img:hover) {
  filter: brightness(1.1);
}
</style>
