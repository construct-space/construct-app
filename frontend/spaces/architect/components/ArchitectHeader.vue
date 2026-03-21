<script setup lang="ts">
/**
 * ArchitectHeader - Header with model selection
 */
defineProps<{
  title: string
  providerOptions: Array<{ label: string; value: string }>
  modelOptions: Array<{ label: string; value: string }>
}>()

const selectedProvider = defineModel<string>('provider')
const selectedModel = defineModel<string>('model')
</script>

<template>
  <div class="h-12 px-4 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between shrink-0">
    <span class="text-sm font-medium text-app">{{ title }}</span>
    <div class="flex items-center gap-2">
      <Select
        v-model="selectedProvider"
        :items="providerOptions"
        class="w-28"
        size="xs"
        placeholder="Provider"
      />
      <Select
        v-model="selectedModel"
        :items="modelOptions"
        class="w-36"
        size="xs"
        placeholder="Model"
      />
    </div>
  </div>
</template>
