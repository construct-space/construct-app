<script setup lang="ts">
/**
 * Card - Nuxt UI v3 compatible card
 */
withDefaults(defineProps<{
  title?: string
  description?: string
  variant?: 'default' | 'outline'
}>(), {
  title: '',
  description: '',
  variant: 'default',
})
</script>

<template>
  <div
    :class="[
      'rounded-lg text-[var(--app-foreground)]',
      variant === 'outline'
        ? 'border border-[var(--app-border)]'
        : 'bg-[var(--app-background)] border border-[var(--app-border)] shadow-sm',
    ]"
  >
    <div v-if="title || description || $slots.header" class="px-4 py-3 border-b border-[var(--app-border)]">
      <slot name="header">
        <h3 v-if="title" class="text-sm font-semibold">{{ title }}</h3>
        <p v-if="description" class="text-xs text-[var(--app-muted)] mt-0.5">{{ description }}</p>
      </slot>
    </div>
    <div class="p-4">
      <slot />
    </div>
    <div v-if="$slots.footer" class="px-4 py-3 border-t border-[var(--app-border)]">
      <slot name="footer" />
    </div>
  </div>
</template>
