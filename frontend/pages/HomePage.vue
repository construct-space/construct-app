<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useProjectStore } from '@/stores/project'
import { usePinnedStore } from '@/stores/pinned'
import { useSpaces } from '@/composables/useSpaces'
import { buildProjectRoutePath } from '@/utils/projectRoutes'
import {
  Calendar, FolderPlus, FolderOpen, Clock, ArrowRight,
  Zap, Code, PenTool, GitBranch, Terminal, Kanban,
  MessageSquare, Sparkles, BookOpen, StickyNote,
  Gamepad2, Building2, Brush, CalendarDays,
} from 'lucide-vue-next'

const router = useRouter()
const authStore = useAuthStore()
const projectStore = useProjectStore()
const pinnedStore = usePinnedStore()
const { spaces: allSpaces, loadSpaces } = useSpaces()

const userName = computed(() => authStore.user?.first_name || 'User')

const today = new Date()
const dayNumber = today.getDate().toString().padStart(2, '0')
const monthYear = today.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }).toUpperCase()

const recentProjects = computed(() => {
  return [...projectStore.recentProjects]
    .sort((a, b) => new Date(b.last_opened_at).getTime() - new Date(a.last_opened_at).getTime())
    .slice(0, 6)
})

// Installed spaces for quick launch
const spaceIcons: Record<string, any> = {
  vibe: Zap, code: Code, design: PenTool, git: GitBranch,
  terminal: Terminal, kanban: Kanban, chat: MessageSquare,
  ai: Sparkles, docs: BookOpen, notes: StickyNote,
  calendar: CalendarDays, paint: Brush, tetris: Gamepad2,
  'company-manager': Building2,
}

const installedSpaces = computed(() => {
  return allSpaces.value
    .filter(s => !['projects', 'settings', 'marketplace', 'onboarding'].includes(s.name))
    .slice(0, 12)
})

// Pinned spaces (user's favorites)
const pinnedSpaces = computed(() => {
  const pinned = pinnedStore.pinnedByType('space')
  return pinned.map(p => {
    const space = allSpaces.value.find(s => s.name === p.path)
    return space ? { ...space, pinnedId: p.id } : null
  }).filter(Boolean)
})

const truncatePath = (path: string) => {
  if (path.length <= 40) return path
  const parts = path.split('/')
  if (parts.length <= 3) return path
  return `~/${parts.slice(-2).join('/')}`
}

const timeAgo = (dateStr: string) => {
  if (!dateStr) return 'Never'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString()
}

const openProject = (project: { id?: string | number; path: string; name: string }) => {
  projectStore.openProject(project.path)
  router.push(buildProjectRoutePath(project))
}

const openSpace = (spaceName: string) => {
  router.push(`/app/${spaceName}`)
}

const newProject = () => {
  router.push('/app/projects')
}

const openFolder = async () => {
  try {
    const { useProjectDirectory } = await import('@/composables/useProjectDirectory')
    const projectDir = useProjectDirectory()
    const path = await projectDir.openFolderDialog('Open Project Folder')
    if (path) {
      await addDroppedFolder(path)
    }
  } catch (error) {
    console.warn('Failed to open folder:', error)
  }
}

async function addDroppedFolder(path: string) {
  const added = await projectStore.addExternalFolderByPath(path)
  if (added) {
    openProject(added)
    return
  }
  const project = projectStore.projects.find(p => p.path === path)
  if (project) {
    openProject(project)
    return
  }
  router.push('/app/projects')
}

// Drag-and-drop state
const isDragging = ref(false)

onMounted(async () => {
  if (projectStore.projectsRoot) {
    await projectStore.loadProjects()
  }
  await loadSpaces()

  // Listen for Tauri file drop events
  if (window.__TAURI__) {
    try {
      const { getCurrentWebview } = await import('@tauri-apps/api/webview')
      const webview = getCurrentWebview()
      await webview.onDragDropEvent(async (event) => {
        if (event.payload.type === 'enter' || event.payload.type === 'over') {
          isDragging.value = true
        } else if (event.payload.type === 'drop') {
          isDragging.value = false
          for (const path of event.payload.paths) {
            const { stat } = await import('@tauri-apps/plugin-fs')
            try {
              const meta = await stat(path)
              if (meta.isDirectory) {
                await addDroppedFolder(path)
                break
              }
            } catch { /* skip invalid paths */ }
          }
        } else if (event.payload.type === 'leave') {
          isDragging.value = false
        }
      })
    } catch { /* not in Tauri */ }
  }
})
</script>

