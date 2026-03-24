<script setup lang="ts">
const router = useRouter()
</script>

<template>
  <button class="h-full w-full flex items-center gap-3 px-3 hover:bg-yellow-500/5 transition-colors rounded-xl" @click="router.push('/app/vibe')">
    <div class="size-8 rounded-lg bg-yellow-500/10 flex items-center justify-center">
      <Icon name="i-lucide-zap" class="size-4 text-yellow-500" />
    </div>
    <div class="min-w-0">
      <p class="text-sm font-medium text-[var(--app-foreground)]">Vibe</p>
      <p class="text-[10px] text-[var(--app-muted)]">AI Coding</p>
    </div>
  </button>
</template>
