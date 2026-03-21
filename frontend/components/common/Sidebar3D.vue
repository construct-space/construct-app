<script setup lang="ts">
/**
 * Sidebar3D - 2-panel rotating sidebar with CSS 3D transforms
 *
 * Dock model (like macOS):
 * - 72px wide, dark bg
 * - Large rounded icon buttons (~42px) with generous spacing
 * - Active state: accent/10 bg with accent text
 * - Main panel: Home + pinned spaces + divider + All Spaces + Settings
 * - Space panel: sub-pages within a multi-page space
 */

import { useSpaces } from '@/composables/useSpaces'
import { usePinnedStore } from '@/stores/pinned'
import { useAuthStore } from '@/stores/auth'
import { useProjectStore } from '@/stores/project'
import { getSpace as getSpaceConfig } from '@/config/spaces'
import { BUILTIN_SPACE_IDS } from '@/space_loader/builtin'
import {
  buildProjectSpaceSubItems,
  isProjectRoutePath,
  parseProjectRouteContext,
} from '@/utils/sidebarProjectNav'

const router = useRouter()
const route = useRoute()
const { state, exitSpace, exitProject } = useSidebar()
const authStore = useAuthStore()
const pinnedStore = usePinnedStore()
const projectStore = useProjectStore()
const { spaces, loadSpaces } = useSpaces()

const showUserMenu = ref(false)

// Load spaces on mount + listen for changes from marketplace
const onSpacesChanged = () => { loadSpaces() }
onMounted(async () => {
  if (spaces.value.length === 0) {
    await loadSpaces()
  }
  if (pinnedStore.items.length === 0) {
    await pinnedStore.init()
  }
  window.addEventListener('construct:spaces-changed', onSpacesChanged)
})
onUnmounted(() => {
  window.removeEventListener('construct:spaces-changed', onSpacesChanged)
})

const userInitials = computed(() => {
  const u = authStore.user
  if (u?.first_name) return u.first_name.charAt(0).toUpperCase()
  if (u?.name) return u.name.charAt(0).toUpperCase()
  if (u?.email) return u.email.charAt(0).toUpperCase()
  return 'U'
})

async function logout() {
  showUserMenu.value = false
  await authStore.logout()
  router.push('/login')
}

function navigateTo(path: string) {
  showUserMenu.value = false
  router.push(path)
}

async function handleProjectsClick() {
  if (activeId.value === 'projects') {
    try {
      const { useProjectDirectory } = await import('@/composables/useProjectDirectory')
      const projectDir = useProjectDirectory()
      const path = await projectDir.openFolderDialog('Open Project Folder')
      if (path) {
        const project = await projectStore.addExternalFolderByPath(path)
        if (project) {
          router.push(`/app/projects/${project.id}/code`)
        }
      }
    } catch (e) {
      console.warn('Failed to open folder:', e)
    }
  } else {
    router.push('/app/projects')
  }
}

// Pinned spaces — from the pinned store, type='space'
// Icons come from the live space theme registry (populated from manifests)
const pinnedSpaceNavItems = computed(() => {
  const pinned = pinnedStore.pinnedByType('space')
  const availableSpaceIds = new Set(spaces.value.map(s => s.name))
  return pinned
    .map(pin => {
      const spaceId = pin.metadata?.spaceId || pin.path.replace('/app/', '').split('?')[0]
      const theme = getSpaceConfig(spaceId)
      return {
        id: spaceId,
        label: pin.name,
        icon: theme.icon || pin.icon || 'i-lucide-circle',
        to: `/app/${spaceId}`,
      }
    })
    // Filter out essential spaces and uninstalled spaces
    .filter(item => !BUILTIN_SPACE_IDS.includes(item.id) && availableSpaceIds.has(item.id))
})

// Active route detection — match /app/spaceName* or /app/projects/:id/:spaceName
const activeId = computed(() => {
  const path = route.path
  if (path === '/app' || path === '/app/') return 'home'
  if (path.startsWith('/app/settings')) return 'settings'
  if (path === '/app/spaces') return 'all-spaces'
  if (path.startsWith('/app/marketplace')) return 'marketplace'

  // Project-scoped: /app/projects/:id/:spaceName
  const projectMatch = path.match(/\/app\/projects\/([^/]+)\/([^/]+)/)
  if (projectMatch?.[2]) return projectMatch[2]

  // Match first segment after /app/
  const seg = path.replace('/app/', '').split('/')[0]
  return seg || 'home'
})