<template>
  <div class="h-screen overflow-y-auto px-6 py-8 relative">
    <!-- Drop zone overlay -->
    <Transition name="fade">
      <div
        v-if="isDragging"
        class="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      >
        <div class="flex flex-col items-center gap-3 p-10 rounded-2xl border-2 border-dashed border-app-accent/60 bg-[color-mix(in_srgb,var(--app-accent)_8%,transparent)]">
          <FolderPlus class="size-12 text-app-accent" />
          <p class="text-lg font-semibold text-app">Drop folder to add as project</p>
        </div>
      </div>
    </Transition>

    <div class="w-full max-w-5xl mx-auto">
      <!-- Welcome header -->
      <div class="mb-8">
        <p class="text-xs text-app-muted tracking-wider">WELCOME BACK,</p>
        <h1 class="text-4xl font-bold text-app mt-1">{{ userName }}</h1>
        <div class="flex items-center gap-3 mt-2">
          <span class="text-3xl font-bold text-app">{{ dayNumber }}</span>
          <span class="text-xs text-app-muted uppercase tracking-wider">{{ monthYear }}</span>
        </div>
      </div>

      <!-- Spaces quick launch -->
      <div v-if="installedSpaces.length > 0" class="mb-8">
        <div class="flex items-center justify-between mb-3">
          <span class="text-xs text-app-muted uppercase tracking-wider font-medium">Spaces</span>
          <button
            class="text-xs text-app-muted hover:text-app-accent transition-colors"
            @click="router.push('/app/spaces')"
          >
            All spaces
          </button>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="space in installedSpaces"
            :key="space.name"
            class="group flex items-center gap-2 px-3 py-2 rounded-lg border border-app hover:border-app-accent/30 hover:bg-[color-mix(in_srgb,var(--app-accent)_4%,transparent)] transition-all"
            @click="openSpace(space.name)"
          >
            <component
              :is="spaceIcons[space.name] || Sparkles"
              class="size-3.5 text-app-muted group-hover:text-app-accent transition-colors"
            />
            <span class="text-sm text-app-muted group-hover:text-app transition-colors">{{ space.displayName }}</span>
          </button>
        </div>
      </div>

      <!-- Recent Projects -->
      <div class="mb-8">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <Clock class="size-3.5 text-app-muted" />
            <span class="text-xs text-app-muted uppercase tracking-wider font-medium">Recent Projects</span>
          </div>
          <div class="flex gap-2">
            <button
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-app-accent text-app-accent-foreground hover:opacity-90 transition-opacity"
              @click="newProject"
            >
              <FolderPlus class="size-3" />
              New
            </button>
            <button
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-app text-app-muted hover:text-app hover:bg-white/5 transition-colors"
              @click="openFolder"
            >
              <FolderOpen class="size-3" />
              Open
            </button>
          </div>
        </div>

        <div v-if="recentProjects.length > 0" class="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <button
            v-for="project in recentProjects"
            :key="project.path"
            class="group text-left p-3 rounded-lg border border-app hover:border-app-accent/30 hover:bg-[color-mix(in_srgb,var(--app-accent)_3%,transparent)] transition-all"
            @click="openProject(project)"
          >
            <p class="text-sm font-medium text-app truncate">{{ project.name }}</p>
            <p class="text-[10px] text-app-muted truncate mt-0.5">{{ truncatePath(project.path) }}</p>
            <p class="text-[10px] text-app-muted mt-1">{{ timeAgo(project.last_opened_at) }}</p>
          </button>
        </div>

        <div v-else class="text-center py-10 border border-dashed border-app rounded-lg">
          <p class="text-sm text-app-muted">No recent projects</p>
          <p class="text-xs text-app-muted mt-1">Create a new project or drag a folder here</p>
        </div>
      </div>

      <!-- Quick links -->
      <div class="flex flex-wrap gap-2">
        <button
          class="group flex items-center gap-2 px-3 py-2 rounded-md text-xs text-app-muted hover:text-app hover:bg-white/5 transition-all"
          @click="router.push('/app/marketplace')"
        >
          Marketplace
          <ArrowRight class="size-3 opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>
        <button
          class="group flex items-center gap-2 px-3 py-2 rounded-md text-xs text-app-muted hover:text-app hover:bg-white/5 transition-all"
          @click="router.push('/app/settings')"
        >
          Settings
          <ArrowRight class="size-3 opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
