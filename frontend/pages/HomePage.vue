<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useSpaces } from '@/composables/useSpaces'
import { useWidgetRegistry } from '@/composables/useWidgetRegistry'

const { loadSpaces } = useSpaces()
const widgetRegistry = useWidgetRegistry()
const showWidgetPicker = ref(false)
const toast = useNotification()

function handleAddWidget(spaceId: string, widgetId: string, sizeKey: string) {
  const added = widgetRegistry.addWidget(spaceId, widgetId, sizeKey)
  if (added) {
    showWidgetPicker.value = false
  } else {
    toast.add({ title: 'Dashboard Full', description: 'No space available for this widget size', color: 'warning' })
  }
}

function handleRemoveWidget(instanceId: string) {
  widgetRegistry.removeWidget(instanceId)
}

function handleResizeWidget(instanceId: string, sizeKey: string) {
  widgetRegistry.resizeWidget(instanceId, sizeKey)
}

function handleSwapWidgets(idA: string, idB: string) {
  widgetRegistry.swapWidgets(idA, idB)
}

function handleMoveWidget(instanceId: string, x: number, y: number) {
  widgetRegistry.moveWidget(instanceId, x, y)
}

function handleMoveResize(instanceId: string, x: number, y: number, sizeKey: string) {
  widgetRegistry.moveAndResize(instanceId, x, y, sizeKey)
}

async function reloadWidgets() {
  await loadSpaces()

  // Load widget system. loadLayout is async — backed by the per-profile
  // widgets.json file (Tauri) or localStorage (web dev).
  await widgetRegistry.loadLayout()
  await widgetRegistry.loadCatalog()
}

function handleSpacesChanged() {
  void reloadWidgets()
}

onMounted(async () => {
  await reloadWidgets()
  window.addEventListener('construct:spaces-changed', handleSpacesChanged)
})

onBeforeUnmount(() => {
  window.removeEventListener('construct:spaces-changed', handleSpacesChanged)
})
</script>

<template>
  <div class="h-full overflow-y-auto px-6 py-6 relative">
    <div class="w-full max-w-6xl mx-auto space-y-4">
      <!-- Built-in Widgets Strip (12×2) — fixed, not configurable -->
      <BuiltinWidgets :get-component="widgetRegistry.getWidgetComponent" />

      <!-- Space Widgets Grid — 12×4 at rest, expands to 12×8 in edit mode -->
      <div>
        <HomeGrid :items="widgetRegistry.layout.value.items" :grid-cols="widgetRegistry.GRID_COLS"
          :grid-rows="widgetRegistry.SPACE_ROWS_VISIBLE" :grid-max-rows="widgetRegistry.SPACE_ROWS"
          :get-component="widgetRegistry.getWidgetComponent" :available-sizes="widgetRegistry.getWidgetSizes"
          @remove="handleRemoveWidget" @resize="handleResizeWidget" @swap="handleSwapWidgets" @move="handleMoveWidget"
          @move-resize="handleMoveResize" @add-widget="showWidgetPicker = true" />
      </div>
    </div>

    <!-- Widget Picker Modal -->
    <WidgetPicker v-model:open="showWidgetPicker" :widgets="widgetRegistry.catalog.value" @add="handleAddWidget" />
  </div>
</template>
