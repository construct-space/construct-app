<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useMarkdown } from '@/composables/useMarkdown'

const props = defineProps<{
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
}>()

const { renderStreamingMarkdown, renderMarkdown, initModules } = useMarkdown()
const ready = ref(false)

onMounted(async () => {
  await initModules()
  ready.value = true
})

const renderedHtml = computed(() => {
  if (props.role === 'user' || !ready.value) return ''
  return props.isStreaming
    ? renderStreamingMarkdown(props.content)
    : renderMarkdown(props.content)
})
</script>

<template>
  <div
    class="rounded-2xl border px-4 py-3"
    :class="role === 'user'
      ? 'ml-8 border-[#00ff41]/15 bg-[#00ff41]/6'
      : 'mr-8 border-app bg-white/[0.03]'"
  >
    <p class="text-[10px] uppercase tracking-[0.16em] text-app-muted/60 mb-1.5">
      {{ role === 'user' ? 'You' : 'Vibe' }}
    </p>
    <div v-if="role === 'user'" class="text-sm leading-6 text-app whitespace-pre-wrap">
      {{ content }}
    </div>
    <div
      v-else
      class="prose prose-sm dark:prose-invert max-w-none prose-p:leading-6 prose-pre:bg-black/30 prose-code:text-[#66ff93]/90"
      v-html="renderedHtml"
    />
    <span
      v-if="isStreaming && role === 'assistant'"
      class="inline-block w-1.5 h-4 bg-[#00ff41] animate-pulse ml-0.5 align-text-bottom"
    />
  </div>
</template>
