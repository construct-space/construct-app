<script setup lang="ts">
/**
 * ToolCard — Collapsible tool call visualization
 *
 * Shows: tool name + title in header, input + result in collapsible body.
 * State indicator: spinner (running), check (done), x (error).
 * Detects image URLs in results and shows inline previews.
 */
import { ref, computed } from 'vue'
import type { ToolBlock } from '@/assistant'
import { useActionTiers } from '@/composables/useActionTiers'
import type { Tier } from '@/composables/useTierConfig'

const props = defineProps<{
  block: ToolBlock
}>()

const emit = defineEmits<{
  (e: 'image-click', src: string, alt?: string): void
}>()

const expanded = ref(false)

// Extract image URLs from tool result for inline previews
const IMAGE_URL_RE = /https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|gif|webp|svg|avif)(?:\?[^\s"'<>]*)?/gi

// Data URI regex — captures whatever the screenshot_window tool (or
// anything else returning base64) embeds in its JSON. Greedy to the
// first non-base64 char so we don't bleed into surrounding JSON.
const DATA_URI_RE = /data:image\/(?:png|jpeg|jpg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+/g

const resultImages = computed<string[]>(() => {
  if (!props.block.result) return []
  const urls = props.block.result.match(IMAGE_URL_RE) || []
  const datas = props.block.result.match(DATA_URI_RE) || []
  // Deduplicate + cap at 12 so a wall of screenshots doesn't nuke the DOM
  return [...new Set([...urls, ...datas])].slice(0, 12)
})

// When the result is dominated by a data URI, the raw <pre> dump is
// pointless — a 2-5MB base64 string scrolling inside a 192px box is
// just noise. Collapse the raw display if we're already showing the
// image, keep a tiny header so debuggers can still copy `path`.
const hasDataUriImage = computed(() =>
  !!props.block.result && DATA_URI_RE.test(props.block.result),
)

// Tier chip — only for space_run_action calls; parses the input JSON
// to extract (space, action) and looks up the action's declared tier.
const { getTier } = useActionTiers()
const actionTier = computed<Tier | null | undefined>(() => {
  if (props.block.tool !== 'space_run_action') return null
  if (!props.block.input) return null
  try {
    const parsed = JSON.parse(props.block.input)
    const space = (parsed.space || parsed.space_id || '') as string
    const action = (parsed.action || '') as string
    if (!space || !action) return null
    return getTier(space, action)
  } catch {
    return null
  }
})

const displayResult = computed(() => {
  if (!props.block.result) return ''
  if (!hasDataUriImage.value) return props.block.result
  // Strip long base64 payloads from the pre view; show "<base64 N KB>"
  // so the user still sees the surrounding JSON structure.
  return props.block.result.replace(DATA_URI_RE, (match) => {
    const kb = Math.round(match.length / 1024)
    return `data:image/…;base64,<${kb}KB elided>`
  })
})
</script>

<template>
  <div
    class="rounded-lg border overflow-hidden text-xs my-1.5"
    :class="block.state === 'error' ? 'border-red-500/30' : 'border-app-border'"
  >
    <!-- Header -->
    <button
      class="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white/5"
      @click="expanded = !expanded"
    >
      <!-- State indicator -->
      <span v-if="block.state === 'running'" class="size-3.5 shrink-0">
        <span class="block size-3.5 rounded-full border-2 border-app-accent border-t-transparent animate-spin" />
      </span>
      <span v-else-if="block.state === 'done'" class="size-3.5 text-emerald-500 shrink-0">
        <svg viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" /></svg>
      </span>
      <span v-else class="size-3.5 text-red-500 shrink-0">
        <svg viewBox="0 0 16 16" fill="currentColor"><path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" /></svg>
      </span>

      <!-- Tool name -->
      <span class="font-mono text-app-muted">{{ block.tool }}</span>

      <!-- Tier chip — visible when the called action declares a tier -->
      <span
        v-if="actionTier"
        class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-white/40 dark:bg-white/5 text-app-foreground/70 shrink-0"
        :title="`Action declares tier: ${actionTier}`"
      >
        {{ actionTier }}
      </span>

      <!-- Title -->
      <span class="flex-1 truncate text-app-foreground/70">{{ block.title }}</span>

      <!-- Chevron -->
      <svg
        class="size-3 text-app-muted transition-transform shrink-0"
        :class="expanded ? 'rotate-180' : ''"
        viewBox="0 0 16 16" fill="currentColor"
      >
        <path d="M4.22 6.22a.75.75 0 011.06 0L8 8.94l2.72-2.72a.75.75 0 111.06 1.06l-3.25 3.25a.75.75 0 01-1.06 0L4.22 7.28a.75.75 0 010-1.06z" />
      </svg>
    </button>

    <!-- Body -->
    <div v-if="expanded" class="border-t border-app-border">
      <div v-if="block.input" class="px-3 py-2 bg-black/10 dark:bg-white/3">
        <div class="text-[10px] text-app-muted uppercase tracking-wider mb-1">Input</div>
        <pre class="text-app-foreground/80 whitespace-pre-wrap break-all font-mono text-[11px] max-h-32 overflow-auto">{{ block.input }}</pre>
      </div>
      <div v-if="block.result" class="px-3 py-2">
        <div class="text-[10px] text-app-muted uppercase tracking-wider mb-1">Result</div>
        <pre class="text-app-foreground/80 whitespace-pre-wrap break-all font-mono text-[11px] max-h-48 overflow-auto">{{ displayResult }}</pre>

        <!-- Image previews: HTTP URLs + data URIs from screenshot_window etc. -->
        <div v-if="resultImages.length > 0" class="mt-2 flex flex-wrap gap-2">
          <img
            v-for="(src, i) in resultImages" :key="i"
            :src="src"
            :alt="`screenshot ${i + 1}`"
            loading="lazy"
            :referrerpolicy="src.startsWith('data:') ? undefined : 'no-referrer'"
            :crossorigin="src.startsWith('data:') ? undefined : 'anonymous'"
            class="h-32 max-w-[320px] object-contain rounded border border-app-border cursor-pointer hover:brightness-110 transition bg-black/5"
            @error="($event.target as HTMLImageElement).style.display = 'none'"
            @click="emit('image-click', src, `screenshot ${i + 1}`)"
          />
        </div>
      </div>
    </div>
  </div>
</template>