// Rotation angle — main (0deg), space/project (-90deg)
const rotationY = computed(() => {
  return (state.panel === 'space' || state.panel === 'project') ? -90 : 0
})

const projectRouteContext = computed(() => {
  return parseProjectRouteContext({
    projectId: route.params.projectId,
    spaceName: route.params.spaceName,
    subPage: route.params.subPage,
  })
})

const projectSpaceSubItems = computed(() => {
  return buildProjectSpaceSubItems(spaces.value, projectRouteContext.value)
})

const goBackToMain = () => {
  if (state.panel === 'project') {
    const context = projectRouteContext.value
    // Level 3 -> level 2: project space back to project single page.
    if (context?.projectId) {
      router.push(`/app/projects/${context.projectId}`)
      return
    }

    const backRoute = state.projectBackRoute || '/app/projects'
    projectStore.clearCurrentProject()
    exitProject()
    router.push(backRoute)
    return
  }
  if (state.spaceBackRoute) {
    router.push(state.spaceBackRoute)
  }
  exitSpace()
}

const getSpaceIcon = (spaceName: string) => {
  return getSpaceConfig(spaceName).icon || 'i-lucide-circle'
}

// Auto-exit project mode when route leaves /app/projects/:id/...
watch(() => route.path, (newPath) => {
  if (state.panel === 'project' && !isProjectRoutePath(newPath)) {
    exitProject()
    projectStore.clearCurrentProject()
  }
})
</script>

