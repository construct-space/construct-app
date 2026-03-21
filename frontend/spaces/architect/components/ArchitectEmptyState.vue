<script setup lang="ts">
/**
 * ArchitectEmptyState - Empty state with suggestions
 */
defineProps<{
  suggestions: string[]
}>()

const emit = defineEmits<{
  (e: 'select', suggestion: string): void
}>()

const timeOfDay = computed(() => {
  const hour = new Date().getHours()
  if (hour < 12) return 'morning'
  if (hour < 17) return 'afternoon'
  return 'evening'
})
</script>

<template>
  <div class="h-full flex items-center justify-center p-6 pb-20">
    <div class="text-center max-w-md">
      <h3 class="text-lg font-medium text-app mb-2">Good {{ timeOfDay }}</h3>
      <p class="text-sm text-app-muted mb-6">
        Describe what you'd like to build and I'll help you architect it.
      </p>
      <div class="flex flex-wrap gap-2 justify-center">
        <button
          v-for="suggestion in suggestions"
          :key="suggestion"
          class="px-3 py-1.5 text-sm rounded-md border border-gray-200 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-500 transition-colors text-app-muted hover:text-app"
          @click="emit('select', suggestion)"
        >
          {{ suggestion }}
        </button>
      </div>
    </div>
  </div>
</template>
