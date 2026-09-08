<script setup lang="ts">
/**
 * PermissionModal — Shared permission approval dialog.
 * Shows when the operator emits a permission.request event.
 * User can Allow, Deny, or Allow + Remember.
 *
 * This is the shared version — any space or page can use it.
 * Accepts the pending permission data as a prop and emits
 * the user's decision for the parent to relay to the operator.
 */
import { ShieldAlert, Check, X } from 'lucide-vue-next'

export interface PermissionRequest {
  request_id: string
  tool: string
  input: string
  mode: string
  message: string
}

const props = defineProps<{
  pendingPermission: PermissionRequest | null
}>()

const emit = defineEmits<{
  (e: 'respond', payload: { requestId: string; tool: string; action: 'allow' | 'deny'; remember: boolean }): void
}>()

function respond(action: 'allow' | 'deny', remember: boolean = false) {
  if (!props.pendingPermission) return
  emit('respond', {
    requestId: props.pendingPermission.request_id,
    tool: props.pendingPermission.tool,
    action,
    remember,
  })
}
</script>

<template>
  <div v-if="pendingPermission" class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm">
    <div class="bg-[var(--app-background)] border border-[var(--app-border)] rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
      <!-- Header -->
      <div class="flex items-center gap-3 px-5 py-4 border-b border-[var(--app-border)]">
        <div class="size-10 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
          <ShieldAlert class="size-5 text-amber-400" />
        </div>
        <div>
          <h3 class="text-sm font-semibold text-[var(--app-foreground)]">Permission Required</h3>
          <p class="text-xs text-[var(--app-muted)]">Mode: {{ pendingPermission.mode }}</p>
        </div>
      </div>

      <!-- Body -->
      <div class="px-5 py-4 space-y-3">
        <p class="text-sm text-[var(--app-foreground)]">
          The agent wants to use <span class="font-mono text-[var(--app-accent)] font-medium">{{ pendingPermission.tool }}</span>
        </p>
        <div v-if="pendingPermission.input && pendingPermission.input !== '{}'" class="rounded-lg bg-black/5 dark:bg-white/5 px-3 py-2">
          <pre class="text-[11px] text-[var(--app-muted)] whitespace-pre-wrap break-all max-h-[120px] overflow-y-auto">{{ pendingPermission.input }}</pre>
        </div>
      </div>

      <!-- Actions -->
      <div class="flex items-center gap-2 px-5 py-3 border-t border-[var(--app-border)] bg-[color-mix(in_srgb,var(--app-foreground)_2%,transparent)]">
        <button
          class="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
          @click="respond('allow', false)"
        >
          <Check class="size-4" />
          Allow
        </button>
        <button
          class="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 transition-colors"
          @click="respond('allow', true)"
        >
          <Check class="size-4" />
          Always Allow
        </button>
        <button
          class="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
          @click="respond('deny', false)"
        >
          <X class="size-4" />
          Deny
        </button>
      </div>
    </div>
  </div>
</template>
