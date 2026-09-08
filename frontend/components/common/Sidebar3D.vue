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

import { useDebounceFn } from '@vueuse/core'
import { useSpaces } from '@/composables/useSpaces'
import { usePinnedStore } from '@/stores/pinned'
import { useAuthStore } from '@/stores/auth'
import { useProfileStore, type Profile } from '@/stores/profile'
import ProfileAvatar from '@/components/common/ProfileAvatar.vue'
import { useProjectStore } from '@/stores/project'
import { getSpace as getSpaceConfig } from '@/config/spaces'
import { BUILTIN_SPACE_IDS } from '@/space_loader/builtin'
import { getWindowLabel, isSpacePopoutLabel } from '@/lib/window/windowType'
import {
  buildProjectSpaceSubItems,
  isProjectRoutePath,
  parseProjectRouteContext,
} from '@/utils/sidebarProjectNav'
import { Code2, LayoutGrid, Globe, Settings, CircleUser, LogOut, Users, AlertTriangle, Palette, Check, ChevronRight } from 'lucide-vue-next'
import { useAppTheme } from '@/composables/useAppTheme'
import { Modal } from '@construct-space/ui'
import { useDeveloperGate } from '@/composables/useDeveloperGate'

const router = useRouter()
const route = useRoute()
const { state, exitProject } = useSidebar()
const authStore = useAuthStore()
const pinnedStore = usePinnedStore()
const projectStore = useProjectStore()
const developerGate = useDeveloperGate()
// Developer portal entry — replaces the old Projects icon. Visible to
// users who are personally enrolled OR who hold the org-Developer role
// (which grants `projects.create`). Non-developers see no entry here.
const showDeveloper = developerGate.visible
const { spaces, loadSpaces } = useSpaces()

const showUserMenu = ref(false)
const showThemeMenu = ref(false)
const showProfileMenu = ref(false)
const { allThemes, currentThemeId, setTheme } = useAppTheme()
const currentThemeLabel = computed(() =>
  allThemes.value.find(t => t.id === currentThemeId.value)?.name ?? 'Theme',
)
async function pickTheme(id: string) {
  await setTheme(id)
  showThemeMenu.value = false
  showUserMenu.value = false
}

// Inline profile switcher — same submenu pattern as Theme above. Lists every
// profile on the machine; clicking switches the active profile in-place
// (no route change). "Add account" routes to /register; "Manage…" opens the
// unified LoginPage rail in case the user needs a fuller view.
const profileStore = useProfileStore()
async function pickProfile(p: Profile) {
  if (p.id === profileStore.activeProfileId) {
    showProfileMenu.value = false
    showUserMenu.value = false
    return
  }
  await profileStore.switchProfile(p.id)
  showProfileMenu.value = false
  showUserMenu.value = false
  // Land on /app directly. If the new profile lacks a live session,
  // the auth guard there bounces to /login automatically — no need
  // to detour through the picker (the user already picked).
  navigateTo('/app')
}
const isDragOver = ref(false)
const unpinningId = ref<string | null>(null)

// Popout window detection. useSpaceRunner opens space popouts with label
// `main-<spaceId>`, which still uses MainShell + this sidebar — but the
// sidebar should reduce to just that one space's pages so the popout
// behaves like a standalone single-space window.
const popoutSpaceId = ref<string | null>(null)
const isPopoutWindow = computed(() => !!popoutSpaceId.value)
onMounted(async () => {
  const label = await getWindowLabel()
  // Only real space popouts collapse the sidebar. An extra Construct window
  // (Cmd+N → main-<timestamp>) is a full main window and must keep the whole
  // sidebar — isSpacePopoutLabel excludes the numeric-suffix case.
  if (!isSpacePopoutLabel(label)) return
  const id = label!.slice('main-'.length)
  // 'main-runner' is the empty-runner popout (no space chosen yet) —
  // keep the full sidebar there so the user can pick one.
  if (id && id !== 'runner') popoutSpaceId.value = id
})

