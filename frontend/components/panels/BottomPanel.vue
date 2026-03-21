<script setup lang="ts">
/**
 * BottomPanel - Modern bottom panel with tabs
 * Supports Output, Debug Console, Problems, Terminal tabs
 * Ported from construct-mono (Nuxt) to Vue/Vite
 */

const props = withDefaults(defineProps<{
  modelValue?: boolean
  activeTab?: 'output' | 'debug' | 'problems' | 'terminal'
  output?: string
  debugOutput?: string
  problems?: Array<{ type: 'error' | 'warning' | 'info'; message: string; file?: string; line?: number }>
  isRunning?: boolean
  processName?: string
  processStatus?: 'starting' | 'running' | 'stopping' | 'stopped' | 'error'
}>(), {
  modelValue: true,
  activeTab: 'output',
  output: '',
  debugOutput: '',
  problems: () => [],
  isRunning: false,
  processName: '',
  processStatus: 'stopped'
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'update:activeTab': [tab: 'output' | 'debug' | 'problems' | 'terminal']
  clear: []
  stop: []
  hotReload: []
  hotRestart: []
}>()

const currentTab = computed({
  get: () => props.activeTab,
  set: (val) => emit('update:activeTab', val)
})

const tabs = computed(() => [
  { id: 'output' as const, label: 'Output', icon: 'i-lucide-terminal-square' },
  { id: 'debug' as const, label: 'Debug Console', icon: 'i-lucide-bug' },
  { id: 'problems' as const, label: 'Problems', icon: 'i-lucide-alert-circle', badge: props.problems.length || undefined },
  { id: 'terminal' as const, label: 'Terminal', icon: 'i-lucide-terminal' }
])

// Auto-scroll output
const outputRef = ref<HTMLElement | null>(null)
const debugRef = ref<HTMLElement | null>(null)

watch(() => props.output, () => {
  nextTick(() => {
    if (outputRef.value) {
      outputRef.value.scrollTop = outputRef.value.scrollHeight
    }
  })
})

watch(() => props.debugOutput, () => {
  nextTick(() => {
    if (debugRef.value) {
      debugRef.value.scrollTop = debugRef.value.scrollHeight
    }
  })
})

// Problem counts
const errorCount = computed(() => props.problems.filter(p => p.type === 'error').length)
const warningCount = computed(() => props.problems.filter(p => p.type === 'warning').length)

// Strip ANSI escape codes from terminal output
const stripAnsi = (text: string): string => {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1B(?:\[[0-9;]*[a-zA-Z]|\][^\x07]*\x07|.)/g, '')
}

