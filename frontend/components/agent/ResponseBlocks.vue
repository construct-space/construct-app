<script setup lang="ts">
/**
 * ResponseBlocks — Renders an array of ResponseBlock[]
 *
 * Each block type gets its own visual treatment.
 * Text blocks render as markdown prose.
 * Unknown block types fall back to JSON display.
 */
import { computed } from 'vue'
import type { ResponseBlock } from '@/operator/useAgentSession'
import { useMarkdown } from '@/composables/useMarkdown'
import ToolCard from './ToolCard.vue'

const { renderMarkdown } = useMarkdown()

const props = defineProps<{
  blocks: ResponseBlock[]
}>()

const emit = defineEmits<{
  action: [actionId: string]
  'question-answer': [questionId: string, answer: string | string[]]
}>()

function openUrl(url: string) {
  window.open(url, '_blank')
}
</script>

<template>
  <div class="space-y-0">
    <template v-for="(block, i) in blocks" :key="i">
      <!-- Text (markdown) -->
      <div v-if="block.type === 'text'" class="text-sm leading-relaxed prose prose-sm prose-invert max-w-none py-0.5" v-html="renderMarkdown(block.content)" />

      <!-- Tool -->
      <ToolCard v-else-if="block.type === 'tool'" :block="block" />

      <!-- Code -->
      <div v-else-if="block.type === 'code'" class="my-1.5 rounded-lg overflow-hidden border border-app-border">
        <div class="flex items-center justify-between px-3 py-1 bg-black/10 dark:bg-white/5 text-[10px] text-app-muted">
          <span>{{ block.language }}</span>
          <span v-if="block.filename" class="font-mono">{{ block.filename }}</span>
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

      <!-- Question (interactive) -->
      <div v-else-if="block.type === 'question'" class="my-2 rounded-xl border border-app-border bg-white/[0.03] p-4">
        <p class="text-sm font-medium text-app mb-2">{{ block.question }}</p>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="opt in block.options"
            :key="opt.value"
            class="rounded-lg px-3 py-1.5 text-xs border transition"
            :class="[
              (Array.isArray(block.answer) ? block.answer.includes(opt.value) : block.answer === opt.value)
                ? 'border-app-accent bg-app-accent/10 text-app-accent'
                : 'border-app-border text-app-muted hover:border-app-accent/40'
            ]"
            @click="emit('question-answer', block.id, opt.value)"
          >
            <Icon v-if="opt.icon" :name="opt.icon" class="size-3 inline mr-1" />
            {{ opt.label }}
          </button>
        </div>
      </div>

      <!-- Plan -->
      <div v-else-if="block.type === 'plan'" class="my-2 rounded-xl border border-app-border bg-white/[0.03] p-4">
        <div class="flex items-center gap-2 mb-2">
          <Icon name="i-lucide-compass" class="size-4 text-app-accent" />
          <p class="text-sm font-semibold text-app">{{ block.name }}</p>
          <span v-if="block.planType" class="rounded-full bg-app-accent/10 px-2 py-0.5 text-[10px] text-app-accent">{{ block.planType }}</span>
        </div>
        <p class="text-xs text-app-muted mb-3">{{ block.description }}</p>
        <div v-if="block.tasks?.length" class="space-y-1">
          <div v-for="task in block.tasks" :key="task.id" class="flex items-start gap-2 text-xs">
            <span class="shrink-0 rounded bg-app-accent/15 px-1.5 py-0.5 text-[10px] font-mono text-app-accent">{{ task.id }}</span>
            <div>
              <span class="text-app font-medium">{{ task.title }}</span>
              <span v-if="task.files?.length" class="text-app-muted ml-1">({{ task.files.join(', ') }})</span>
            </div>
          </div>
        </div>
        <div v-else-if="block.features?.length" class="space-y-1">
          <div v-for="feat in block.features" :key="feat.name" class="text-xs">
            <span class="text-app font-medium">{{ feat.name }}</span>
            <span class="text-app-muted ml-1">{{ feat.description }}</span>
          </div>
        </div>
      </div>

      <!-- TaskList -->
      <div v-else-if="block.type === 'tasklist'" class="my-2 space-y-1">
        <div
          v-for="task in block.tasks"
          :key="task.id"
          class="flex items-center gap-2 rounded-lg px-3 py-2 text-xs border border-app-border"
          :class="{
            'bg-green-500/5 border-green-500/20': task.status === 'done',
            'bg-app-accent/5 border-app-accent/20': task.status === 'running',
            'bg-red-500/5 border-red-500/20': task.status === 'error',
          }"
        >
          <Icon
            :name="task.status === 'done' ? 'i-lucide-check-circle' : task.status === 'running' ? 'i-lucide-loader-2' : task.status === 'error' ? 'i-lucide-x-circle' : 'i-lucide-circle'"
            class="size-3.5 shrink-0"
            :class="{
              'text-green-500': task.status === 'done',
              'text-app-accent animate-spin': task.status === 'running',
              'text-red-500': task.status === 'error',
              'text-app-muted': task.status === 'pending',
            }"
          />
          <span class="text-app">{{ task.title }}</span>
        </div>
      </div>

      <!-- Progress -->
      <div v-else-if="block.type === 'progress'" class="my-1 rounded-lg border border-app-border bg-white/[0.03] px-3 py-2">
        <div class="flex items-center gap-2">
          <span class="size-1.5 rounded-full bg-[#00ff41] animate-pulse" />
          <span class="text-xs font-medium text-app">{{ block.headline }}</span>
          <span v-if="block.phase" class="text-[10px] text-app-muted">{{ block.phase }}</span>
        </div>
        <p v-if="block.detail" class="mt-1 text-xs text-app-muted">{{ block.detail }}</p>
        <div v-if="block.percent != null" class="mt-1.5 h-1 rounded-full bg-white/10 overflow-hidden">
          <div class="h-full bg-app-accent rounded-full transition-all" :style="{ width: `${block.percent}%` }" />
        </div>
      </div>

      <!-- Table -->
      <div v-else-if="block.type === 'table'" class="my-2 overflow-x-auto rounded-lg border border-app-border">
        <table class="w-full text-xs">
          <thead>
            <tr class="bg-white/5">
              <th v-for="h in block.headers" :key="h" class="px-3 py-1.5 text-left text-app-muted font-medium">{{ h }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, ri) in block.rows" :key="ri" class="border-t border-app-border">
              <td v-for="(cell, ci) in row" :key="ci" class="px-3 py-1.5 text-app">{{ cell }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="block.caption" class="px-3 py-1 text-[10px] text-app-muted">{{ block.caption }}</p>
      </div>

      <!-- JSON -->
      <div v-else-if="block.type === 'json'" class="my-1.5 rounded-lg overflow-hidden border border-app-border">
        <div v-if="block.label" class="px-3 py-1 bg-black/10 dark:bg-white/5 text-[10px] text-app-muted">
          {{ block.label }}
        </div>
        <pre class="px-3 py-2 text-xs font-mono overflow-x-auto"><code>{{ JSON.stringify(block.data, null, 2) }}</code></pre>
      </div>

      <!-- Action buttons -->
      <div v-else-if="block.type === 'action'" class="my-2 flex flex-wrap gap-2">
        <button
          v-for="act in block.actions"
          :key="act.id"
          :disabled="act.disabled"
          class="rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-40"
          :class="{
            'bg-app-accent text-black hover:bg-app-accent/80': act.variant === 'primary',
            'border border-app-border text-app hover:bg-white/5': !act.variant || act.variant === 'secondary',
            'bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20': act.variant === 'danger',
          }"
          @click="emit('action', act.id)"
        >
          <Icon v-if="act.icon" :name="act.icon" class="size-3 inline mr-1" />
          {{ act.label }}
        </button>
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