interface PopoutPageItem {
  id: string
  label: string
  icon: string
  path: string
}

const popoutSpace = computed(() => {
  const id = popoutSpaceId.value
  if (!id) return null
  return spaces.value.find(s => s.name === id) ?? null
})

const popoutPages = computed<PopoutPageItem[]>(() => {
  const pages = popoutSpace.value?.pages ?? []
  return pages
    // Skip hidden pages (detail/[param] views) — matches the main shell's
    // DynamicSpacePage filter — and dynamic routes (`:id` and `[id]` forms)
    // there's nothing to navigate to. Without the hidden check, a popout
    // window leaked hidden detail pages (e.g. meet's room) into the sidebar.
    .filter(p => typeof p.path === 'string'
      && !(p as unknown as Record<string, unknown>).hidden
      && !p.path.includes(':')
      && !/\[.*\]/.test(p.path))
    .map((p, i) => ({
      id: p.path || '__home__',
      label: p.label || (p.path ? p.path : 'Home'),
      icon: p.icon || (i === 0 ? 'i-lucide-home' : 'i-lucide-circle'),
      path: p.path ?? '',
    }))
})

function popoutPageRoute(page: PopoutPageItem): string {
  const id = popoutSpaceId.value
  if (!id) return '/app'
  const sub = page.path.replace(/^\/+/, '')
  return sub ? `/app/${id}/${sub}` : `/app/${id}`
}

function isPopoutPageActive(page: PopoutPageItem): boolean {
  return route.path === popoutPageRoute(page)
}

function onPinnedMouseDown(e: MouseEvent, item: { id: string; label: string }) {
  const startX = e.clientX
  const startY = e.clientY
  let dragging = false

  function onMove(e: MouseEvent) {
    if (!dragging && (Math.abs(e.clientX - startX) > 8 || Math.abs(e.clientY - startY) > 8)) {
      dragging = true
    }
    if (dragging) {
      // Past sidebar edge = unpinning
      unpinningId.value = e.clientX > 72 ? item.id : null
    }
  }

  function onUp() {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    if (unpinningId.value === item.id) {
      const pinId = `space-global-${item.id}`
      pinnedStore.removePin(pinId)
    }
    unpinningId.value = null
  }

  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}
let dragSpaceData: { name: string; displayName: string; icon: string } | null = null

function onSpaceDragStart(e: Event) {
  dragSpaceData = (e as CustomEvent).detail
}

function onSpaceDragMove(e: Event) {
  const { x } = (e as CustomEvent).detail
  isDragOver.value = x < 72
}

async function onSpaceDragDrop(e: Event) {
  void e
  const wasOver = isDragOver.value
  isDragOver.value = false

  if (!wasOver || !dragSpaceData) {
    dragSpaceData = null
    return
  }

  try {
    const pinId = `space-global-${dragSpaceData.name}`
    if (pinnedStore.isPinned(pinId)) return

    const { createSpacePin } = await import('@/stores/pinned')
    const pin = createSpacePin({
      name: dragSpaceData.displayName,
      spaceId: dragSpaceData.name,
      icon: dragSpaceData.icon,
    })
    await pinnedStore.addPin(pin)
  } catch { /* ignore */ }

  dragSpaceData = null
}

onMounted(() => {
  window.addEventListener('construct:space-drag-start', onSpaceDragStart)
  window.addEventListener('construct:space-drag-move', onSpaceDragMove)
  window.addEventListener('construct:space-drag-drop', onSpaceDragDrop)
})

onUnmounted(() => {
  window.removeEventListener('construct:space-drag-start', onSpaceDragStart)
  window.removeEventListener('construct:space-drag-move', onSpaceDragMove)
  window.removeEventListener('construct:space-drag-drop', onSpaceDragDrop)
})

