<script setup lang="ts">
import { useToast } from '@/composables/useToast'

const { toasts, toast } = useToast()

const colorClasses: Record<string, string> = {
  success: 'border-emerald-500/30 bg-emerald-500/10',
  error: 'border-red-500/30 bg-red-500/10',
  warning: 'border-amber-500/30 bg-amber-500/10',
  info: 'border-[var(--app-accent)]/30 bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)]',
}

const iconColorClasses: Record<string, string> = {
  success: 'text-emerald-500',
  error: 'text-red-500',
  warning: 'text-amber-500',
  info: 'text-[var(--app-accent)]',
}

function getColorClass(color?: string): string {
  return colorClasses[color || 'info'] || colorClasses.info
}

function getIconColorClass(color?: string): string {
  return iconColorClasses[color || 'info'] || iconColorClasses.info
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed top-4 right-4 z-[100] flex flex-col gap-2 w-80">
      <TransitionGroup
        name="toast"
        tag="div"
        class="flex flex-col gap-2"
      >
        <div
          v-for="t in toasts"
          :key="t.id"
          :class="[
            'rounded-lg border px-4 py-3 shadow-lg backdrop-blur-sm',
            'bg-[var(--app-background)]',
            getColorClass(t.color),
          ]"
        >
          <div class="flex items-start gap-3">
            <div :class="['mt-0.5 shrink-0', getIconColorClass(t.color)]">
              <!-- Success icon -->
              <svg v-if="t.color === 'success'" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <!-- Error icon -->
              <svg v-else-if="t.color === 'error'" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
              <!-- Warning icon -->
              <svg v-else-if="t.color === 'warning'" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <!-- Info icon -->
              <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
            </div>

            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-[var(--app-foreground)]">
                {{ t.title }}
              </p>
              <p
                v-if="t.description"
                class="mt-0.5 text-xs text-[var(--app-muted)]"
              >
                {{ t.description }}
              </p>
              <button
                v-if="t.action"
                class="mt-1.5 text-xs font-medium px-2.5 py-1 rounded-md transition-colors cursor-pointer"
                :class="[getIconColorClass(t.color), 'hover:bg-white/10 border border-current/20']"
                @click="t.action!.onClick(); toast.remove(t.id)"
              >
                {{ t.action.label }}
              </button>
            </div>

            <button
              class="shrink-0 rounded-sm text-[var(--app-muted)] hover:text-[var(--app-foreground)] transition-colors cursor-pointer"
              @click="toast.remove(t.id)"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-enter-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.toast-leave-active {
  transition: all 0.2s cubic-bezier(0.4, 0, 1, 1);
}

.toast-enter-from {
  opacity: 0;
  transform: translateX(100%);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(100%);
}

.toast-move {
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
</style>
