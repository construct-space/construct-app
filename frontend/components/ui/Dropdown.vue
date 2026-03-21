<script setup lang="ts">
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from 'reka-ui'

export interface DropdownItem {
  label?: string
  icon?: string
  action?: () => void
  separator?: boolean
}

withDefaults(
  defineProps<{
    items?: DropdownItem[]
  }>(),
  {
    items: () => [],
  }
)
</script>

<template>
  <DropdownMenuRoot>
    <DropdownMenuTrigger as-child>
      <slot name="trigger" />
    </DropdownMenuTrigger>

    <DropdownMenuPortal>
      <DropdownMenuContent
        class="z-50 min-w-40 overflow-hidden rounded-md border border-(--app-border) bg-(--app-background) p-1 shadow-lg"
        :side-offset="4" align="start">
        <template v-for="(item, index) in items" :key="index">
          <DropdownMenuSeparator v-if="item.separator" class="my-1 h-px bg-(--app-border)" />
          <DropdownMenuItem v-else
            class="relative flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-(--app-foreground) outline-none cursor-pointer select-none data-[highlighted]:bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)] data-[highlighted]:text-[var(--app-accent)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
            @select="item.action?.()">
            <component v-if="item.icon" :is="item.icon" class="h-4 w-4 text-[var(--app-muted)]" />
            <span>{{ item.label }}</span>
          </DropdownMenuItem>
        </template>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
