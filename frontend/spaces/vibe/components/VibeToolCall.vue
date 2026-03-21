<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ToolActivity } from '@/operator/useStreamStatus'

const props = defineProps<{
  call: ToolActivity
}>()

const emit = defineEmits<{
  stop: []
}>()

const expanded = ref(false)

const TOOL_NAMES: Record<string, string> = {
  bash: 'Bash',
  write_file: 'Write',
  edit_file: 'Edit',
  read_file: 'Read',
  list_dir: 'List',
  glob: 'Glob',
  grep: 'Grep',
  search: 'Search',
  spawn_agent: 'Agent',
}

const displayName = computed(() => TOOL_NAMES[props.call.tool] || props.call.tool)

const parsed = computed(() => {
  if (!props.call.input) return null
  try {
    return typeof props.call.input === 'string' ? JSON.parse(props.call.input) : props.call.input
  } catch {
    return null
  }
})

const primaryArg = computed(() => {
  const p = parsed.value
  if (!p || typeof p !== 'object') return ''
  switch (props.call.tool) {
    case 'bash': return p.command || ''
    case 'write_file':
    case 'edit_file':
    case 'read_file':
    case 'list_dir': return p.path || ''
    case 'glob':
    case 'grep':
    case 'search': return p.pattern || ''
    case 'spawn_agent': return p.agent_id || ''
    default: {
      const first = Object.values(p).find(v => typeof v === 'string' && v.trim())
      return typeof first === 'string' ? first : ''
    }
  }
})

const shortArg = computed(() => truncate(primaryArg.value, 80))
const hasDetails = computed(() => primaryArg.value.length > 80 || !!props.call.result)

function truncate(text: string, max: number): string {
  const t = text.trim()
  if (t.length <= max) return t
  return t.slice(0, max).trimEnd() + '…'
}
</script>

<template>
  <div class="py-0.5 font-mono text-xs leading-5">
    <div
      class="flex items-start gap-2 select-none"
      :class="hasDetails && 'cursor-pointer hover:bg-white/[0.03] -mx-1 px-1 rounded'"
      @click="hasDetails && (expanded = !expanded)"
    >
      <Icon
        :name="call.state === 'running' ? 'i-lucide-loader-2' : call.state === 'done' ? 'i-lucide-check' : 'i-lucide-x'"
        class="mt-1 size-3 shrink-0"
        :class="{
          'text-[#00ff41] animate-spin': call.state === 'running',
          'text-[#00ff41]': call.state === 'done',
          'text-red-400': call.state === 'error',
        }"
      />
      <span class="min-w-0 flex-1">
        <span class="text-[#33ff6a]">{{ displayName }}</span>
        <span v-if="primaryArg && !expanded" class="text-app-muted/70">('{{ shortArg }}')</span>
      </span>
      <button
        v-if="call.state === 'running'"
        class="rounded-md border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-red-200 transition hover:bg-red-500/15"
        title="Stop the current Vibe run"
        @click.stop="emit('stop')"
      >
        <Icon name="i-lucide-square" class="mr-1 inline size-3" />
        Stop Run
      </button>
      <Icon v-if="hasDetails" :name="expanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="size-3 mt-1 shrink-0 text-app-muted/30" />
    </div>
    <div v-if="expanded" class="ml-5 mt-1 mb-1.5 space-y-1.5">
      <div v-if="primaryArg" class="rounded-lg bg-black/30 px-3 py-2 text-[11px] text-app-muted/80 whitespace-pre-wrap break-all">{{ primaryArg }}</div>
      <div v-if="call.result" class="rounded-lg px-3 py-2 text-[11px] whitespace-pre-wrap break-all" :class="call.isError ? 'bg-red-500/10 text-red-300/80' : 'bg-[#00cc34]/8 text-[#33ff6a]/70'">{{ call.result }}</div>
    </div>
  </div>
</template>
