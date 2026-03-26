<script setup lang="ts">
/**
 * WidgetChrome — wrapper around a space widget on the Home grid.
 * Provides error boundary, loading state, and remove action.
 * Watches placement.sizeKey to reload component on resize.
 */
import { ref, watch, onErrorCaptured, shallowRef } from 'vue'
import type { Component } from 'vue'
import type { WidgetPlacement } from '@/composables/useWidgetRegistry'
import { X } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  placement: WidgetPlacement
  getComponent: (spaceId: string, widgetId: string, sizeKey: string) => Promise<Component | null>
  removable?: boolean
}>(), {
  removable: true,
})

const emit = defineEmits<{
  remove: [instanceId: string]
}>()

const widgetComponent = shallowRef<Component | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

onErrorCaptured((err) => {
  error.value = err instanceof Error ? err.message : 'Widget error'
  return false
})

async function loadWidget() {
  loading.value = true
  error.value = null
  try {
    widgetComponent.value = await props.getComponent(
      props.placement.spaceId,
      props.placement.widgetId,
      props.placement.sizeKey
    )
    if (!widgetComponent.value) {
      error.value = 'Widget not found'
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load widget'
  } finally {
    loading.value = false
  }
}

// Load on mount and reload when sizeKey changes (resize)
watch(
  () => props.placement.sizeKey,
  () => loadWidget(),
  { immediate: true }
)
</script>

<template>
  <div
    class="relative h-full rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] overflow-hidden group transition-all hover:border-[var(--app-accent)]/30"
  >
    <!-- Remove button (only when removable) -->
    <button
      v-if="removable"
      draggable="false"
      class="absolute top-1.5 right-1.5 z-10 size-5 rounded-full bg-[var(--app-background)] border border-[var(--app-border)] flex items-center justify-center hover:bg-red-500/20 hover:border-red-500/40 transition-colors"
      @click.stop.prevent="emit('remove', placement.instanceId)"
      @mousedown.stop.prevent
      @dragstart.stop.prevent
    >
      <X class="size-3 text-[var(--app-muted)]" />
    </button>

    <!-- Loading -->
    <div v-if="loading" class="h-full flex items-center justify-center">
      <div class="size-4 border-2 border-[var(--app-muted)]/30 border-t-[var(--app-accent)] rounded-full animate-spin" />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="h-full flex items-center justify-center p-3">
      <p class="text-xs text-[var(--app-muted)] text-center">{{ error }}</p>
    </div>

    <!-- Widget content -->
    <component
      v-else-if="widgetComponent"
      :is="widgetComponent"
      :space-id="placement.spaceId"
      :widget-id="placement.widgetId"
      :size-key="placement.sizeKey"
      :instance-id="placement.instanceId"
      :config="placement.config || {}"
    />
  </div>
</template>
