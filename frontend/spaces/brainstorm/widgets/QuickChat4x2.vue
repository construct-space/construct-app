<script setup lang="ts">
/**
 * Chat Quick Widget — 4x2 compact chat input
 */
const message = ref('')
const router = useRouter()

function openChat() {
  router.push('/app/brainstorm')
}

async function sendQuick() {
  if (!message.value.trim()) return
  router.push({ path: '/app/brainstorm', query: { q: message.value } })
  message.value = ''
}
</script>

<template>
  <div class="h-full flex flex-col p-3 gap-2">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <Icon name="i-lucide-message-circle" class="size-4 text-[var(--app-accent)]" />
        <span class="text-xs font-medium text-[var(--app-foreground)]">Chat</span>
      </div>
      <button class="text-[10px] text-[var(--app-muted)] hover:text-[var(--app-accent)]" @click="openChat">
        Open
      </button>
    </div>
    <div class="flex-1 flex items-end">
      <div class="w-full flex gap-2">
        <input
          v-model="message"
          placeholder="Ask anything..."
          class="flex-1 text-xs bg-[var(--app-background)] border border-[var(--app-border)] rounded-lg px-3 py-2 text-[var(--app-foreground)] placeholder:text-[var(--app-muted)] focus:outline-none focus:border-[var(--app-accent)]/50"
          @keydown.enter="sendQuick"
        />
        <button
          class="size-8 rounded-lg bg-[var(--app-accent)] text-white flex items-center justify-center hover:opacity-90 transition-opacity"
          @click="sendQuick"
        >
          <Icon name="i-lucide-arrow-up" class="size-3.5" />
        </button>
      </div>
    </div>
  </div>
</template>