// Escape HTML to prevent XSS
const escapeHtml = (text: string): string => {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// Colorize output with syntax highlighting
const colorizeOutput = (text: string): string => {
  if (!text) return ''

  const cleanText = stripAnsi(text)

  return cleanText
    .split('\n')
    .map(line => {
      if (line.includes('✓') || line.includes('✔')) {
        return `<span class="text-green-400">${escapeHtml(line)}</span>`
      }
      if (line.toLowerCase().includes('error') || line.toLowerCase().includes('failed')) {
        return `<span class="text-red-400">${escapeHtml(line)}</span>`
      }
      if (line.toLowerCase().includes('warning')) {
        return `<span class="text-yellow-400">${escapeHtml(line)}</span>`
      }
      if (line.includes('VITE') && line.includes('ready')) {
        return `<span class="text-purple-400 font-bold">${escapeHtml(line)}</span>`
      }
      if (line.includes('➜')) {
        const escaped = escapeHtml(line)
        return escaped
          .replace(/➜/, '<span class="text-green-400">➜</span>')
          .replace(/(Local:|Network:)/g, '<span class="text-cyan-400">$1</span>')
          .replace(/(https?:\/\/[^\s]+)/g, '<span class="text-blue-400 underline">$1</span>')
          .replace(/(use --host to expose)/g, '<span class="text-app-muted">$1</span>')
      }
      if (line.startsWith('$ ') || line.startsWith('bun run') || line.startsWith('npm run') || line.startsWith('yarn ') || line.startsWith('pnpm ')) {
        return `<span class="text-yellow-400">${escapeHtml(line)}</span>`
      }
      if (line.toLowerCase().includes('port') && line.toLowerCase().includes('in use')) {
        return `<span class="text-yellow-400">${escapeHtml(line)}</span>`
      }
      if (line.startsWith('flutter:')) {
        return `<span class="text-cyan-400">${escapeHtml(line)}</span>`
      }
      if (/^[rRhdcq]\s/.test(line)) {
        const [key = '', ...rest] = line.split(' ')
        return `<span class="text-yellow-400 font-bold">${escapeHtml(key)}</span> <span class="text-app-muted">${escapeHtml(rest.join(' '))}</span>`
      }
      if (line.startsWith('flutter ') || line.startsWith('dart ')) {
        return `<span class="text-purple-400">${escapeHtml(line)}</span>`
      }
      if (line.includes('Launching') || line.includes('Building') || line.includes('Syncing') || line.includes('Compiling')) {
        return `<span class="text-blue-400">${escapeHtml(line)}</span>`
      }
      if (line.includes('Flutter run key commands')) {
        return `<span class="text-app font-medium">${escapeHtml(line)}</span>`
      }
      if (line.includes('DevTools') || line.includes('VM Service')) {
        return `<span class="text-green-400">${escapeHtml(line)}</span>`
      }
      if (line.includes('http://') || line.includes('https://')) {
        return escapeHtml(line).replace(
          /(https?:\/\/[^\s]+)/g,
          '<span class="text-blue-400 underline">$1</span>'
        )
      }
      if (/\[\d{2}:\d{2}:\d{2}\]/.test(line)) {
        return escapeHtml(line).replace(
          /(\[\d{2}:\d{2}:\d{2}\])/g,
          '<span class="text-app-muted">$1</span>'
        )
      }
      return `<span class="text-app-muted">${escapeHtml(line)}</span>`
    })
    .join('\n')
}

// Status color
const statusColor = computed(() => {
  switch (props.processStatus) {
    case 'running':
    case 'starting':
      return 'text-green-400'
    case 'error':
      return 'text-red-400'
    default:
      return 'text-app-muted'
  }
})

const statusBgColor = computed(() => {
  switch (props.processStatus) {
    case 'running':
    case 'starting':
      return 'bg-green-500/10 border-green-500/20'
    case 'error':
      return 'bg-red-500/10 border-red-500/20'
    default:
      return 'bg-white/5 border-white/10'
  }
})
</script>

<template>
  <div v-if="modelValue" class="flex flex-col h-full bg-app">
    <!-- Panel Header -->
    <div class="flex items-center justify-between h-9 px-2 bg-white/5">
      <!-- Tabs -->
      <div class="flex items-center gap-0.5">
        <button v-for="tab in tabs" :key="tab.id"
          class="flex items-center gap-1.5 px-3 h-7 text-xs rounded-md transition-colors" :class="currentTab === tab.id
            ? 'bg-white/10 text-app font-medium'
            : 'text-app-muted hover:text-app hover:bg-white/5'" @click="currentTab = tab.id">
          <Icon :name="tab.icon" class="size-3.5" />
          <span>{{ tab.label }}</span>
          <span v-if="tab.id === 'problems' && problems.length > 0"
            class="ml-1 px-1.5 py-0.5 text-[10px] font-medium rounded-full"
            :class="errorCount > 0 ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'">
            {{ problems.length }}
          </span>
        </button>
      </div>

      <!-- Controls -->
      <div class="flex items-center gap-1">
        <!-- Running indicator -->
        <div v-if="isRunning && processName" class="flex items-center gap-1.5 px-2 h-6 rounded-md mr-2"
          :class="statusBgColor">
          <span class="size-1.5 rounded-full"
            :class="processStatus === 'running' || processStatus === 'starting' ? 'bg-green-400 animate-pulse' : 'bg-red-400'" />
          <span class="text-xs" :class="statusColor">{{ processName }}</span>
        </div>

        <!-- Action buttons -->
        <template v-if="isRunning">
          <Tooltip text="Hot Reload (r)">
            <button class="p-1.5 rounded-md text-yellow-400 hover:bg-yellow-500/10 transition-colors"
              @click="emit('hotReload')">
              <Icon name="i-lucide-zap" class="size-4" />
            </button>
          </Tooltip>

          <Tooltip text="Restart (R)">
            <button class="p-1.5 rounded-md text-orange-400 hover:bg-orange-500/10 transition-colors"
              @click="emit('hotRestart')">
              <Icon name="i-lucide-refresh-cw" class="size-4" />
            </button>
          </Tooltip>

          <Tooltip text="Stop">
            <button class="p-1.5 rounded-md text-red-400 hover:bg-red-500/10 transition-colors" @click="emit('stop')">
              <Icon name="i-lucide-square" class="size-4" />
            </button>
          </Tooltip>

          <div class="w-px h-4 bg-white/10 mx-1" />
        </template>

        <Tooltip text="Clear">
          <button class="p-1.5 rounded-md text-app-muted hover:text-app hover:bg-white/5 transition-colors"
            @click="emit('clear')">
            <Icon name="i-lucide-trash-2" class="size-4" />
          </button>
        </Tooltip>

        <Tooltip text="Close Panel">
          <button class="p-1.5 rounded-md text-app-muted hover:text-app hover:bg-white/5 transition-colors"
            @click="emit('update:modelValue', false)">
            <Icon name="i-lucide-x" class="size-4" />
          </button>
        </Tooltip>
      </div>
    </div>

    <!-- Content Area -->
    <div class="flex-1 min-h-0 overflow-hidden">
      <!-- Output Tab -->
      <div v-show="currentTab === 'output'" ref="outputRef"
        class="h-full overflow-auto p-3 font-mono text-xs leading-relaxed">
        <!-- eslint-disable vue/no-v-html -->
        <pre v-if="output" class="whitespace-pre-wrap wrap-break-word" v-html="colorizeOutput(output)" />
        <!-- eslint-enable vue/no-v-html -->
        <pre v-else class="text-app-muted whitespace-pre-wrap">No output</pre>
      </div>

      <!-- Debug Console Tab -->
      <div v-show="currentTab === 'debug'" ref="debugRef"
        class="h-full overflow-auto p-3 font-mono text-xs leading-relaxed">
        <!-- eslint-disable vue/no-v-html -->
        <pre v-if="debugOutput" class="whitespace-pre-wrap wrap-break-word" v-html="colorizeOutput(debugOutput)" />
        <!-- eslint-enable vue/no-v-html -->
        <pre v-else class="text-app-muted whitespace-pre-wrap">No debug output</pre>
      </div>

      <!-- Problems Tab -->
      <div v-show="currentTab === 'problems'" class="h-full overflow-auto">
        <div v-if="problems.length === 0" class="flex flex-col items-center justify-center h-full text-app-muted">
          <Icon name="i-lucide-check-circle" class="size-8 mb-2 text-green-400" />
          <span class="text-sm">No problems detected</span>
        </div>

        <div v-else class="divide-y divide-white/10">
          <div v-for="(problem, index) in problems" :key="index"
            class="flex items-start gap-3 px-3 py-2 hover:bg-white/5 transition-colors cursor-pointer">
            <Icon :name="problem.type === 'error' ? 'i-lucide-x-circle' :
              problem.type === 'warning' ? 'i-lucide-alert-triangle' :
                'i-lucide-info'" class="size-4 mt-0.5 shrink-0" :class="problem.type === 'error' ? 'text-red-400' :
                      problem.type === 'warning' ? 'text-yellow-400' :
                        'text-blue-400'" />
            <div class="flex-1 min-w-0">
              <p class="text-xs text-app">{{ problem.message }}</p>
              <p v-if="problem.file" class="text-xs text-app-muted mt-0.5">
                {{ problem.file }}<span v-if="problem.line">:{{ problem.line }}</span>
              </p>
            </div>
          </div>
        </div>

        <!-- Summary bar -->
        <div v-if="problems.length > 0" class="sticky bottom-0 px-3 py-1.5 bg-white/5 border-t border-white/10">
          <div class="flex items-center gap-4 text-xs">
            <span v-if="errorCount > 0" class="flex items-center gap-1 text-red-400">
              <Icon name="i-lucide-x-circle" class="size-3.5" />
              {{ errorCount }} {{ errorCount === 1 ? 'error' : 'errors' }}
            </span>
            <span v-if="warningCount > 0" class="flex items-center gap-1 text-yellow-400">
              <Icon name="i-lucide-alert-triangle" class="size-3.5" />
              {{ warningCount }} {{ warningCount === 1 ? 'warning' : 'warnings' }}
            </span>
          </div>
        </div>
      </div>

      <!-- Terminal Tab -->
      <div v-show="currentTab === 'terminal'" class="h-full">
        <slot name="terminal">
          <div class="flex items-center justify-center h-full text-app-muted">
            <span class="text-sm">Terminal not available</span>
          </div>
        </slot>
      </div>
    </div>
  </div>
</template>
