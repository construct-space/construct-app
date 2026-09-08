<script setup lang="ts">
/**
 * PresenceStatus - title-bar availability picker (Online / Away / Offline).
 * Bound to the host usePresenceStatus store; spaces (Chat) read it to broadcast
 * presence. A small click-menu, mirroring the now-playing player's placement.
 */
import { ref } from 'vue'
import { onClickOutside } from '@vueuse/core'
import { ChevronDown } from 'lucide-vue-next'
import { usePresenceStatus, PRESENCE_STATUS_META, type PresenceStatus } from '@/composables/usePresenceStatus'

const { status, setStatus } = usePresenceStatus()
const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)
onClickOutside(rootRef, () => { open.value = false })

const ORDER: PresenceStatus[] = ['online', 'away', 'offline']
function pick(s: PresenceStatus) { setStatus(s); open.value = false }
</script>

<template>
  <div ref="rootRef" class="presence">
    <button class="presence__btn" :title="`Status: ${PRESENCE_STATUS_META[status].label}`" @click="open = !open">
      <span class="presence__dot" :style="{ background: PRESENCE_STATUS_META[status].color }" />
      <span class="presence__label">{{ PRESENCE_STATUS_META[status].label }}</span>
      <ChevronDown class="size-3 opacity-60" />
    </button>

    <div v-if="open" class="presence__menu">
      <button
        v-for="s in ORDER" :key="s"
        class="presence__item" :class="{ 'presence__item--active': s === status }"
        @click="pick(s)"
      >
        <span class="presence__dot" :style="{ background: PRESENCE_STATUS_META[s].color }" />
        <span>{{ PRESENCE_STATUS_META[s].label }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.presence { position: relative; -webkit-app-region: no-drag; app-region: no-drag; }
.presence__btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 24px; padding: 0 8px; border-radius: 0.375rem;
  border: none; background: transparent; cursor: pointer;
  font-size: 12px; color: var(--app-foreground);
  transition: background 0.15s;
}
.presence__btn:hover { background: var(--app-input-bg); }
.presence__dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.presence__label { font-weight: 500; }

.presence__menu {
  position: absolute; top: 28px; right: 0; z-index: 50;
  min-width: 140px; padding: 4px;
  background: var(--app-background);
  border: 1px solid var(--app-border);
  border-radius: 8px;
  box-shadow: 0 8px 24px -6px rgba(0,0,0,0.18);
}
.presence__item {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 6px 8px; border: none; border-radius: 6px;
  background: transparent; cursor: pointer; text-align: left;
  font-size: 12px; color: var(--app-foreground);
}
.presence__item:hover { background: var(--app-input-bg); }
.presence__item--active { font-weight: 600; }
</style>
