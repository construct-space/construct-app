<script setup lang="ts" vapor>
/**
 * OrgManagedBadge — shows a lock icon + "Managed by {orgName}"
 * Used across settings pages for org-controlled items.
 *
 * Vapor: this is a host-only leaf with no slots, transitions, or provide/inject —
 * safe pilot for Vue 3.6 Vapor Mode. If this works, candidates next: Tooltip, Avatar.
 */
import { Lock } from 'lucide-vue-next'

defineProps<{
  orgName?: string
}>()
</script>

<template>
  <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-500 border border-amber-500/20">
    <Lock class="size-2.5" />
    Managed by {{ orgName || 'organization' }}
  </span>
</template>
