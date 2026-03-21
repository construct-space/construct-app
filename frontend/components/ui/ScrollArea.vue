<script setup lang="ts">
/**
 * ScrollArea - Nuxt UI v3 compatible scroll area
 */
import { ScrollAreaRoot, ScrollAreaViewport, ScrollAreaScrollbar, ScrollAreaThumb } from 'reka-ui'
</script>

<template>
  <ScrollAreaRoot class="relative overflow-hidden">
    <ScrollAreaViewport class="h-full w-full rounded-[inherit]">
      <slot />
    </ScrollAreaViewport>
    <ScrollAreaScrollbar
      class="flex touch-none select-none bg-transparent p-0.5 transition-colors data-[orientation=horizontal]:h-2.5 data-[orientation=vertical]:w-2.5 data-[orientation=horizontal]:flex-col"
      orientation="vertical"
    >
      <ScrollAreaThumb class="relative flex-1 rounded-full bg-[var(--app-border)] hover:bg-[var(--app-muted)]" />
    </ScrollAreaScrollbar>
  </ScrollAreaRoot>
</template>
