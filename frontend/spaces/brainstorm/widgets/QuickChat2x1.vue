<script setup lang="ts">
import { MessageCircle } from 'lucide-vue-next'

const router = useRouter()
</script>

<template>
  <button class="h-full w-full flex items-center gap-3 px-3 hover:bg-[var(--app-accent)]/5 transition-colors rounded-xl" @click="router.push('/app/brainstorm')">
    <div class="size-8 rounded-lg bg-[var(--app-accent)]/10 flex items-center justify-center">
      <MessageCircle class="size-4 text-[var(--app-accent)]" />
    </div>
    <div class="min-w-0">
      <p class="text-sm font-medium text-[var(--app-foreground)]">Chat</p>
      <p class="text-[10px] text-[var(--app-muted)]">Ask anything</p>
    </div>
  </button>
</template>
