<script setup lang="ts">
/**
 * FormField — Construct UI
 * Wraps a form control with an optional label, description, and error.
 * Use layout="row" for inline label + control (design panel style).
 */
withDefaults(defineProps<{
  label?: string
  name?: string
  description?: string
  help?: string
  error?: string
  required?: boolean
  layout?: 'col' | 'row'
}>(), {
  label: '',
  name: '',
  description: '',
  help: '',
  error: '',
  required: false,
  layout: 'col',
})
</script>

<template>
  <!-- Row layout: label left, control right (design panel style) -->
  <div v-if="layout === 'row'" class="flex items-center gap-3 min-h-[28px]">
    <label
      v-if="label"
      :for="name"
      class="shrink-0 w-24 text-xs text-[var(--app-muted)] select-none"
    >
      {{ label }}<span v-if="required" class="text-red-500 ml-0.5">*</span>
    </label>
    <div class="flex-1 flex flex-col gap-1">
      <slot />
      <p v-if="error" class="text-[10px] text-red-500">{{ error }}</p>
    </div>
  </div>

  <!-- Column layout (default) -->
  <div v-else class="flex flex-col gap-1.5">
    <label v-if="label" :for="name" class="text-xs font-semibold tracking-wide uppercase text-[var(--app-foreground)] select-none">
      {{ label }}<span v-if="required" class="text-red-500 ml-0.5">*</span>
    </label>
    <p v-if="description" class="text-xs text-[var(--app-muted)] -mt-0.5">{{ description }}</p>
    <slot />
    <p v-if="error" class="text-xs text-red-500">{{ error }}</p>
    <p v-else-if="help" class="text-xs text-[var(--app-muted)]">{{ help }}</p>
  </div>
</template>
