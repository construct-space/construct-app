<script setup lang="ts">
/**
 * Timeline - Vertical/horizontal timeline with status indicators
 */
import { computed } from 'vue'

export interface TimelineItem {
  id: string
  title: string
  description?: string
  icon?: string
  color?: string
  timestamp?: string | Date
  status?: 'completed' | 'active' | 'pending'
}

const props = withDefaults(defineProps<{
  items?: TimelineItem[]
  direction?: 'vertical' | 'horizontal'
  size?: 'compact' | 'comfortable'
}>(), {
  items: () => [],
  direction: 'vertical',
  size: 'comfortable',
})

const isVertical = computed(() => props.direction === 'vertical')
const isCompact = computed(() => props.size === 'compact')

function formatTimestamp(ts?: string | Date): string {
  if (!ts) return ''
  const date = ts instanceof Date ? ts : new Date(ts)
  if (isNaN(date.getTime())) return String(ts)
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function dotClasses(item: TimelineItem): string {
  const base = 'relative z-10 flex-shrink-0 rounded-full border-2 flex items-center justify-center transition-all'
  const sizeClass = isCompact.value ? 'w-3 h-3' : 'w-4 h-4'

  if (item.color) {
    return `${base} ${sizeClass}`
  }

  const statusMap: Record<string, string> = {
    completed: `${base} ${sizeClass} bg-emerald-500 border-emerald-500`,
    active: `${base} ${sizeClass} bg-[var(--app-accent)] border-[var(--app-accent)] ring-4 ring-[color-mix(in_srgb,var(--app-accent)_20%,transparent)]`,
    pending: `${base} ${sizeClass} bg-[var(--app-background)] border-[var(--app-border)]`,
  }
  return statusMap[item.status || 'pending'] || statusMap.pending
}

function dotStyle(item: TimelineItem): Record<string, string> {
  if (!item.color) return {}
  return {
    backgroundColor: item.color,
    borderColor: item.color,
  }
}

function lineClasses(item: TimelineItem): string {
  if (item.status === 'completed') return 'bg-emerald-500'
  return 'bg-[var(--app-border)]'
}
</script>

<template>
  <div
    :class="[
      isVertical ? 'flex flex-col' : 'flex flex-row',
      isCompact ? 'gap-0' : 'gap-0',
    ]"
    role="list"
  >
    <div
      v-for="(item, index) in items"
      :key="item.id"
      :class="[
        isVertical
          ? 'flex flex-row items-stretch'
          : 'flex flex-col items-stretch flex-1',
      ]"
      role="listitem"
    >
      <!-- Vertical layout -->
      <template v-if="isVertical">
        <!-- Dot + line column -->
        <div class="flex flex-col items-center flex-shrink-0" :class="isCompact ? 'mr-2.5' : 'mr-3.5'">
          <div :class="dotClasses(item)" :style="dotStyle(item)">
            <span
              v-if="item.icon && !isCompact"
              class="text-white text-[8px] leading-none"
            >
              {{ item.icon }}
            </span>
          </div>
          <!-- Connecting line -->
          <div
            v-if="index < items.length - 1"
            :class="['w-0.5 flex-1 min-h-[24px]', lineClasses(item)]"
          />
        </div>

        <!-- Content -->
        <div :class="isCompact ? 'pb-4' : 'pb-6'" class="min-w-0 flex-1">
          <slot name="item" :item="item" :index="index">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p
                  :class="[
                    'font-medium text-[var(--app-foreground)] leading-tight',
                    isCompact ? 'text-xs' : 'text-sm',
                    item.status === 'active' ? 'text-[var(--app-accent)]' : '',
                    item.status === 'pending' ? 'text-[var(--app-muted)]' : '',
                  ]"
                >
                  {{ item.title }}
                </p>
                <p
                  v-if="item.description"
                  :class="[
                    'text-[var(--app-muted)] mt-0.5 leading-snug',
                    isCompact ? 'text-[10px]' : 'text-xs',
                  ]"
                >
                  {{ item.description }}
                </p>
              </div>
              <span
                v-if="item.timestamp"
                :class="[
                  'flex-shrink-0 text-[var(--app-muted)]',
                  isCompact ? 'text-[10px]' : 'text-xs',
                ]"
              >
                {{ formatTimestamp(item.timestamp) }}
              </span>
            </div>
          </slot>
        </div>
      </template>

      <!-- Horizontal layout -->
      <template v-else>
        <!-- Dot + line row -->
        <div class="flex flex-row items-center flex-shrink-0" :class="isCompact ? 'mb-2' : 'mb-3'">
          <div :class="dotClasses(item)" :style="dotStyle(item)">
            <span
              v-if="item.icon && !isCompact"
              class="text-white text-[8px] leading-none"
            >
              {{ item.icon }}
            </span>
          </div>
          <!-- Connecting line -->
          <div
            v-if="index < items.length - 1"
            :class="['h-0.5 flex-1 min-w-[24px]', lineClasses(item)]"
          />
        </div>

        <!-- Content -->
        <div :class="isCompact ? 'pr-4' : 'pr-6'" class="min-w-0">
          <slot name="item" :item="item" :index="index">
            <p
              :class="[
                'font-medium text-[var(--app-foreground)] leading-tight',
                isCompact ? 'text-xs' : 'text-sm',
                item.status === 'active' ? 'text-[var(--app-accent)]' : '',
                item.status === 'pending' ? 'text-[var(--app-muted)]' : '',
              ]"
            >
              {{ item.title }}
            </p>
            <p
              v-if="item.description"
              :class="[
                'text-[var(--app-muted)] mt-0.5 leading-snug',
                isCompact ? 'text-[10px]' : 'text-xs',
              ]"
            >
              {{ item.description }}
            </p>
            <span
              v-if="item.timestamp"
              :class="[
                'text-[var(--app-muted)] mt-1 block',
                isCompact ? 'text-[10px]' : 'text-xs',
              ]"
            >
              {{ formatTimestamp(item.timestamp) }}
            </span>
          </slot>
        </div>
      </template>
    </div>
  </div>
</template>
