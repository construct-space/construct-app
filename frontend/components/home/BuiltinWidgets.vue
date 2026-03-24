<script setup lang="ts">
/**
 * BuiltinWidgets — Fixed 12×2 top strip for Construct.
 * CurrentUser + News/Announcements area.
 * No space widgets here — those go in the customizable grid below.
 */
import { computed } from 'vue'
import { GRID_COLS } from '@/composables/useWidgetRegistry'
import CurrentUser4x2 from '@/components/home/widgets/CurrentUser4x2.vue'
import { Megaphone } from 'lucide-vue-next'

const { isDeveloperMode } = useDevMode()
const router = useRouter()
</script>

<template>
  <div
    class="grid gap-2"
    :style="{
      gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`,
      gridTemplateRows: 'repeat(2, 80px)',
    }"
  >
    <!-- Current User (always) -->
    <div
      style="grid-column: 1 / span 4; grid-row: 1 / span 2"
      class="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] overflow-hidden"
    >
      <CurrentUser4x2 />
    </div>

    <!-- News / Announcements -->
    <div
      style="grid-column: 5 / span 8; grid-row: 1 / span 2"
      class="rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] overflow-hidden flex items-center justify-center p-4"
    >
      <div class="flex items-center gap-4 text-center">
        <Megaphone class="size-6 text-[var(--app-muted)] shrink-0" />
        <div>
          <p class="text-sm font-medium text-[var(--app-foreground)]">Welcome to Construct</p>
          <p class="text-xs text-[var(--app-muted)]">Your operating environment is ready. Add widgets below to customize your dashboard.</p>
        </div>
      </div>
    </div>
  </div>
</template>
