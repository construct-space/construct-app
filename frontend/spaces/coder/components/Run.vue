<script setup lang="ts">
/**
 * Run.vue - VS Code-like run configuration panel
 * Detects project type and provides run/debug options
 */
import { useProjectRunner, type RunConfiguration } from '../composables/useProjectRunner'

const props = defineProps<{
  projectPath: string
}>()

const emit = defineEmits<{
  run: [config: RunConfiguration]
  output: [text: string]
}>()

const {
  detectedProject,
  configurations,
  isDetecting,
  isRunning,
  runningConfigId,
  output,
  error,
  detect,
  run
} = useProjectRunner()

// Detect project on mount and when path changes
watch(() => props.projectPath, async (path) => {
  if (path) {
    await detect(path)
  }
}, { immediate: true })

// Emit output changes
watch(output, (text) => {
  if (text) emit('output', text)
})

async function handleRun(config: RunConfiguration) {
  emit('run', config)
  await run(config.id)
}

// Get icon color based on config type
function getIconColor(type: string): string {
  switch (type) {
    case 'dev': return 'text-green-500'
    case 'build': return 'text-blue-500'
    case 'start': return 'text-purple-500'
    case 'test': return 'text-yellow-500'
    case 'install': return 'text-cyan-500'
    default: return 'text-gray-500'
  }
}
</script>

<template>
  <div class="h-full flex flex-col bg-app">
    <!-- Header -->
    <div class="px-3 py-2 border-b border-app-border flex items-center gap-2">
      <Icon name="i-lucide-play-circle" class="size-4 text-app-muted" />
      <span class="text-xs font-medium text-app-muted uppercase tracking-wide">Run & Debug</span>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-auto p-3">
      <!-- Loading State -->
      <div v-if="isDetecting" class="flex items-center gap-2 text-app-muted">
        <Icon name="i-lucide-loader-2" class="size-4 animate-spin" />
        <span class="text-sm">Detecting project type...</span>
      </div>

      <!-- No Project Detected -->
      <div v-else-if="!detectedProject" class="text-center py-8">
        <Icon name="i-lucide-folder-question" class="size-8 text-app-muted mx-auto mb-2" />
        <p class="text-sm text-app-muted">No project detected</p>
        <p class="text-xs text-app-muted/60 mt-1">Open a folder with a recognized project type</p>
      </div>

      <!-- Project Detected -->
      <div v-else class="space-y-4">
        <!-- Project Info -->
        <div class="flex items-center gap-3 p-3 rounded-lg bg-app-subtle border border-app-border">
          <div class="flex items-center justify-center w-10 h-10 rounded-lg bg-app-accent/10">
            <Icon :name="detectedProject.template?.icon || 'i-lucide-folder'" class="size-5 text-app-accent" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="font-medium text-app truncate">{{ detectedProject.name }}</div>
            <div class="text-xs text-app-muted">{{ detectedProject.template?.name || 'Unknown' }}</div>
          </div>
        </div>

        <!-- Run Configurations -->
        <div class="space-y-1">
          <div class="text-xs font-medium text-app-muted uppercase tracking-wide mb-2">
            Configurations
          </div>

          <button
            v-for="config in configurations"
            :key="config.id"
            class="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-app-subtle transition-colors group"
            :disabled="isRunning"
            @click="handleRun(config)"
          >
            <!-- Play/Loading Icon -->
            <div class="relative">
              <Icon
                v-if="runningConfigId === config.id"
                name="i-lucide-loader-2"
                class="size-5 animate-spin text-app-accent"
              />
              <Icon
                v-else
                name="i-lucide-play"
                class="size-5 text-app-muted group-hover:text-green-500 transition-colors"
              />
            </div>

            <!-- Config Icon -->
            <div :class="['flex items-center justify-center w-8 h-8 rounded-md bg-app-subtle', getIconColor(config.type)]">
              <Icon :name="config.icon" class="size-4" />
            </div>

            <!-- Config Info -->
            <div class="flex-1 min-w-0 text-left">
              <div class="text-sm font-medium text-app">{{ config.name }}</div>
              <div class="text-xs text-app-muted truncate">{{ config.command.join(' ') }}</div>
            </div>

            <!-- Keyboard Shortcut Hint -->
            <div v-if="config.type === 'dev'" class="text-xs text-app-muted/50 hidden group-hover:block">
              <kbd class="px-1.5 py-0.5 rounded bg-app-subtle border border-app-border text-[10px]">F5</kbd>
            </div>
          </button>
        </div>

        <!-- Error Display -->
        <div v-if="error" class="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
          <div class="flex items-center gap-2 text-red-500 text-sm">
            <Icon name="i-lucide-alert-circle" class="size-4" />
            <span class="font-medium">Error</span>
          </div>
          <p class="text-xs text-red-400 mt-1">{{ error }}</p>
        </div>

        <!-- Quick Actions -->
        <div class="pt-2 border-t border-app-border">
          <div class="text-xs font-medium text-app-muted uppercase tracking-wide mb-2">
            Quick Actions
          </div>
          <div class="flex flex-wrap gap-2">
            <Button
              size="xs"
              variant="soft"
              color="neutral"
              icon="i-lucide-terminal"
              @click="$emit('output', 'open-terminal')"
            >
              Terminal
            </Button>
            <Button
              v-if="configurations.find(c => c.type === 'install')"
              size="xs"
              variant="soft"
              color="neutral"
              icon="i-lucide-download"
              :loading="runningConfigId === 'install'"
              @click="handleRun(configurations.find(c => c.type === 'install')!)"
            >
              Install
            </Button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
