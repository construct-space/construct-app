<script setup lang="ts">
defineProps<{
  isInsideProject: boolean
  projectName?: string
  errorMessage: string
  description: string
}>()

const emit = defineEmits<{
  'update:description': [value: string]
  submit: []
  quickStart: [text: string]
  dismissError: []
}>()

const isMac = typeof globalThis.navigator !== 'undefined' && /Mac/.test(globalThis.navigator.platform)
const quickStartOptionsProject = ['Authentication', 'Dashboard', 'API Endpoints', 'File Upload', 'Notifications', 'Search']
const quickStartOptionsNew = ['Dashboard', 'E-commerce', 'Chat App', 'Blog', 'Todo App', 'SaaS']
</script>

<template>
  <div class="space-y-8">
    <!-- Hero -->
    <div class="space-y-3">
      <div class="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-app-accent/8 text-app-accent text-xs font-medium">
        <Icon name="i-lucide-sparkles" class="size-3" />
        AI-Powered Planning
      </div>
      <h1 class="text-3xl font-bold text-app tracking-tight">
        {{ isInsideProject ? 'Describe your feature' : 'What are you building?' }}
      </h1>
      <p v-if="isInsideProject" class="text-sm text-app-muted">
        Adding to <span class="font-medium text-app">{{ projectName }}</span>
      </p>
      <p v-else class="text-sm text-app-muted">
        Describe your idea and the architect will plan the project for you.
      </p>
    </div>

    <!-- Error -->
    <div v-if="errorMessage" class="flex items-start gap-3 px-4 py-3 rounded-lg bg-red-500/8 border border-red-500/15">
      <Icon name="i-lucide-alert-circle" class="size-4 text-red-400 shrink-0 mt-0.5" />
      <div class="flex-1 min-w-0">
        <p class="text-sm text-red-400">{{ errorMessage }}</p>
        <button class="text-xs text-red-400/60 hover:text-red-400 mt-1 transition-colors" @click="emit('dismissError')">
          Dismiss
        </button>
      </div>
    </div>

    <!-- Input area -->
    <div class="space-y-3">
      <div class="relative">
        <Textarea
          :model-value="description"
          :placeholder="isInsideProject ? 'I want to add a real-time notification system that...' : 'I want to build a project management tool that...'"
          :rows="5"
          autofocus
          class="!rounded-xl !text-sm"
          @update:model-value="emit('update:description', $event)"
          @keydown.meta.enter="emit('submit')"
          @keydown.ctrl.enter="emit('submit')"
        />
      </div>
      <div class="flex items-center justify-between">
        <p class="text-[11px] text-app-muted/50">
          <kbd class="px-1 py-0.5 rounded bg-white/8 text-[10px] font-mono">{{ isMac ? 'Cmd' : 'Ctrl' }}+Enter</kbd> to continue
        </p>
        <Button :disabled="!description.trim()" size="sm" @click="emit('submit')">
          <template #leading>
            <Icon name="i-lucide-arrow-right" class="size-3.5" />
          </template>
          Continue
        </Button>
      </div>
    </div>

    <!-- Quick starts -->
    <div class="space-y-3">
      <p class="text-[11px] text-app-muted/60 uppercase tracking-widest font-medium">Quick start</p>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="text in isInsideProject ? quickStartOptionsProject : quickStartOptionsNew"
          :key="text"
          class="px-3 py-1.5 text-xs text-app-muted rounded-lg border border-app-border hover:border-app-accent/30 hover:text-app hover:bg-app-accent/5 transition-all duration-150"
          @click="emit('quickStart', text)"
        >
          {{ text }}
        </button>
      </div>
    </div>
  </div>
</template>
