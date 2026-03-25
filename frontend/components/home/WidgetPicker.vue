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
</script>

<template>
  <Modal v-model:open="isOpen">
    <template #header>
      Add Widget
    </template>

    <template #body>
      <div class="flex gap-0 min-h-[320px] max-h-[60vh]">
        <!-- Space sidebar -->
        <div class="w-40 shrink-0 border-r border-[var(--app-border)] pr-3 space-y-0.5 overflow-y-auto">
          <button
            v-for="group in spaceGroups"
            :key="group.spaceId"
            class="w-full text-left px-3 py-1.5 rounded-lg text-xs transition-colors"
            :class="(activeGroup?.spaceId === group.spaceId)
              ? 'bg-[var(--app-accent)]/10 text-[var(--app-accent)] font-medium'
              : 'text-[var(--app-muted)] hover:text-[var(--app-foreground)] hover:bg-[color-mix(in_srgb,var(--app-muted)_6%,transparent)]'"
            @click="selectSpace(group.spaceId)"
          >
            {{ group.spaceId }}
            <span class="opacity-50 ml-0.5">({{ group.widgets.length }})</span>
          </button>
        </div>

        <!-- Widget list (scrollable) -->
        <div class="flex-1 pl-4 overflow-y-auto space-y-1">
          <template v-if="activeGroup">
            <div
              v-for="widget in activeGroup.widgets"
              :key="widget.id"
              class="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[color-mix(in_srgb,var(--app-muted)_5%,transparent)] transition-colors"
            >
              <!-- Info -->
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-[var(--app-foreground)]">{{ widget.name }}</p>
                <p v-if="widget.description" class="text-[11px] text-[var(--app-muted)] truncate">{{ widget.description }}</p>
              </div>

              <!-- Size pills -->
              <div class="flex items-center gap-1.5 shrink-0">
                <button
                  v-for="size in widget.sizes"
                  :key="size"
                  class="px-2.5 py-1 rounded-lg text-[11px] font-mono border transition-all cursor-pointer border-[var(--app-border)] text-[var(--app-muted)] hover:border-[var(--app-accent)]/50 hover:text-[var(--app-accent)] hover:bg-[var(--app-accent)]/5"
                  @click="addWidget(widget, size)"
                >
                  {{ size }}
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
