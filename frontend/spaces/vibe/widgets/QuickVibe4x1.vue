<script setup lang="ts">
import { buildProjectRoutePath } from '@/utils/projectRoutes'

const props = defineProps<{
  instanceId?: string
  config?: Record<string, any>
}>()

const router = useRouter()
const projectStore = useProjectStore()
const widgetRegistry = useWidgetRegistry()

const showPicker = ref(false)

const linkedProject = computed(() => {
  const configPath = props.config?.projectPath
  if (configPath) {
    return projectStore.projects.find(p => p.path === configPath) || null
  }
  return projectStore.recentProjects[0] || null
})

const isConfigured = computed(() => !!props.config?.projectPath)

function startVibe() {
  if (linkedProject.value) {
    projectStore.openProject(linkedProject.value.path)
    router.push(`/app/projects/${linkedProject.value.id || linkedProject.value.path}/vibe`)
  } else {
    router.push('/app/vibe')
  }
}

function pickProject(project: typeof projectStore.projects[number]) {
  if (props.instanceId) {
    widgetRegistry.updateWidgetConfig(props.instanceId, { projectPath: project.path })
  }
  showPicker.value = false
}

function clearLink() {
  if (props.instanceId) {
    widgetRegistry.updateWidgetConfig(props.instanceId, { projectPath: null })
  }
}
</script>

<template>
  <div class="group/vibe h-full w-full flex items-center justify-between px-4 relative">
    <button class="flex items-center gap-3 flex-1 min-w-0 h-full" @click="startVibe">
      <div class="size-8 rounded-lg bg-yellow-500/10 flex items-center justify-center shrink-0">
        <Icon name="i-lucide-zap" class="size-4 text-yellow-500" />
      </div>
      <div class="min-w-0">
        <p class="text-sm font-medium text-[var(--app-foreground)]">Vibe Code</p>
        <p class="text-[10px] text-[var(--app-muted)] truncate">{{ linkedProject?.name || 'Start coding with AI' }}</p>
      </div>
    </button>

    <button class="p-1.5 rounded-md text-[var(--app-muted)] hover:text-[var(--app-foreground)] transition-colors shrink-0" @click="startVibe">
      <Icon name="i-lucide-arrow-right" class="size-4" />
    </button>

    <!-- Link project (top-right circle, like close button) -->
    <button
      class="absolute top-1.5 right-1.5 size-5 rounded-full bg-[var(--app-background)] border border-[var(--app-border)] flex items-center justify-center opacity-0 group-hover/vibe:opacity-100 hover:!border-yellow-500/40 hover:!bg-yellow-500/10 transition-all cursor-pointer z-10"
      title="Link to project"
      @click.stop="showPicker = !showPicker"
    >
      <Icon name="i-lucide-link" class="size-2.5 text-[var(--app-muted)]" />
    </button>

    <!-- Project picker dropdown -->
    <div
      v-if="showPicker"
      class="absolute top-full right-2 mt-1 w-56 max-h-48 overflow-y-auto rounded-lg border border-[var(--app-border)] bg-[var(--app-background)] shadow-xl z-50 py-1"
      @click.stop
    >
      <!-- Clear option -->
      <button
        v-if="isConfigured"
        class="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-[var(--app-muted)] hover:bg-[var(--app-muted)]/5 transition-colors"
        @click="clearLink(); showPicker = false"
      >
        <Icon name="i-lucide-x" class="size-3" />
        Use most recent
      </button>
      <div v-if="isConfigured" class="my-1 h-px bg-[var(--app-border)]" />

      <button
        v-for="project in projectStore.projects"
        :key="project.path"
        class="flex items-center gap-2 w-full px-3 py-1.5 text-xs transition-colors"
        :class="project.path === config?.projectPath
          ? 'text-[var(--app-accent)] bg-[var(--app-accent)]/5'
          : 'text-[var(--app-foreground)] hover:bg-[var(--app-muted)]/5'"
        @click="pickProject(project)"
      >
        <Icon name="i-lucide-folder" class="size-3.5 shrink-0" />
        <span class="truncate">{{ project.name }}</span>
      </button>
    </div>
  </div>
</template>
