<script setup lang="ts">
import { DraftingCompass } from 'lucide-vue-next'

const router = useRouter()
</script>

<template>
  <button class="h-full w-full flex flex-col items-center justify-center gap-1.5 hover:bg-blue-500/5 transition-colors rounded-xl" @click="router.push('/app/architect')">
    <div class="size-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
      <DraftingCompass class="size-5 text-blue-500" />
    </div>
    <span class="text-[11px] font-medium text-[var(--app-foreground)]">Architect</span>
  </button>
</template>