<template>
  <aside class="w-[72px] flex flex-col items-center shrink-0 z-50 bg-transparent backdrop-blur-md border-r border-app">
    <!-- Logo (clear macOS traffic lights) -->
    <RouterLink to="/app" class="pt-12 pb-2 shrink-0">
      <svg width="32" height="32" viewBox="0 0 533 533" fill="currentColor" class="text-app-accent">
        <path
          d="M266.5 410.156C230.912 410.156 199.106 402.203 171.081 386.297C143.056 370.39 121.036 348.519 105.022 320.684C89.0072 292.848 81 261.256 81 225.909C81 190.12 89.0072 158.308 105.022 130.472C121.036 102.636 143.056 80.7655 171.081 64.8593C199.106 48.9531 230.912 41 266.5 41C302.087 41 333.671 48.9531 361.252 64.8593C389.277 80.7655 411.297 102.636 427.311 130.472C443.326 158.308 451.555 190.12 452 225.909C452 261.256 443.77 292.848 427.311 320.684C411.297 348.519 389.277 370.39 361.252 386.297C333.671 402.203 302.087 410.156 266.5 410.156ZM266.5 363.763C292.301 363.763 315.433 357.798 335.896 345.868C356.359 333.939 372.373 317.591 383.939 296.824C395.505 276.058 401.288 252.42 401.288 225.909C401.288 199.399 395.505 175.761 383.939 154.994C372.373 133.786 356.359 117.217 335.896 105.287C315.433 93.3579 292.301 87.393 266.5 87.393C240.699 87.393 217.567 93.3579 197.104 105.287C176.641 117.217 160.405 133.786 148.394 154.994C136.828 175.761 131.045 199.399 131.045 225.909C131.045 252.42 136.828 276.058 148.394 296.824C160.405 317.591 176.641 333.939 197.104 345.868C217.567 357.798 240.699 363.763 266.5 363.763Z" />
        <path
          d="M378.22 451.578C393.077 451.578 405.121 460.85 405.121 472.289C405.121 483.727 393.077 493 378.22 493H160.945C146.089 493 134.044 483.727 134.044 472.289C134.044 460.85 146.089 451.578 160.945 451.578H378.22Z" />
      </svg>
    </RouterLink>

    <!-- 3D Rotating Cube (2 panels) -->
    <div class="flex-1 w-full overflow-hidden py-1" style="perspective: 1000px">
      <div class="relative w-full h-full transition-transform duration-500 ease-out" :style="{
        transformStyle: 'preserve-3d',
        transform: `rotateY(${rotationY}deg)`,
      }">
        <!-- ====== Front Panel (main) — Home + pinned spaces + All Spaces + Settings ====== -->
        <div class="absolute inset-0 w-full h-full flex flex-col items-center gap-1 pt-2 overflow-y-auto scrollbar-none"
          style="backface-visibility: hidden; transform: translateZ(20px)">
          <!-- Projects (primary entry point) -->
          <button class="sidebar-btn"
            :class="activeId === 'projects' ? 'sidebar-btn-active' : 'sidebar-btn-inactive'"
            :title="activeId === 'projects' ? 'Open Folder' : 'Projects'"
            @click="handleProjectsClick">
            <Icon :name="activeId === 'projects' ? 'i-lucide-folder-open' : 'i-lucide-folder'" class="size-5" />
          </button>

          <div class="w-8 h-px bg-app-border my-0.5" />

          <!-- Pinned spaces -->
          <RouterLink v-for="item in pinnedSpaceNavItems" :key="item.id" :to="item.to" class="sidebar-btn"
            :class="activeId === item.id ? 'sidebar-btn-active' : 'sidebar-btn-inactive'" :title="item.label">
            <Icon :name="item.icon" class="size-5" />
          </RouterLink>

          <!-- Empty state hint when no spaces pinned -->
          <div v-if="pinnedSpaceNavItems.length === 0" class="flex flex-col items-center gap-1 py-2">
            <span class="text-[9px] text-app-muted text-center leading-tight px-1">Pin spaces below</span>
          </div>

          <div class="flex-1" />

          <div class="w-8 h-px bg-app-border my-0.5" />

          <!-- All Spaces (Launchpad) -->
          <RouterLink to="/app/spaces" class="sidebar-btn"
            :class="activeId === 'all-spaces' ? 'sidebar-btn-active' : 'sidebar-btn-inactive'" title="All Spaces">
            <Icon name="i-lucide-grid-2x2" class="size-5" />
          </RouterLink>

          <!-- Settings at bottom -->
          <RouterLink to="/app/settings" class="sidebar-btn mb-4"
            :class="activeId === 'settings' ? 'sidebar-btn-active' : 'sidebar-btn-inactive'" title="Settings">
            <Icon name="i-lucide-settings" class="size-5" />
          </RouterLink>
        </div>

        <!-- ====== Right Panel (space sub-pages OR project spaces) ====== -->
        <div class="absolute inset-0 w-full h-full flex flex-col items-center gap-1 pt-2 overflow-y-auto scrollbar-none"
          style="backface-visibility: hidden; transform: rotateY(90deg) translateZ(20px)">
          <!-- Back button (always shown) -->
          <button class="sidebar-btn sidebar-btn-inactive" title="Back" @click="goBackToMain">
            <Icon name="i-lucide-arrow-left" class="size-5" />
          </button>

          <!-- ===== Project mode ===== -->
          <template v-if="state.panel === 'project' && state.activeProject">
            <!-- Project name indicator -->
            <div
              class="w-10 h-6 flex items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)]"
              :title="state.activeProject.name">
              <span class="text-[9px] font-bold text-app-accent truncate px-1">
                {{ state.activeProject.name.slice(0, 3).toUpperCase() }}
              </span>
            </div>

            <div class="w-8 h-px bg-app-border" />

            <!-- Project-scoped space icons -->
            <template v-for="item in state.projectSpaceItems" :key="item.id">
              <RouterLink :to="item.route" class="sidebar-btn"
                :class="activeId === item.id ? 'sidebar-btn-active' : 'sidebar-btn-inactive'" :title="item.label">
                <Icon :name="item.icon || 'i-lucide-circle'" class="size-5" />
              </RouterLink>
            </template>

            <!-- Active project-space sub-pages (e.g. Code: editor/terminal/responsive) -->
            <template v-if="projectSpaceSubItems.length > 0">
              <div class="w-8 h-px bg-app-border" />
              <template v-for="item in projectSpaceSubItems" :key="item.route">
                <RouterLink :to="item.route" class="sidebar-btn"
                  :class="route.path === item.route ? 'sidebar-btn-active' : 'sidebar-btn-inactive'"
                  :title="item.label">
                  <Icon :name="item.icon || 'i-lucide-circle'" class="size-4" />
                </RouterLink>
              </template>
            </template>
          </template>

          <!-- ===== Space sub-page mode ===== -->
          <template v-else-if="state.panel === 'space'">
            <div v-if="state.activeSpace" class="sidebar-btn sidebar-btn-active">
              <Icon :name="getSpaceIcon(state.activeSpace)" class="size-5" />
            </div>

            <div class="w-8 h-px bg-app-border" />

            <template v-for="item in state.activeSpaceItems" :key="item.route">
              <RouterLink :to="item.route" class="sidebar-btn"
                :class="route.path === item.route ? 'sidebar-btn-active' : 'sidebar-btn-inactive'" :title="item.label">
                <Icon :name="item.icon || 'i-lucide-circle'" class="size-4" />
              </RouterLink>
            </template>
          </template>

          <div class="flex-1" />
        </div>
      </div>
    </div>

    <!-- Avatar / user menu — always visible outside the 3D cube -->
    <div class="shrink-0 mb-4 relative flex justify-center">
      <button class="size-9 rounded-full flex items-center justify-center overflow-hidden ring-2 transition-all" :class="showUserMenu
        ? 'ring-app-accent'
        : 'ring-app-border hover:ring-app-muted'" :title="authStore.user?.name || authStore.userEmail"
        @click="showUserMenu = !showUserMenu">
        <img v-if="authStore.userAvatar" :src="authStore.userAvatar" :alt="authStore.userName"
          class="w-full h-full object-cover" />
        <span v-else class="text-sm font-semibold text-app-foreground">
          {{ userInitials }}
        </span>
      </button>

      <!-- Dropdown — flies out to the right -->
      <Teleport to="body">
        <!-- Backdrop -->
        <div v-if="showUserMenu" class="fixed inset-0 z-199" @click="showUserMenu = false" />
        <!-- Menu -->
        <div v-if="showUserMenu"
          class="fixed z-200 left-20 bottom-4 w-44 rounded-lg border border-app-border bg-app-background shadow-xl overflow-hidden">
          <!-- User info header -->
          <div class="px-3 py-2.5 border-b border-app-border">
            <p class="text-xs font-medium text-app-foreground truncate">{{ authStore.userName }}</p>
            <p class="text-[10px] text-app-muted truncate">{{ authStore.userEmail }}</p>
          </div>

          <!-- Menu items -->
          <div class="py-1">
            <button
              class="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-app-foreground hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)] transition-colors text-left"
              @click="navigateTo('/app/settings/profile')">
              <Icon name="i-lucide-circle-user" class="size-4 text-app-muted shrink-0" />
              Profile
            </button>
            <button
              class="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-app-foreground hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)] transition-colors text-left"
              @click="navigateTo('/app/settings')">
              <Icon name="i-lucide-settings" class="size-4 text-app-muted shrink-0" />
              Settings
            </button>
          </div>

          <div class="border-t border-app-border py-1">
            <button
              class="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-500 hover:bg-red-500/10 transition-colors text-left"
              @click="logout">
              <Icon name="i-lucide-log-out" class="size-4 shrink-0" />
              Log out
            </button>
          </div>
        </div>
      </Teleport>
    </div>
  </aside>
</template>

<style scoped>
.sidebar-btn {
  width: 42px;
  height: 42px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.sidebar-btn-active {
  background: color-mix(in srgb, var(--app-accent) 15%, transparent);
  color: var(--app-accent);
}

.sidebar-btn-inactive {
  color: var(--app-muted);
}

.sidebar-btn-inactive:hover {
  background: color-mix(in srgb, var(--app-foreground) 5%, transparent);
  color: var(--app-foreground);
}

.scrollbar-none::-webkit-scrollbar {
  display: none;
}

.scrollbar-none {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
