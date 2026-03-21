<script setup lang="ts">
/**
 * Separator - Horizontal or vertical divider
 * Optional label text displayed in the middle
 */
withDefaults(defineProps<{
  orientation?: 'horizontal' | 'vertical'
  label?: string
}>(), {
  orientation: 'horizontal',
})
</script>

<template>
  <div
    v-if="orientation === 'horizontal'"
    class="flex items-center w-full"
    role="separator"
    :aria-orientation="orientation"
  >
    <template v-if="label">
      <div class="flex-1 h-px bg-[var(--app-border)]" />
      <span class="px-3 text-xs text-[var(--app-muted)] shrink-0">{{ label }}</span>
      <div class="flex-1 h-px bg-[var(--app-border)]" />
    </template>
    <div v-else class="w-full h-px bg-[var(--app-border)]" />
  </div>

  <div
    v-else
    class="inline-flex items-center self-stretch"
    role="separator"
    :aria-orientation="orientation"
  >
    <template v-if="label">
      <div class="flex-1 w-px bg-[var(--app-border)]" />
      <span class="py-2 text-xs text-[var(--app-muted)] shrink-0 [writing-mode:vertical-lr]">{{ label }}</span>
      <div class="flex-1 w-px bg-[var(--app-border)]" />
    </template>
    <div v-else class="h-full w-px bg-[var(--app-border)]" />
  </div>
</template>
