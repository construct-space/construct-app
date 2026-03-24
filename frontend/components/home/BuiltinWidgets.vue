<script setup lang="ts">
/**
 * BuiltinWidgets — Fixed top strip of Construct built-in widgets.
 * These are always visible and not user-configurable.
 *
 * Layout (12 cols):
 *   Row 1-2: [Current User 4×2] [Vibe 4×1 / Architect 4×1] [Quick Chat 4×2]
 *   Row 3-4 (developer mode only): [Recent Projects 12×2]
 */
import { shallowRef, onMounted, computed } from 'vue'
import type { Component } from 'vue'
import { GRID_COLS, BUILTIN_ROWS_BASE, BUILTIN_ROWS_DEV } from '@/composables/useWidgetRegistry'
import CurrentUser4x2 from '@/components/home/widgets/CurrentUser4x2.vue'
import RecentProjects4x2 from '@/spaces/project/widgets/RecentProjects4x2.vue'

interface BuiltinPlacement {
  instanceId: string
  spaceId: string
  widgetId: string
  sizeKey: string
  x: number
  y: number
  w: number
  h: number
  component: Component | null
}

const props = defineProps<{
  getComponent: (spaceId: string, widgetId: string, sizeKey: string) => Promise<Component | null>
}>()

const { isDeveloperMode } = useDevMode()

// Fixed placements for the always-visible row (12×2)
const corePlacements: BuiltinPlacement[] = [
  { instanceId: 'builtin-user', spaceId: '_construct', widgetId: 'current-user', sizeKey: '4x2', x: 0, y: 0, w: 4, h: 2, component: CurrentUser4x2 },
  { instanceId: 'builtin-vibe', spaceId: 'vibe', widgetId: 'quick-vibe', sizeKey: '4x1', x: 4, y: 0, w: 4, h: 1, component: null },
  { instanceId: 'builtin-architect', spaceId: 'architect', widgetId: 'quick-architect', sizeKey: '4x1', x: 4, y: 1, w: 4, h: 1, component: null },
  { instanceId: 'builtin-chat', spaceId: 'brainstorm', widgetId: 'quick-chat', sizeKey: '4x2', x: 8, y: 0, w: 4, h: 2, component: null },
]

// Developer-only: Recent Projects (row 3-4)
const devPlacements: BuiltinPlacement[] = [
  { instanceId: 'builtin-projects', spaceId: '_construct', widgetId: 'recent-projects', sizeKey: '12x2', x: 0, y: 2, w: 12, h: 2, component: RecentProjects4x2 },
]

const resolvedPlacements = shallowRef<BuiltinPlacement[]>([...corePlacements])
const resolvedDevPlacements = shallowRef<BuiltinPlacement[]>([...devPlacements])

const activeRows = computed(() => isDeveloperMode.value ? BUILTIN_ROWS_DEV : BUILTIN_ROWS_BASE)

const allPlacements = computed(() => {
  if (isDeveloperMode.value) {
    return [...resolvedPlacements.value, ...resolvedDevPlacements.value]
  }
  return resolvedPlacements.value
})

onMounted(async () => {
  // Resolve space widget components
  const resolved = [...corePlacements]
  for (const p of resolved) {
    if (!p.component && p.spaceId !== '_construct') {
      const comp = await props.getComponent(p.spaceId, p.widgetId, p.sizeKey)
      if (comp) p.component = comp
    }
  }
  resolvedPlacements.value = resolved
})

function getGridStyle(item: { x: number; y: number; w: number; h: number }) {
  return {
    gridColumn: `${item.x + 1} / span ${item.w}`,
    gridRow: `${item.y + 1} / span ${item.h}`,
  }
}
</script>

<template>
  <div
    class="grid gap-2"
    :style="{
      gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`,
      gridTemplateRows: `repeat(${activeRows}, 80px)`,
    }"
  >
    <div
      v-for="item in allPlacements"
      :key="item.instanceId"
      :style="getGridStyle(item)"
      class="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] overflow-hidden"
    >
      <component
        v-if="item.component"
        :is="item.component"
        :space-id="item.spaceId"
        :widget-id="item.widgetId"
        :size-key="item.sizeKey"
        :instance-id="item.instanceId"
      />
      <div v-else class="h-full flex items-center justify-center">
        <div class="size-4 border-2 border-[var(--app-muted)]/30 border-t-[var(--app-accent)] rounded-full animate-spin" />
      </div>
    </div>
  </div>
</template>
