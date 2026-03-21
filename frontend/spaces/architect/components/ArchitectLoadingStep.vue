<script setup lang="ts">
defineProps<{
  isGeneratingQuestions: boolean
  elapsedSeconds: number
  loadingSteps: string[]
  loadingPhase: number
}>()

defineEmits<{
  cancel: []
}>()
</script>

<template>
  <div class="space-y-8 py-8">
    <!-- Header with orbital spinner -->
    <div class="flex items-center gap-4">
      <div class="relative w-12 h-12">
        <div class="absolute inset-0 rounded-xl bg-app-accent/10" />
        <div class="absolute inset-0 flex items-center justify-center">
          <div class="orbital-spinner" />
        </div>
        <div class="absolute inset-0 flex items-center justify-center">
          <Icon
            :name="isGeneratingQuestions ? 'i-lucide-brain' : 'i-lucide-file-text'"
            class="size-5 text-app-accent"
          />
        </div>
      </div>
      <div>
        <p class="text-sm font-semibold text-app">
          {{ isGeneratingQuestions ? 'Preparing your interview' : 'Building your plan' }}
        </p>
        <p class="text-xs text-app-muted mt-0.5">
          {{ elapsedSeconds < 5 ? 'This usually takes a few seconds...' : `${elapsedSeconds}s elapsed` }}
        </p>
      </div>
    </div>

    <!-- Progress steps -->
    <div class="space-y-1 pl-1">
      <div
        v-for="(stepText, idx) in loadingSteps"
        :key="idx"
        class="flex items-center gap-3 py-2 transition-all duration-500 ease-out"
        :class="idx <= loadingPhase ? 'opacity-100' : 'opacity-0 translate-y-2'"
      >
        <!-- Step indicator -->
        <div class="relative flex items-center justify-center w-6">
          <!-- Connector line -->
          <div
            v-if="idx < loadingSteps.length - 1"
            class="absolute top-6 left-1/2 w-px h-5 -translate-x-1/2 transition-colors duration-500"
            :class="idx < loadingPhase ? 'bg-app-accent/20' : 'bg-white/5'"
          />
          <!-- Dot -->
          <div
            class="relative w-6 h-6 rounded-full flex items-center justify-center transition-all duration-500"
            :class="[
              idx < loadingPhase ? 'bg-app-accent/15' : '',
              idx === loadingPhase ? 'bg-app-accent/10 ring-1.5 ring-app-accent/40' : '',
              idx > loadingPhase ? 'bg-white/5' : '',
            ]"
          >
            <Icon v-if="idx < loadingPhase" name="i-lucide-check" class="size-3 text-app-accent" />
            <div v-else-if="idx === loadingPhase" class="w-1.5 h-1.5 rounded-full bg-app-accent loading-pulse" />
            <div v-else class="w-1 h-1 rounded-full bg-white/15" />
          </div>
        </div>
        <span
          class="text-sm transition-colors duration-500"
          :class="idx === loadingPhase ? 'text-app font-medium' : idx < loadingPhase ? 'text-app-muted' : 'text-app-muted/30'"
        >
          {{ stepText }}
        </span>
      </div>
    </div>

    <!-- Cancel -->
    <button
      class="flex items-center gap-1.5 text-xs text-app-muted/50 hover:text-app-muted transition-colors"
      @click="$emit('cancel')"
    >
      <Icon name="i-lucide-x" class="size-3" />
      Cancel
    </button>
  </div>
</template>

<style scoped>
.orbital-spinner {
  width: 36px;
  height: 36px;
  border: 1.5px solid transparent;
  border-top-color: var(--app-accent);
  border-radius: 50%;
  animation: orbital-spin 1s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

@keyframes orbital-spin {
  to { transform: rotate(360deg); }
}

.loading-pulse {
  animation: l-pulse 1.5s ease-in-out infinite;
}

@keyframes l-pulse {
  0%, 100% { opacity: 0.4; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1.3); }
}
</style>
