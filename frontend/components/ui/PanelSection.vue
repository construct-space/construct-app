<script setup lang="ts">
/**
 * PanelSection — Construct UI
 * Section divider for design panels with a bold label and optional action slot.
 * Mirrors the "Layout", "Appearance", "Typography" section headers in the design tool.
 *
 * Usage:
 *   <PanelSection label="Layout">
 *     <PropRow> ... </PropRow>
 *   </PanelSection>
 *
 *   <PanelSection label="Prototype">
 *     <template #action><button>+</button></template>
 *   </PanelSection>
 */
withDefaults(defineProps<{
  label: string
  collapsible?: boolean
}>(), {
  collapsible: false,
})

const open = ref(true)
</script>

<template>
  <div class="border-t border-[var(--app-border)]">
    <!-- Header -->
    <div
      class="flex items-center justify-between px-3 py-2 select-none"
      :class="collapsible ? 'cursor-pointer' : ''"
      @click="collapsible && (open = !open)"
    >
      <span class="text-xs font-bold text-[var(--app-foreground)] tracking-wide">{{ label }}</span>
      <div class="flex items-center gap-1">
        <slot name="action" />
        <!-- Collapse chevron -->
        <svg
          v-if="collapsible"
          class="size-3 text-[var(--app-muted)] transition-transform duration-150"
          :class="open ? 'rotate-0' : '-rotate-90'"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>
    </div>

    <!-- Content -->
    <div v-show="open" class="pb-2">
      <slot />
    </div>
  </div>
</template>
