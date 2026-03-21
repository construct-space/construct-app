<script setup lang="ts">
/**
 * Accordion - Nuxt UI v3 compatible accordion
 */
import { Icon } from '@iconify/vue'
import {
  AccordionRoot,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  AccordionHeader,
} from 'reka-ui'

export interface AccordionOption {
  label: string
  icon?: string
  content?: string
  defaultOpen?: boolean
  disabled?: boolean
  slot?: string
  value?: string
  [key: string]: unknown
}

withDefaults(defineProps<{
  items?: AccordionOption[]
  type?: 'single' | 'multiple'
  defaultValue?: string | string[]
  ui?: Record<string, string>
}>(), {
  items: () => [],
  type: 'single',
})

function toIconify(name: string) {
  if (name.startsWith('i-')) {
    const stripped = name.slice(2)
    const idx = stripped.indexOf('-')
    if (idx > 0) return stripped.slice(0, idx) + ':' + stripped.slice(idx + 1)
    return stripped
  }
  return name
}
</script>

<template>
  <AccordionRoot
    :type="type as 'single'"
    :default-value="defaultValue"
    class="w-full"
  >
    <AccordionItem
      v-for="(item, i) in items"
      :key="item.value || String(i)"
      :value="item.value || String(i)"
      :disabled="item.disabled"
      class="border-b border-[var(--app-border)]"
    >
      <AccordionHeader>
        <AccordionTrigger
          :class="ui?.trigger || 'flex w-full items-center justify-between py-3 text-sm font-medium text-[var(--app-foreground)] hover:underline [&[data-state=open]>svg]:rotate-180'"
        >
          <div class="flex items-center gap-2">
            <slot name="leading" :item="item">
              <Icon v-if="item.icon" :icon="toIconify(item.icon)" class="size-4" />
            </slot>
            {{ item.label }}
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 transition-transform duration-200"><polyline points="6 9 12 15 18 9" /></svg>
        </AccordionTrigger>
      </AccordionHeader>
      <AccordionContent class="overflow-hidden text-sm data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
        <div class="text-[var(--app-muted)]">
          <slot name="body" :item="item">
            <div class="pb-3">
              <slot :name="item.slot || item.value || String(i)" :item="item">
                {{ item.content }}
              </slot>
            </div>
          </slot>
        </div>
      </AccordionContent>
    </AccordionItem>
  </AccordionRoot>
</template>
