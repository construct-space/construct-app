<script setup lang="ts">
/**
 * Breadcrumb - Navigation breadcrumb trail
 */

export interface BreadcrumbItem {
  label: string
  to?: string
  icon?: string
  onClick?: () => void
}

withDefaults(defineProps<{
  items?: BreadcrumbItem[]
  separator?: string
}>(), {
  items: () => [],
  separator: '/',
})

function handleClick(item: BreadcrumbItem, isLast: boolean) {
  if (isLast) return
  if (item.onClick) {
    item.onClick()
  }
}
</script>

<template>
  <nav aria-label="Breadcrumb">
    <ol class="flex items-center gap-1 min-w-0 text-sm">
      <template v-for="(item, index) in items" :key="index">
        <!-- Separator -->
        <li
          v-if="index > 0"
          aria-hidden="true"
          class="shrink-0 text-[var(--app-muted)] select-none"
        >
          <slot name="separator">
            <span class="text-xs">{{ separator }}</span>
          </slot>
        </li>

        <!-- Item -->
        <li
          class="min-w-0"
          :class="index === items.length - 1 ? '' : 'shrink-0'"
        >
          <slot
            name="item"
            :item="item"
            :index="index"
            :is-last="index === items.length - 1"
          >
            <!-- Last item (current page) -->
            <span
              v-if="index === items.length - 1"
              class="truncate block font-medium text-[var(--app-foreground)]"
              :title="item.label"
              aria-current="page"
            >
              <component
                v-if="item.icon"
                :is="item.icon"
                class="inline-block h-4 w-4 mr-1 align-text-bottom"
              />
              {{ item.label }}
            </span>

            <!-- Clickable link with route -->
            <router-link
              v-else-if="item.to"
              :to="item.to"
              class="inline-flex items-center text-[var(--app-muted)] hover:text-[var(--app-accent)] transition-colors truncate max-w-[160px]"
              :title="item.label"
            >
              <component
                v-if="item.icon"
                :is="item.icon"
                class="h-4 w-4 mr-1 shrink-0"
              />
              <span class="truncate">{{ item.label }}</span>
            </router-link>

            <!-- Clickable button (no route) -->
            <button
              v-else
              class="inline-flex items-center text-[var(--app-muted)] hover:text-[var(--app-accent)] transition-colors truncate max-w-[160px] cursor-pointer"
              :title="item.label"
              @click="handleClick(item, false)"
            >
              <component
                v-if="item.icon"
                :is="item.icon"
                class="h-4 w-4 mr-1 shrink-0"
              />
              <span class="truncate">{{ item.label }}</span>
            </button>
          </slot>
        </li>
      </template>
    </ol>
  </nav>
</template>
