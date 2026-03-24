<script setup lang="ts">
const router = useRouter()
</script>

<template>
  <button class="h-full w-full flex items-center justify-between px-4 hover:bg-blue-500/5 transition-colors rounded-xl" @click="router.push('/app/architect')">
    <div class="flex items-center gap-3">
      <div class="size-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
        <Icon name="i-lucide-drafting-compass" class="size-4 text-blue-500" />
      </div>
      <div>
        <p class="text-sm font-medium text-[var(--app-foreground)]">Architect</p>
        <p class="text-[10px] text-[var(--app-muted)]">Plan & design your project</p>
      </div>
    </div>
    <Icon name="i-lucide-arrow-right" class="size-4 text-[var(--app-muted)]" />
  </button>
</template>
