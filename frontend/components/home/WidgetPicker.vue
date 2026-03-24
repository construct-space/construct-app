<script setup lang="ts">
/**
 * WidgetPicker — modal for browsing and adding widgets to Home.
 * Groups widgets by space, shows size variants.
 */
import { ref, computed } from 'vue'
import type { WidgetDefinition } from '@/composables/useWidgetRegistry'

const props = defineProps<{
  open: boolean
  widgets: WidgetDefinition[]
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  add: [spaceId: string, widgetId: string, sizeKey: string]
}>()

const selectedSpace = ref<string | null>(null)

const isOpen = computed({
  get: () => props.open,
  set: (v) => emit('update:open', v),
})

// Group widgets by space
const spaceGroups = computed(() => {
  const groups: Record<string, { spaceId: string; widgets: WidgetDefinition[] }> = {}
  for (const w of props.widgets) {
    if (!groups[w.spaceId]) {
      groups[w.spaceId] = { spaceId: w.spaceId, widgets: [] }
    }
    groups[w.spaceId].widgets.push(w)
  }
  return Object.values(groups)
})

const activeGroup = computed(() => {
  if (!selectedSpace.value && spaceGroups.value.length > 0) {
    return spaceGroups.value[0]
  }
  return spaceGroups.value.find(g => g.spaceId === selectedSpace.value) || null
})

function selectSpace(spaceId: string) {
  selectedSpace.value = spaceId
}

function addWidget(widget: WidgetDefinition, sizeKey: string) {
  emit('add', widget.spaceId, widget.id, sizeKey)
  isOpen.value = false
}

// Size preview dimensions (proportional)
function sizePreview(sizeKey: string) {
  const [w, h] = sizeKey.split('x').map(Number)
  return {
    width: `${w * 60}px`,
    height: `${h * 48}px`,
  }
}
</script>

<template>
  <Modal v-model:open="isOpen">
    <template #header>
      Add Widget
    </template>

    <template #body>
      <div class="flex gap-4 min-h-[300px]">
        <!-- Space sidebar -->
        <div class="w-40 shrink-0 border-r border-[var(--app-border)] pr-4 space-y-1">
          <button
            v-for="group in spaceGroups"
            :key="group.spaceId"
            class="w-full text-left px-3 py-2 rounded-lg text-sm transition-colors"
            :class="(activeGroup?.spaceId === group.spaceId)
              ? 'bg-[var(--app-accent)]/10 text-[var(--app-accent)]'
              : 'text-[var(--app-muted)] hover:text-[var(--app-foreground)] hover:bg-[var(--app-surface)]'"
            @click="selectSpace(group.spaceId)"
          >
            {{ group.spaceId }}
            <span class="text-xs opacity-60 ml-1">({{ group.widgets.length }})</span>
          </button>
        </div>

        <!-- Widget list -->
        <div class="flex-1 space-y-4">
          <template v-if="activeGroup">
            <div
              v-for="widget in activeGroup.widgets"
              :key="widget.id"
              class="p-4 rounded-xl border border-[var(--app-border)] space-y-3"
            >
              <div class="flex items-center gap-2">
                <div>
                  <p class="text-sm font-medium text-[var(--app-foreground)]">{{ widget.name }}</p>
                  <p v-if="widget.description" class="text-xs text-[var(--app-muted)]">{{ widget.description }}</p>
                </div>
              </div>

              <!-- Size variants -->
              <div class="flex flex-wrap gap-3">
                <button
                  v-for="size in widget.sizes"
                  :key="size"
                  class="flex flex-col items-center gap-1.5 p-2 rounded-lg border border-[var(--app-border)] hover:border-[var(--app-accent)]/40 hover:bg-[var(--app-accent)]/5 transition-all cursor-pointer"
                  @click="addWidget(widget, size)"
                >
                  <div
                    class="rounded bg-[var(--app-accent)]/10 border border-[var(--app-accent)]/20"
                    :style="sizePreview(size)"
                  />
                  <span class="text-[10px] text-[var(--app-muted)] font-mono">{{ size }}</span>
                </button>
              </div>
            </div>
          </template>

          <div v-else class="flex items-center justify-center h-full">
            <p class="text-sm text-[var(--app-muted)]">No widgets available</p>
          </div>
        </div>
      </div>
    </template>
  </Modal>
</template>
