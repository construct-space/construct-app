<script setup lang="ts">
/**
 * Chat Quick Widget — 4x2 compact chat input
 */
import { inject } from 'vue'
import type { BuiltinWidgetApi } from '@/lib/widgetApi'

const api = inject<BuiltinWidgetApi>('widgetApi')!
const message = ref('')

function openChat() {
  api.actions.navigate('/app/ask')
}

async function sendQuick() {
  if (!message.value.trim()) return
  api.actions.navigate(`/app/ask?q=${encodeURIComponent(message.value)}`)
  message.value = ''
}
</script>

<template>
  <div class="h-full flex flex-col px-4 py-3 gap-2">
    <div class="flex items-baseline justify-between">
      <h3 class="widget-title">Ask</h3>
      <button class="widget-action group" @click="openChat">
        Open<span class="widget-action-arrow">›</span>
      </button>
    </div>

    <div class="flex-1 flex items-end">
      <div class="input-row w-full flex items-baseline gap-2 pb-1">
        <input v-model="message" placeholder="Ask anything…"
          class="chat-input flex-1 bg-transparent border-none outline-none text-[var(--app-foreground)]"
          @keydown.enter="sendQuick" />
        <button class="send-btn" :class="{ 'send-btn-active': message.trim().length > 0 }" @click="sendQuick">
          Send ›
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Unified kicker: strong foreground text + red accent period — same
   rhythm as "Flakerim." and "anything." elsewhere on the dashboard. */
.widget-title {
  font-size: 11px;
  font-weight: 300;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--app-foreground) 85%, transparent);
}

.widget-title::after {
  content: '.';
  color: var(--app-accent);
  font-weight: 300;
  margin-left: 1px;
}

.widget-action {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 10.5px;
  font-weight: 300;
  color: var(--app-muted);
}

.widget-action:hover {
  color: var(--app-foreground);
}

.widget-action-arrow {
  display: inline-block;
  transition: transform 160ms ease;
}

.widget-action:hover .widget-action-arrow {
  transform: translateX(2px);
}

/* Input sits on a single underline — no box, no filled pill — so the
   whole widget reads as one open surface. */
.input-row {
  border-bottom: 1px solid color-mix(in srgb, var(--app-foreground) 10%, transparent);
  transition: border-color 160ms ease;
}

.input-row:focus-within {
  border-bottom-color: var(--app-accent);
}

.chat-input {
  font-size: 14px;
  font-weight: 300;
  padding-bottom: 4px;
}

.chat-input::placeholder {
  color: color-mix(in srgb, var(--app-muted) 80%, transparent);
  font-weight: 300;
}

.send-btn {
  font-size: 11px;
  font-weight: 300;
  letter-spacing: 0.04em;
  color: color-mix(in srgb, var(--app-muted) 80%, transparent);
  padding-bottom: 4px;
  transition: color 160ms ease;
}

.send-btn-active {
  color: var(--app-accent);
}
</style>
