<script setup lang="ts">
import { inject } from 'vue'
import type { BuiltinWidgetApi } from '@/lib/widgetApi'

const api = inject<BuiltinWidgetApi>('widgetApi')!
</script>

<template>
  <button class="quick-chat group h-full w-full flex items-center px-4 transition-colors text-left"
    @click="api.actions.navigate('/app/ask')">
    <div class="flex-1 min-w-0">
      <p class="kicker">Ask</p>
      <p class="text-[14px] font-light text-[var(--app-foreground)] truncate">anything<span class="comma">.</span></p>
    </div>
    <span class="chev text-[var(--app-muted)] opacity-0 group-hover:opacity-100 transition-opacity"
      aria-hidden="true">›</span>
  </button>
</template>

<style scoped>
.quick-chat:hover {
  background: color-mix(in srgb, var(--app-foreground) 4%, transparent);
}

.kicker {
  font-size: 11px;
  font-weight: 300;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--app-foreground) 85%, transparent);
}

.kicker::after {
  content: '.';
  color: var(--app-accent);
  font-weight: 300;
  margin-left: 1px;
}

.comma {
  color: var(--app-accent);
  font-weight: 300;
}

.chev {
  font-size: 16px;
  line-height: 1;
  transform: translateX(-2px);
  transition: transform 160ms ease, opacity 160ms ease;
}

.quick-chat:hover .chev {
  transform: translateX(0);
}
</style>
