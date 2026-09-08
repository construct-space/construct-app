<script setup lang="ts">
/**
 * ToolbarSlot — registers content for one of the host toolbar slots
 * (left / center / right).
 *
 * Toolbar3D renders the registered slot functions in a stable, non-rotating
 * overlay. This keeps page-owned toolbar content out of Vue Teleport targets
 * inside the 3D cube, so navigation and cube rotation cannot strand content
 * on a hidden face.
 *
 * Ownership is guarded by a per-instance Symbol. If a new page registers the
 * same slot before the outgoing page unmounts, the old page cannot clear the
 * new page's content during teardown.
 */
import { onBeforeUnmount, onMounted, useSlots, watch } from 'vue'
import { registerToolbarSlot, unregisterToolbarSlot } from '@/composables/useToolbarSlots'

const props = defineProps<{
  name: 'left' | 'center' | 'right'
}>()

const slots = useSlots()
const owner = Symbol('toolbar-slot')
let registeredName: typeof props.name | null = null

function register(name: typeof props.name) {
  registeredName = name
  registerToolbarSlot(name, owner, slots.default ?? null)
}

onMounted(() => {
  register(props.name)
})

watch(() => props.name, (name, oldName) => {
  unregisterToolbarSlot(oldName, owner)
  register(name)
})

onBeforeUnmount(() => {
  if (registeredName) {
    unregisterToolbarSlot(registeredName, owner)
    registeredName = null
  }
})
</script>

<template>
  <!-- Renderless: this component registers its slot content for the toolbar
       overlay (see registerToolbarSlot) and renders nothing inline. The
       v-if="false" child keeps a valid template root without emitting DOM. -->
  <span v-if="false" />
</template>
