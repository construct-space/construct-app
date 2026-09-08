<script setup lang="ts">
/**
 * WidgetPicker — right slideover for browsing and adding widgets to Home.
 *
 * Layout: a search box on top, then one card per space. Each card lists
 * the space's widgets with their available size buttons.
 */
import { ref, computed } from 'vue'
import { Slideover, Card } from '@construct-space/ui'
import type { WidgetDefinition } from '@/composables/useWidgetRegistry'

const props = defineProps<{
  open: boolean
  widgets: WidgetDefinition[]
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  add: [spaceId: string, widgetId: string, sizeKey: string]
}>()

const isOpen = computed({
  get: () => props.open,
  set: (v) => emit('update:open', v),
})

const query = ref('')

interface SpaceGroup {
  spaceId: string
  widgets: WidgetDefinition[]
}

const spaceGroups = computed<SpaceGroup[]>(() => {
  const groups = new Map<string, SpaceGroup>()
  for (const w of props.widgets) {
    let g = groups.get(w.spaceId)
    if (!g) {
      g = { spaceId: w.spaceId, widgets: [] }
      groups.set(w.spaceId, g)
    }
    g.widgets.push(w)
  }
  return [...groups.values()].sort((a, b) => a.spaceId.localeCompare(b.spaceId))
})

const filteredGroups = computed<SpaceGroup[]>(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return spaceGroups.value
  return spaceGroups.value
    .map((g) => {
      // Whole card matches → show all widgets.
      if (g.spaceId.toLowerCase().includes(q)) return g
      // Otherwise narrow to matching widgets.
      const widgets = g.widgets.filter((w) =>
        w.name.toLowerCase().includes(q)
        || (w.description?.toLowerCase().includes(q) ?? false),
      )
      return widgets.length ? { ...g, widgets } : null
    })
    .filter((g): g is SpaceGroup => g !== null)
})

const totalCount = computed(() => props.widgets.length)
const visibleCount = computed(() =>
  filteredGroups.value.reduce((n, g) => n + g.widgets.length, 0),
)

function addWidget(widget: WidgetDefinition, sizeKey: string) {
  emit('add', widget.spaceId, widget.id, sizeKey)
}

function sizePreview(sizeKey: string) {
  const [w, h] = sizeKey.split('x').map(Number)
  return { width: `${w * 22}px`, height: `${h * 16}px` }
}
</script>

<template>
  <Slideover v-model:open="isOpen" title="Add Widget" side="right">
    <div class="flex flex-col h-full">
      <!-- Search -->
      <div class="px-3 pt-3 pb-2">
        <div class="relative">
          <input
            v-model="query"
            type="text"
            placeholder="Search spaces or widgets…"
            class="w-full px-3 py-2 pr-8 rounded-lg text-[12px] bg-[color-mix(in_srgb,var(--app-muted)_10%,transparent)] text-[var(--app-foreground)] placeholder:text-[var(--app-muted)] focus:outline-none focus:bg-[color-mix(in_srgb,var(--app-muted)_16%,transparent)]"
          />
          <button
            v-if="query"
            class="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--app-muted)] hover:text-[var(--app-foreground)] text-[11px] px-1"
            aria-label="Clear search"
            @click="query = ''"
          >
            ✕
          </button>
        </div>
        <p class="mt-1.5 text-[10px] text-[var(--app-muted)]">
          {{ visibleCount }}<span v-if="visibleCount !== totalCount"> of {{ totalCount }}</span>
          widget<span v-if="totalCount !== 1">s</span>
          across {{ filteredGroups.length }} space<span v-if="filteredGroups.length !== 1">s</span>
        </p>
      </div>

      <!-- Cards: one per space -->
      <div class="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        <Card
          v-for="group in filteredGroups"
          :key="group.spaceId"
          variant="muted"
          :title="group.spaceId"
        >
          <template #accessory>
            <span class="text-[10px] text-[var(--app-muted)] font-mono">
              {{ group.widgets.length }} widget<span v-if="group.widgets.length !== 1">s</span>
            </span>
          </template>

          <div class="space-y-2">
            <Card
              v-for="widget in group.widgets"
              :key="widget.id"
              variant="default"
            >
              <div class="-mx-2 -my-2">
                <div class="mb-2 min-w-0">
                  <p class="text-[12px] font-medium text-[var(--app-foreground)] truncate">
                    {{ widget.name }}
                  </p>
                  <p
                    v-if="widget.description"
                    class="text-[11px] text-[var(--app-muted)] mt-0.5 line-clamp-2"
                  >
                    {{ widget.description }}
                  </p>
                </div>
                <div class="flex flex-wrap gap-2">
                  <button
                    v-for="size in widget.sizes"
                    :key="size"
                    class="group/sz flex items-center justify-center rounded-lg transition-all cursor-pointer bg-[var(--app-accent)]/10 hover:bg-[var(--app-accent)]/20 active:scale-95"
                    :style="sizePreview(size)"
                    :title="`Add ${widget.name} (${size})`"
                    @click="addWidget(widget, size)"
                  >
                    <span class="text-[10px] font-mono text-[var(--app-muted)] group-hover/sz:text-[var(--app-accent)] transition-colors">
                      {{ size }}
                    </span>
                  </button>
                </div>
              </div>
            </Card>
          </div>
        </Card>

        <div
          v-if="filteredGroups.length === 0"
          class="flex flex-col items-center justify-center h-40 gap-1"
        >
          <p class="text-[12px] text-[var(--app-foreground)]">No matches</p>
          <p class="text-[11px] text-[var(--app-muted)]">
            <template v-if="query">Nothing matches "{{ query }}"</template>
            <template v-else>No widgets available</template>
          </p>
        </div>
      </div>
    </div>
  </Slideover>
</template>
