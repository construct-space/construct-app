<script setup lang="ts">
/**
 * DashboardPanel - Nuxt UI v3 compatible dashboard panel
 * Supports #header, #body, #footer named slots + ui prop for class overrides
 */
withDefaults(defineProps<{
  grow?: boolean
  width?: number
  collapsible?: boolean
  resizable?: boolean
  ui?: { header?: string; body?: string; footer?: string }
}>(), {
  grow: false,
  collapsible: false,
  resizable: false,
})
</script>

<template>
  <div
    :class="[
      'flex flex-col overflow-hidden',
      grow ? 'flex-1' : '',
    ]"
    :style="width ? { width: `${width}px`, minWidth: `${width}px` } : {}"
  >
    <!-- Header -->
    <div v-if="$slots.header" class="shrink-0" :class="ui?.header">
      <slot name="header" />
    </div>

    <!-- Body -->
    <div :class="['flex-1 overflow-auto p-4 sm:p-6', ui?.body]">
      <slot name="body">
        <slot />
      </slot>
    </div>

    <!-- Footer -->
    <div v-if="$slots.footer" class="shrink-0" :class="ui?.footer">
      <slot name="footer" />
    </div>
  </div>
</template>
