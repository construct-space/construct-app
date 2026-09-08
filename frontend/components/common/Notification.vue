<script setup lang="ts">
import { computed } from 'vue'
import { useNotification } from '@/composables/useNotification'
import { useToastPrefs } from '@/composables/useToastPrefs'

const { notifications, notification } = useNotification()
const { toastPosition } = useToastPrefs()

// Anchor the fixed stack to the chosen corner.
const positionClass = computed(() => {
  switch (toastPosition.value) {
    case 'top-left':     return 'top-4 left-4'
    case 'top-right':    return 'top-4 right-4'
    case 'bottom-left':  return 'bottom-4 left-4'
    case 'bottom-right':
    default:             return 'bottom-4 right-4'
  }
})

// Bottom corners stack newest-nearest-the-edge (column-reverse) so toasts
// grow upward; top corners grow downward.
const isBottom = computed(() => toastPosition.value.startsWith('bottom-'))
const directionClass = computed(() => (isBottom.value ? 'flex-col-reverse' : 'flex-col'))

// Slide in/out toward the nearest horizontal edge.
const slideClass = computed(() =>
  toastPosition.value.endsWith('-left') ? '-translate-x-6' : 'translate-x-6',
)

// Color → small accent dot next to the title. The rest of the card
// stays neutral (matches the home greeting/widget aesthetic) so toasts
// don't become a coloured stripe wall when several stack.
const dotColor: Record<string, string> = {
  success: 'bg-emerald-500',
  error:   'bg-red-500',
  warning: 'bg-amber-500',
  info:    'bg-[var(--app-accent)]',
}

function dot(color?: string): string {
  return dotColor[color || 'info'] ?? dotColor.info
}
</script>

<template>
  <Teleport to="body">
    <div :class="['fixed z-[100] flex flex-col gap-3 w-[400px]', positionClass]">
      <TransitionGroup
        tag="div"
        :class="['flex gap-3', directionClass]"
        enter-active-class="transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
        leave-active-class="transition-all duration-200 ease-[cubic-bezier(0.4,0,1,1)]"
        :enter-from-class="`opacity-0 ${slideClass}`"
        :leave-to-class="`opacity-0 ${slideClass}`"
        move-class="transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
      >
        <div
          v-for="t in notifications"
          :key="t.id"
          class="group relative px-5 py-4 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.18)] backdrop-blur-xs border border-[var(--app-border)]/60 bg-[color-mix(in_srgb,var(--app-surface)_92%,transparent)]"
        >
          <div class="flex items-start gap-3">
            <div class="flex-1 min-w-0 pr-6">
              <div class="flex items-baseline gap-2">
                <p class="text-sm font-semibold tracking-tight text-[var(--app-foreground)] truncate">
                  {{ t.title }}
                </p>
                <span
                  aria-hidden="true"
                  :class="['inline-block size-1.5 rounded-full shrink-0 translate-y-[-1px]', dot(t.color)]"
                />
              </div>
              <p
                v-if="t.description"
                class="mt-1 text-[11px] leading-snug text-[var(--app-muted)]"
              >
                {{ t.description }}
              </p>
              <button
                v-if="t.action"
                class="mt-2 text-[11px] font-medium text-[var(--app-accent)] hover:underline cursor-pointer"
                @click="t.action!.onClick(); notification.remove(t.id)"
              >
                {{ t.action.label }}
              </button>
            </div>

            <!-- Chevron when there's an action, close icon otherwise.
                 Clicking chevron = run action + dismiss; clicking × = dismiss. -->
            <button
              v-if="t.action"
              class="shrink-0 rounded-md p-1 text-[var(--app-muted)] hover:text-[var(--app-foreground)] hover:bg-[color-mix(in_srgb,var(--app-foreground)_6%,transparent)] transition-colors cursor-pointer"
              :aria-label="t.action.label"
              @click="t.action!.onClick(); notification.remove(t.id)"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
            <button
              v-else
              class="shrink-0 rounded-md p-1 text-[var(--app-muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--app-foreground)] hover:bg-[color-mix(in_srgb,var(--app-foreground)_6%,transparent)] transition-all cursor-pointer"
              aria-label="Dismiss"
              @click="notification.remove(t.id)"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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