// Drop pinned spaces whose bundle is no longer installed (uninstalled from the
// marketplace, profile switch, etc.) so the sidebar doesn't keep dead pins.
// Uses the authoritative installed set, not the display list, so disabled or
// dev-only-but-installed spaces keep their pins.
async function prunePinnedSpaces() {
  // Never prune while signed out. Logout dispatches `construct:spaces-changed`
  // (profile teardown / switch), and at that moment the spaces dir may not be
  // enumerable yet — listInstalledSpaceIds() then returns a core-only set, not
  // null, which would delete EVERY marketplace space pin. Deleting a user's
  // pins as a side effect of signing out is never wanted, so bail.
  if (!authStore.isAuthenticated) return
  const { listInstalledSpaceIds } = await import('@/composables/useSpaces')
  const installed = await listInstalledSpaceIds()
  if (installed) await pinnedStore.pruneMissingSpaces(installed)
}

// Load spaces on mount + listen for changes from marketplace. Debounced so a
// burst of `construct:spaces-changed` (profile init, multi-space sync) coalesces
// into one manifest re-parse + prune pass instead of N — meaningful on weak CPUs.
const onSpacesChanged = useDebounceFn(async () => {
  await loadSpaces()
  await prunePinnedSpaces()
}, 250)
onMounted(async () => {
  if (spaces.value.length === 0) {
    await loadSpaces()
  }
  if (pinnedStore.items.length === 0) {
    await pinnedStore.init()
  }
  await prunePinnedSpaces()
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

const logoutDialogOpen = ref(false)
const logoutBusy = ref(false)

function openLogoutDialog() {
  showUserMenu.value = false
  logoutDialogOpen.value = true
}

async function confirmSoftLogout() {
  logoutBusy.value = true
  try {
    await authStore.logout()
    logoutDialogOpen.value = false
    await router.replace('/login')
  } finally {
    logoutBusy.value = false
  }
}

async function confirmHardLogout() {
  logoutBusy.value = true
  try {
    await authStore.logout({ wipeLocalData: true })
    logoutDialogOpen.value = false
    // After a wipe: if any profile rows remain (e.g., other accounts),
    // landing on /login is fine — the page lists other profiles as a
    // macOS-style switcher so the user picks one inline. Falls back
    // to /login regardless since /login is the universal entry.
    await router.replace('/login')
  } finally {
    logoutBusy.value = false
  }
}

function navigateTo(path: string) {
  showUserMenu.value = false
  router.push(path)
}

// Developer Portal click — first click navigates; subsequent click while
// already on the portal opens an "add external folder" picker so the
// one-click-to-add-folder shortcut from the prior Projects icon keeps
// working.
async function handleDeveloperClick() {
  if (activeId.value === 'developer') {
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
    router.push('/app/developer')
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
  // Developer portal — match /app/developer and (until Phase 2) the legacy
  // /app/projects list, so a single sidebar entry highlights for both.
  if (path === '/app/developer' || path.startsWith('/app/developer/')) return 'developer'
  if (path === '/app/projects' || path === '/app/org-project') return 'developer'

  // Project-scoped: /app/projects/:id/:spaceName
  const projectMatch = path.match(/\/app\/projects\/([^/]+)\/([^/]+)/)
  if (projectMatch?.[2]) return projectMatch[2]

  // Match first segment after /app/
  const seg = path.replace('/app/', '').split('/')[0]
  return seg || 'home'
})

// Rotation angle — main (0deg), space/project (-90deg)
// Which of the two sidebar panels is showing: the right (project/space sub-nav)
// panel when inside a space/project, else the front (main nav). Drives the 2D
// translateX slide. Replaces the old preserve-3d cube, which was unreliable on
// WebView2 — the right face rendered flat and overlaid/blocked the front buttons.
const rightFaceActive = computed(
  () => state.panel === 'space' || state.panel === 'project',
)

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

async function openBrowser() {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('browser_open_host', {
      title: 'Construct Browser',
    })
  } catch (err) {
    console.error('[Sidebar] open browser failed:', err)
  }
}
</script>

<template>
  <aside class="w-[72px] flex flex-col items-center shrink-0 z-50 bg-transparent backdrop-blur-md relative">
    <!-- ==== Popout window: single-space sidebar ==== -->
    <template v-if="isPopoutWindow">
      <!-- Space icon at top — identification only, not a nav button.
           mt-12 clears the macOS traffic lights, mb-1 keeps it tight to
           the divider so the popout sidebar feels like one contiguous list. -->
      <div class="mt-12 mb-1 shrink-0 flex items-center justify-center w-[42px] h-[42px]"
        :title="popoutSpace?.displayName || popoutSpaceId || 'Space'">
        <Icon :name="popoutSpace?.icon || 'i-lucide-circle'" class="size-6 text-app-foreground" />
      </div>

      <div class="w-8 h-px bg-app-border mb-2" />

      <!-- Manifest pages -->
      <div class="flex-1 w-full flex flex-col items-center gap-1 overflow-y-auto scrollbar-none">
        <RouterLink v-for="page in popoutPages" :key="page.id" :to="popoutPageRoute(page)" class="sidebar-btn"
          :class="isPopoutPageActive(page) ? 'sidebar-btn-active' : 'sidebar-btn-inactive'" :title="page.label">
          <Icon :name="page.icon" class="size-5" />
        </RouterLink>
      </div>
    </template>

    <!-- ==== Standard main-window sidebar ==== -->
    <template v-else>
      <!-- Logo (clear macOS traffic lights) -->
      <RouterLink to="/app" class="pt-2 pb-2 shrink-0">
        <svg width="32" height="32" viewBox="0 0 533 533" fill="currentColor" class="text-app-accent">
          <path
            d="M266.5 410.156C230.912 410.156 199.106 402.203 171.081 386.297C143.056 370.39 121.036 348.519 105.022 320.684C89.0072 292.848 81 261.256 81 225.909C81 190.12 89.0072 158.308 105.022 130.472C121.036 102.636 143.056 80.7655 171.081 64.8593C199.106 48.9531 230.912 41 266.5 41C302.087 41 333.671 48.9531 361.252 64.8593C389.277 80.7655 411.297 102.636 427.311 130.472C443.326 158.308 451.555 190.12 452 225.909C452 261.256 443.77 292.848 427.311 320.684C411.297 348.519 389.277 370.39 361.252 386.297C333.671 402.203 302.087 410.156 266.5 410.156ZM266.5 363.763C292.301 363.763 315.433 357.798 335.896 345.868C356.359 333.939 372.373 317.591 383.939 296.824C395.505 276.058 401.288 252.42 401.288 225.909C401.288 199.399 395.505 175.761 383.939 154.994C372.373 133.786 356.359 117.217 335.896 105.287C315.433 93.3579 292.301 87.393 266.5 87.393C240.699 87.393 217.567 93.3579 197.104 105.287C176.641 117.217 160.405 133.786 148.394 154.994C136.828 175.761 131.045 199.399 131.045 225.909C131.045 252.42 136.828 276.058 148.394 296.824C160.405 317.591 176.641 333.939 197.104 345.868C217.567 357.798 240.699 363.763 266.5 363.763Z" />
          <path
            d="M378.22 451.578C393.077 451.578 405.121 460.85 405.121 472.289C405.121 483.727 393.077 493 378.22 493H160.945C146.089 493 134.044 483.727 134.044 472.289C134.044 460.85 146.089 451.578 160.945 451.578H378.22Z" />
        </svg>
      </RouterLink>

      <!-- 2-panel slider (front main nav / right project-space sub-nav). A 2D
           translateX carousel — preserve-3d was unreliable on WebView2 (the
           right face rendered flat and overlaid the buttons, blocking clicks).
           Parent has overflow-hidden so the off-screen panel is clipped (and
           non-interactive). -->
      <div class="sidebar-cube flex-1 w-full overflow-hidden py-1">
        <div class="sidebar-cube__wrapper relative w-full h-full" :style="{
          transform: rightFaceActive ? 'translateX(-100%)' : 'translateX(0)',
        }">
          <!-- ====== Front Panel (main) — Home + pinned spaces + All Spaces + Settings ====== -->
          <div
            class="sidebar-face relative w-full h-full flex flex-col items-center gap-1 pt-2 overflow-y-auto scrollbar-none">
            <!-- Developer Portal — top entry under the logo for enrolled
                 developers (personal OR org-Developer role). Click goes to
                 /app/developer; clicking when already there opens a folder
                 picker (preserves the prior Projects double-click affordance).
                 Icon stays </> regardless of active state — the dev identity
                 of the slot doesn't change when you're standing in it. -->
            <template v-if="showDeveloper">
              <button class="sidebar-btn"
                :class="activeId === 'developer' ? 'sidebar-btn-active' : 'sidebar-btn-inactive'"
                :title="activeId === 'developer' ? 'Open Folder' : 'Developer'" @click="handleDeveloperClick">
                <Code2 class="size-5" />
              </button>

              <div class="w-8 h-px bg-app-border my-0.5" />
            </template>

            <!-- Pinned spaces (drag out to unpin) -->
            <button v-for="item in pinnedSpaceNavItems" :key="item.id" class="sidebar-btn" :class="[
              activeId === item.id ? 'sidebar-btn-active' : 'sidebar-btn-inactive',
              unpinningId === item.id ? 'opacity-30 scale-75 transition-all' : ''
            ]" :title="item.label" @click="router.push(item.to)" @mousedown.prevent="onPinnedMouseDown($event, item)">
              <Icon :name="item.icon" class="size-5" />
            </button>

            <!-- Drop target indicator -->
            <div v-if="isDragOver"
              class="w-10 h-10 rounded-xl border-2 border-dashed border-[var(--app-accent)] flex items-center justify-center bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)]">
              <span class="text-[var(--app-accent)] text-lg">+</span>
            </div>

            <!-- Empty state hint when no spaces pinned and not dragging -->
            <div v-else-if="pinnedSpaceNavItems.length === 0" class="flex flex-col items-center gap-1 py-2">
              <span class="text-[9px] text-app-muted text-center leading-tight px-1">Drag spaces here</span>
            </div>

            <div class="flex-1" />

            <!-- Browser — opens a GenericBrowser window. Hidden for now;
               feature still works, just not surfaced in the sidebar. -->
            <button v-if="false" class="sidebar-btn sidebar-btn-inactive" title="Browser" data-tour="sidebar-browser"
              @click="openBrowser">
              <Globe class="size-5" />
            </button>
          </div>

          <!-- ====== Right Panel (space sub-pages OR project spaces) ====== -->
          <div
            class="sidebar-face sidebar-face--right absolute top-0 left-full w-full h-full flex flex-col items-center gap-1 pt-2 overflow-y-auto scrollbar-none">
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

              <!-- Per-account avatars (multi-account spaces only).
                   Falls back to initials when no avatar URL is set. -->
              <template v-if="state.activeSpaceAccounts.length">
                <div class="w-8 h-px bg-app-border" />
                <template v-for="acct in state.activeSpaceAccounts" :key="acct.id">
                  <RouterLink :to="acct.route"
                    class="sidebar-btn p-0 overflow-hidden"
                    :class="acct.active ? 'sidebar-btn-active' : 'sidebar-btn-inactive'"
                    :title="acct.label">
                    <img v-if="acct.avatar" :src="acct.avatar" :alt="acct.label"
                      referrerpolicy="no-referrer"
                      class="size-7 rounded-md object-cover" />
                    <span v-else
                      class="size-7 rounded-md flex items-center justify-center text-[10px] font-semibold bg-app-foreground/10 text-app-foreground">
                      {{ acct.fallback }}
                    </span>
                  </RouterLink>
                </template>
              </template>

              <div class="w-8 h-px bg-app-border" />

              <template v-for="item in state.activeSpaceItems" :key="item.route">
                <RouterLink :to="item.route" class="sidebar-btn"
                  :class="route.path === item.route ? 'sidebar-btn-active' : 'sidebar-btn-inactive'"
                  :title="item.label">
                  <Icon :name="item.icon || 'i-lucide-circle'" class="size-4" />
                </RouterLink>
              </template>
            </template>

            <div class="flex-1" />
          </div>
        </div>
      </div>

      <!-- All Spaces (Launchpad) — permanent, outside the 3D cube so it stays
           visible in both the main panel and the rotated space/project panel
           (same treatment as the notification bell + avatar below). -->
      <div class="shrink-0 mb-2 flex justify-center">
        <RouterLink to="/app/spaces" class="sidebar-btn"
          :class="activeId === 'all-spaces' ? 'sidebar-btn-active' : 'sidebar-btn-inactive'" title="All Spaces"
          data-tour="sidebar-spaces">
          <LayoutGrid class="size-5" />
        </RouterLink>
      </div>
    </template>

    <!-- Notification bell — sits above the avatar so the unread badge
         is visible even when a flyout / dropdown is closed -->
    <div v-if="authStore.isAuthenticated" class="shrink-0 mb-2 flex justify-center">
      <NotificationBell />
    </div>

    <!-- Avatar / user menu — always visible outside the 3D cube -->
    <div class="shrink-0 mb-4 relative flex justify-center">
      <button
        class="size-9 rounded-full flex items-center justify-center overflow-hidden ring-2 transition-all relative"
        :class="showUserMenu
          ? 'ring-app-accent'
          : 'ring-app-border hover:ring-app-muted'" :title="authStore.user?.name || authStore.userEmail"
        data-tour="sidebar-avatar" @click="showUserMenu = !showUserMenu">
        <!-- Org badge indicator -->
        <span v-if="authStore.isOrgManaged"
          class="absolute -top-0.5 -right-0.5 size-3 rounded-full bg-amber-500 border-2 border-[var(--app-background)] z-10" />
        <img v-if="authStore.userAvatar" :src="authStore.userAvatar" :alt="authStore.userName"
          referrerpolicy="no-referrer" class="w-full h-full object-cover" />
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
              <CircleUser class="size-4 text-app-muted shrink-0" />
              Profile
            </button>
            <button
              class="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-app-foreground hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)] transition-colors text-left"
              @click="navigateTo('/app/settings')">
              <Settings class="size-4 text-app-muted shrink-0" />
              Settings
            </button>
            <button
              class="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-app-foreground hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)] transition-colors text-left"
              @click.stop="showThemeMenu = !showThemeMenu">
              <Palette class="size-4 text-app-muted shrink-0" />
              <span class="flex-1">Theme</span>
              <span class="text-[11px] text-app-muted truncate">{{ currentThemeLabel }}</span>
              <ChevronRight class="size-3.5 text-app-muted shrink-0 transition-transform"
                :class="showThemeMenu ? 'rotate-90' : ''" />
            </button>
            <div v-if="showThemeMenu" class="pl-6 pr-1 pb-1 max-h-64 overflow-y-auto">
              <button v-for="t in allThemes" :key="t.id"
                class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-app-foreground hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)] transition-colors text-left"
                @click="pickTheme(t.id)">
                <Check class="size-3 shrink-0" :class="t.id === currentThemeId ? 'text-app-accent' : 'opacity-0'" />
                <span class="flex-1 truncate">{{ t.name }}</span>
              </button>
            </div>
            <button
              class="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-app-foreground hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)] transition-colors text-left"
              @click.stop="showProfileMenu = !showProfileMenu">
              <Users class="size-4 text-app-muted shrink-0" />
              <span class="flex-1">Switch Profile</span>
              <ChevronRight class="size-3.5 text-app-muted shrink-0 transition-transform"
                :class="showProfileMenu ? 'rotate-90' : ''" />
            </button>
            <div v-if="showProfileMenu" class="pl-6 pr-1 pb-1 max-h-64 overflow-y-auto">
              <button
                v-for="(p, index) in profileStore.profiles"
                :key="p.id"
                class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-app-foreground hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)] transition-colors text-left"
                @click="pickProfile(p)">
                <ProfileAvatar
                  :name="p.name"
                  :avatar="p.avatar"
                  :index="index"
                  :size="20"
                />
                <span class="flex-1 truncate">{{ p.name }}</span>
                <Check class="size-3 shrink-0" :class="p.id === profileStore.activeProfileId ? 'text-app-accent' : 'opacity-0'" />
              </button>
              <button
                class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-app-muted hover:text-app-foreground hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)] transition-colors text-left mt-1"
                @click="navigateTo('/login?switch=1')">
                <Users class="size-3 shrink-0" />
                <span class="flex-1 truncate">Manage profiles…</span>
              </button>
            </div>
          </div>

          <div class="border-t border-app-border py-1">
            <button
              class="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-500 hover:bg-red-500/10 transition-colors text-left"
              @click="openLogoutDialog">
              <LogOut class="size-4 shrink-0" />
              Log out
            </button>
          </div>
        </div>
      </Teleport>
    </div>

    <!-- Logout dialog: the two option cards are the action surface —
         clicking a card fires that sign-out path. No separate footer
         buttons; Cancel is the header X. A busy overlay covers both
         cards while a choice is in flight so double-clicks can't race. -->
    <Modal v-model:open="logoutDialogOpen" :prevent-close="logoutBusy">
      <template #header>
        <div class="flex items-center gap-3">
          <LogOut class="size-5 text-[var(--app-muted)]" />
          <h3 class="text-lg font-semibold text-[var(--app-foreground)]">Sign out</h3>
        </div>
      </template>

      <template #body>
        <div class="space-y-4">
          <p class="text-sm text-[var(--app-muted)]">
            Choose how you want to sign out. Signing out disconnects this session;
            a full cleanup also removes local data tied to this profile.
          </p>

          <button type="button" :disabled="logoutBusy" @click="confirmSoftLogout"
            class="w-full text-left rounded-lg border border-[var(--app-border)] p-3 space-y-1 transition-colors hover:border-app-accent hover:bg-[color-mix(in_srgb,var(--app-accent)_5%,transparent)] disabled:opacity-50 disabled:pointer-events-none">
            <p class="text-sm font-medium text-[var(--app-foreground)]">Sign out only</p>
            <p class="text-xs text-[var(--app-muted)]">
              Clears your session, the biometric unlock key, and any cached tokens.
              Keeps your profile, onboarding progress, tasks, and pinned items so
              signing back in picks up where you left off.
            </p>
          </button>

          <button type="button" :disabled="logoutBusy" @click="confirmHardLogout"
            class="w-full text-left rounded-lg border border-red-500/30 bg-red-500/5 p-3 space-y-1 transition-colors hover:border-red-500/60 hover:bg-red-500/10 disabled:opacity-50 disabled:pointer-events-none">
            <div class="flex items-center gap-2">
              <AlertTriangle class="size-4 text-red-500" />
              <p class="text-sm font-medium text-[var(--app-foreground)]">Sign out & delete local data</p>
            </div>
            <p class="text-xs text-[var(--app-muted)]">
              Everything above, plus deletes this profile row, its tasks, its
              pinned items, and its onboarding flag. Your account on
              my.construct.space is untouched. This cannot be undone.
            </p>
          </button>

          <p v-if="logoutBusy" class="text-xs text-[var(--app-muted)] text-center">
            Signing out…
          </p>
        </div>
      </template>
    </Modal>
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

/* 2-panel slider — plain 2D translateX (no preserve-3d, which was unreliable
   on WebView2 and overlaid the right face onto the front buttons). The wrapper
   slides left by one panel-width to reveal the right panel; the parent's
   overflow-hidden clips the off-screen panel. */
.sidebar-cube__wrapper {
  transition: transform 0.3s ease;
}

.scrollbar-none::-webkit-scrollbar {
  display: none;
}

.scrollbar-none {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
