<script setup lang="ts">
/**
 * DropdownMenu - Nuxt UI v3 compatible dropdown menu
 * Accepts items array with { label, icon, description, onSelect, type }
 */
import { Icon } from '@iconify/vue'
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from 'reka-ui'

export interface UDropdownItem {
  label?: string
  icon?: string
  description?: string
  type?: 'separator' | 'label'
  disabled?: boolean
  color?: string
  click?: () => void
  onSelect?: () => void
}

const props = withDefaults(defineProps<{
  items?: UDropdownItem[] | UDropdownItem[][]
  content?: { side?: 'top' | 'bottom' | 'left' | 'right'; align?: 'start' | 'center' | 'end'; sideOffset?: number }
}>(), {
  items: () => [],
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

// Normalize items: support both flat array and grouped arrays
const normalizedItems = computed(() => {
  if (!props.items?.length) return []
  if (Array.isArray(props.items[0]) && Array.isArray(props.items[0])) {
    // Grouped: [[item, item], [item, item]]
    const groups = props.items as UDropdownItem[][]
    const result: UDropdownItem[] = []
    groups.forEach((group, gi) => {
      if (gi > 0) result.push({ type: 'separator' })
      result.push(...group)
    })
    return result
  }
  return props.items as UDropdownItem[]
})
</script>

<template>
  <DropdownMenuRoot>
    <DropdownMenuTrigger as-child>
      <slot />
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent
        :side="content?.side || 'bottom'"
        :align="content?.align || 'start'"
        :side-offset="content?.sideOffset || 4"
        class="z-[100] min-w-40 overflow-hidden rounded-lg border border-[var(--app-border)] bg-[var(--app-background)] p-1 shadow-xl animate-in fade-in-0 zoom-in-95"
      >
        <template v-for="(item, index) in normalizedItems" :key="index">
          <DropdownMenuSeparator
            v-if="item.type === 'separator'"
            class="my-1 h-px bg-[var(--app-border)]"
          />
          <DropdownMenuLabel
            v-else-if="item.type === 'label'"
            class="px-2 py-1.5 text-xs font-semibold text-[var(--app-muted)]"
          >
            {{ item.label }}
          </DropdownMenuLabel>
          <DropdownMenuItem
            v-else
            :disabled="item.disabled"
            class="relative flex items-center gap-3 rounded-md px-3 py-2 text-sm text-[var(--app-foreground)] outline-none cursor-pointer select-none data-[highlighted]:bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)] data-[highlighted]:text-[var(--app-accent)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
            @select="(item.onSelect || item.click)?.()"
          >
            <Icon v-if="item.icon" :icon="toIconify(item.icon)" class="size-4 shrink-0 text-[var(--app-muted)]" />
            <div class="flex-1">
              <div>{{ item.label }}</div>
              <div v-if="item.description" class="text-xs text-[var(--app-muted)]">{{ item.description }}</div>
            </div>
          </DropdownMenuItem>
        </template>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
