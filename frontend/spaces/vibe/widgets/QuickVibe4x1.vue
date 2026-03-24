<script setup lang="ts">
const router = useRouter()
const projectStore = useProjectStore()

const recentProject = computed(() => {
  const projects = projectStore.recentProjects
  return projects.length > 0 ? projects[0] : null
})

function startVibe() {
  if (recentProject.value) {
    router.push(`/app/projects/${recentProject.value.id || recentProject.value.path}/vibe`)
  } else {
    router.push('/app/vibe')
  }
}
</script>

<template>
  <button class="h-full w-full flex items-center justify-between px-4 hover:bg-[var(--app-accent)]/5 transition-colors rounded-xl" @click="startVibe">
    <div class="flex items-center gap-3">
      <div class="size-8 rounded-lg bg-yellow-500/10 flex items-center justify-center">
        <Icon name="i-lucide-zap" class="size-4 text-yellow-500" />
      </div>
      <div>
        <p class="text-sm font-medium text-[var(--app-foreground)]">Vibe Code</p>
        <p class="text-[10px] text-[var(--app-muted)]">{{ recentProject?.name || 'Start coding with AI' }}</p>
      </div>
    </div>
    <Icon name="i-lucide-arrow-right" class="size-4 text-[var(--app-muted)]" />
  </button>
</template>
