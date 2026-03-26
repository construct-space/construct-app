<script setup lang="ts">
const router = useRouter()
const projectStore = useProjectStore()

function go() {
  const recent = projectStore.recentProjects[0]
  if (recent) {
    router.push(`/app/projects/${recent.id || recent.path}/vibe`)
  } else {
    router.push('/app/vibe')
  }
}
</script>

<template>
  <button class="h-full w-full flex flex-col items-center justify-center gap-1.5 hover:bg-yellow-500/5 transition-colors rounded-xl" @click="go">
    <div class="size-10 rounded-xl bg-yellow-500/10 flex items-center justify-center">
      <Icon name="i-lucide-zap" class="size-5 text-yellow-500" />
    </div>
    <span class="text-[11px] font-medium text-[var(--app-foreground)]">Vibe</span>
  </button>
</template>
