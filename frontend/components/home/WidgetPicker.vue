<script setup lang="ts">
/**
 * WidgetPicker — left slideover for browsing and adding widgets to Home.
 */
import { ref, computed } from 'vue'
import { Slideover } from '@construct-space/ui'
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
}

function sizePreview(sizeKey: string) {
  const [w, h] = sizeKey.split('x').map(Number)
  return { width: `${w * 24}px`, height: `${h * 18}px` }
}
</script>

<template>
  <Slideover v-model:open="isOpen" title="Add Widget" side="right">
    <div class="flex flex-col h-full">
      <!-- Space tabs -->
      <div class="flex flex-wrap gap-1 px-3 pt-3 pb-2 border-b border-[var(--app-border)]">
        <button
          v-for="group in spaceGroups"
          :key="group.spaceId"
          class="px-2.5 py-1 rounded-lg text-[11px] transition-colors"
          :class="(activeGroup?.spaceId === group.spaceId)
            ? 'bg-[var(--app-accent)]/10 text-[var(--app-accent)] font-medium'
            : 'text-[var(--app-muted)] hover:text-[var(--app-foreground)] hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)]'"
          @click="selectSpace(group.spaceId)"
        >
          {{ group.spaceId }}
          <span class="opacity-50">({{ group.widgets.length }})</span>
        </button>
      </div>

      <!-- Widget list -->
      <div class="flex-1 overflow-y-auto px-3 py-2 space-y-1">
        <template v-if="activeGroup">
          <div
            v-for="widget in activeGroup.widgets"
            :key="widget.id"
            class="px-1 py-2"
          >
            <p class="text-xs font-medium text-[var(--app-foreground)] mb-2">{{ widget.name }}</p>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="size in widget.sizes"
                :key="size"
                class="group/sz flex items-center justify-center rounded-lg border transition-all cursor-pointer border-[var(--app-accent)]/20 bg-[var(--app-accent)]/10 hover:bg-[var(--app-accent)]/20 hover:border-[var(--app-accent)]/40 active:scale-95"
                :style="sizePreview(size)"
                @click="addWidget(widget, size)"
              >
                <span class="text-[10px] font-mono text-[var(--app-muted)] group-hover/sz:text-[var(--app-accent)] transition-colors">{{ size }}</span>
              </button>
            </div>
          </div>
        </template>

        <div v-else class="flex items-center justify-center h-32">
          <p class="text-xs text-[var(--app-muted)]">No widgets available</p>
        </div>
      </div>
    </div>
  </Slideover>
</template>
