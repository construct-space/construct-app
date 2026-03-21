<script setup lang="ts">
/**
 * ContextMenu - Nuxt UI v3 compatible context menu
 */
import { Icon } from '@iconify/vue'
import {
  ContextMenuRoot,
  ContextMenuTrigger,
  ContextMenuPortal,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from 'reka-ui'

export interface ContextMenuOption {
  label?: string
  icon?: string
  type?: 'separator' | 'label'
  disabled?: boolean
  onSelect?: () => void
}

const props = withDefaults(defineProps<{
  items?: ContextMenuOption[] | ContextMenuOption[][]
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

const normalizedItems = computed(() => {
  const raw = props.items
  if (!raw?.length) return []
  if (Array.isArray(raw[0]) && Array.isArray(raw[0])) {
    const groups = raw as ContextMenuOption[][]
    const result: ContextMenuOption[] = []
    groups.forEach((group, gi) => {
      if (gi > 0) result.push({ type: 'separator' })
      result.push(...group)
    })
    return result
  }
  return raw as ContextMenuOption[]
})
</script>

<template>
  <ContextMenuRoot>
    <ContextMenuTrigger as-child>
      <slot />
    </ContextMenuTrigger>
    <ContextMenuPortal>
      <ContextMenuContent
        class="z-[100] min-w-48 overflow-hidden rounded-lg border border-[var(--app-border)] bg-[var(--app-background)] p-1 shadow-xl"
      >
        <template v-for="(item, index) in normalizedItems" :key="index">
          <ContextMenuSeparator v-if="item.type === 'separator'" class="my-1 h-px bg-[var(--app-border)]" />
          <ContextMenuItem
            v-else
            :disabled="item.disabled"
            class="relative flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-[var(--app-foreground)] outline-none cursor-pointer select-none data-[highlighted]:bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)] data-[highlighted]:text-[var(--app-accent)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
            @select="item.onSelect?.()"
          >
            <Icon v-if="item.icon" :icon="toIconify(item.icon)" class="size-4 shrink-0 text-[var(--app-muted)]" />
            <span>{{ item.label }}</span>
          </ContextMenuItem>
        </template>
      </ContextMenuContent>
    </ContextMenuPortal>
  </ContextMenuRoot>
</template>
