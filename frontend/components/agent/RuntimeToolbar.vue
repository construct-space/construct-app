<script setup lang="ts">
/**
 * RuntimeToolbar — Shared toolbar for runtime session controls.
 * Shows context gauge, cost badge, and permission mode selector.
 * Any space or page can use this alongside an active agent session.
 *
 * Imports ContextGauge, CostBadge, and PermissionControl from the
 * coder space for now — they can be moved to shared later.
 */
import type { ContextInfo, CostInfo, PermissionModeValue } from '@/brain/types'
import ContextGauge from '@/components/agent/ContextGauge.vue'
import CostBadge from '@/components/agent/CostBadge.vue'
import PermissionControl from '@/components/agent/PermissionControl.vue'
import { useToolbarPrefs } from '@/composables/useToolbarPrefs'

defineProps<{
  contextInfo?: ContextInfo | null
  costInfo?: CostInfo | null
  permissionMode?: PermissionModeValue
  isActive?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:permissionMode', mode: PermissionModeValue): void
}>()

const { showRuntimeChips } = useToolbarPrefs()

function onPermissionChange(mode: PermissionModeValue) {
  emit('update:permissionMode', mode)
}
</script>

<template>
  <!-- Always render. The chips render their own idle state when no
       session is live, so the toolbar reads as "ready" instead of
       disappearing mid-session (which made users think the session
       had ended when really just the stream had paused between
       turns). PermissionControl stays session-gated because there's
       nothing to act on without an active agent. -->
  <div class="flex items-center gap-1">
    <template v-if="showRuntimeChips">
      <ContextGauge :context="contextInfo ?? null" />
      <CostBadge :cost="costInfo ?? null" />
    </template>
    <PermissionControl
      v-if="isActive"
      :mode="permissionMode ?? 'default'"
      @change="onPermissionChange"
    />
  </div>
</template>
