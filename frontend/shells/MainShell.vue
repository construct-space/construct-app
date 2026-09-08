<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { isTauriEnv } from '@/utils/tauri'
import { useWindowChromeState } from '@/composables/useWindowChromeState'
import { useTelemetry } from '@/composables/useTelemetry'
import { useStreamStatus } from '@/composables/useStreamStatus'
import { useUniversalBootstrap } from '@/composables/useUniversalBootstrap'
import { useAppMenu } from '@/composables/useAppMenu'
import { useDeepLink } from '@/composables/useDeepLink'
import { useAuthStore } from '@/stores/auth'
import ProjectSetupHost from '@/components/common/ProjectSetupHost.vue'
// AssistantPanel mount lives in DefaultLayout (with drag + resize +
// Transition wrapper). Re-add the import here only if a future shell
// path needs to mount the panel without going through DefaultLayout.
import PermissionGate from '@/components/agent/PermissionGate.vue'
import GuidedTour from '@/components/common/GuidedTour.vue'
import PermissionsOnboarding from '@/components/common/PermissionsOnboarding.vue'

interface TourStep {
  target?: string
  title: string
  description: string
  badge?: string
  placement?: 'top' | 'bottom' | 'left' | 'right'
}
import { bootstrapMain } from '@/lib/window/bootstrapMain'

// Universal wiring: theme, devtools shortcut, context-menu suppression
useUniversalBootstrap()

// Main-window lifecycle-bound composables — MUST run at setup time,
// not inside bootstrapMain (which is async and loses setup context).
useAppMenu()
useDeepLink()

const route = useRoute()
const isTauri = isTauriEnv()
const telemetry = useTelemetry()
const authStore = useAuthStore()

// ── Guided tour ──────────────────────────────────────────────────────────
// Shown once per user on their first visit into the app shell. Flag is
// keyed by user id so multi-profile machines get one tour per account.
const tourOpen = ref(false)
const tourSteps: TourStep[] = [
  {
    target: '[data-tour="sidebar-ask"]',
    badge: '01',
    title: '<strong>Ask</strong> anything, anywhere',
    description: 'Open Ask from the sidebar to ask questions, brainstorm, or explore ideas with any model.',
  },
  {
    target: '[data-tour="sidebar-spaces"]',
    badge: '02',
    title: 'Your <strong>Spaces</strong>',
    description: 'Every tool — notes, projects, kanban boards, designs — lives here as a Space. Grab one from the marketplace or build your own.',
  },
  {
    target: '[data-tour="sidebar-browser"]',
    badge: '03',
    title: 'Built-in <strong>Browser</strong>',
    description: 'Open an in-app browser window for docs, dashboards, or anything else — no context switching out of Construct.',
  },
  {
    target: '[data-tour="sidebar-settings"]',
    badge: '04',
    title: '<strong>Settings</strong>',
    description: 'AI providers, developer tools, Touch ID unlock, and more. Come here to connect Claude, OpenAI, Gemini, or any custom model.',
  },
  {
    target: '[data-tour="sidebar-avatar"]',
    badge: '05',
    title: 'Your <strong>Account</strong>',
    description: 'Profile, switch accounts, sign out. Your session stays on this machine — nothing leaves unless you ask.',
  },
  {
    target: '[data-tour="dashboard-edit"]',
    badge: '06',
    title: 'Make it your own — <strong>Edit</strong>',
    description: 'Click Edit on the dashboard to rearrange, resize, or remove the widget cards. Drop a folder on the app icon to pin projects here fast.',
  },
]

function userKey() {
  return authStore.user?.id || authStore.user?.email || 'unknown'
}

function tourFlagKey() {
  return `construct:tour_complete:${userKey()}`
}

// ── First-run macOS permissions primer ────────────────────────────────────
// Shown once per user, right after sign-in and BEFORE the guided tour, only
// in the macOS desktop build. Lists the OS permissions Construct uses and
// requests notification access up-front; the rest are explained (macOS only
// prompts for mic/camera/files on first use). The tour waits until this is
// dismissed so the two first-run surfaces don't overlap.
const permissionsOpen = ref(false)
const isMacDesktop = ref(false)

function permissionsFlagKey() {
  return `construct:permissions_primer:${userKey()}`
}

async function maybeShowFirstRun() {
  if (!authStore.isAuthenticated) return
  if (!route.path.startsWith('/app')) return

  // Permissions primer first (macOS desktop, once per user). If already
  // seen or not applicable, fall straight through to the tour.
  if (isMacDesktop.value && !localStorage.getItem(permissionsFlagKey())) {
    permissionsOpen.value = true
    return
  }
  maybeStartTour()
}

function markPermissionsSeen() {
  localStorage.setItem(permissionsFlagKey(), 'true')
  permissionsOpen.value = false
  // Hand off to the guided tour now that the primer is dismissed.
  maybeStartTour()
}

function maybeStartTour() {
  if (!authStore.isAuthenticated) return
  if (!route.path.startsWith('/app')) return
  const key = tourFlagKey()
  if (localStorage.getItem(key)) return
  // One microtask so the sidebar finishes mounting and data-tour anchors exist.
  nextTick(() => { tourOpen.value = true })
}

function markTourDone() {
  localStorage.setItem(tourFlagKey(), 'true')
  tourOpen.value = false
}

// Retrigger when the user first lands on an /app route (after onboarding)
// or when the authenticated user changes.
watch(() => [authStore.isAuthenticated, route.path.startsWith('/app')] as const, ([authed, inApp]) => {
  if (authed && inApp) maybeShowFirstRun()
}, { immediate: false })

// Global permission modal — kept as a no-op surface until the legacy
// operator-permission Teleport below is removed. Brain permission UI is
// served by <PermissionGate>; `pendingPermission` from the stub
// composable is permanently null, so this handler never fires.
const streamStatus = useStreamStatus()

async function handlePermission(_action: 'allow' | 'deny', _remember: boolean) {
  streamStatus.pendingPermission.value = null
}

// Check if we're in an app route (needs sidebar + toolbar)
const showSidebar = computed(() => route.path.startsWith('/app'))
const { isWindowChromeHidden } = useWindowChromeState()

// Splash screen — shown while app initializes
const appReady = ref(false)

// Telemetry: session end on page hide/unload
const handleBeforeUnload = () => { telemetry.trackSessionEnd() }
const handleVisibilityChange = () => {
  if (document.visibilityState === 'hidden') telemetry.trackSessionEnd()
}

let cleanupMain: (() => void) | null = null

onMounted(async () => {
  // Main-window bootstrap: auth, bridge, menus, telemetry, updater, etc.
  // Non-main windows early-return immediately inside bootstrapMain.
  const { cleanup } = await bootstrapMain()
  cleanupMain = cleanup

  // Remove HTML splash and reveal app
  const htmlSplash = document.getElementById('splash')
  if (htmlSplash) {
    htmlSplash.style.transition = 'opacity 0.3s ease'
    htmlSplash.style.opacity = '0'
    setTimeout(() => htmlSplash.remove(), 300)
  }
  appReady.value = true

  window.addEventListener('beforeunload', handleBeforeUnload)
  document.addEventListener('visibilitychange', handleVisibilityChange)

  // Detect macOS so the permissions primer only shows where its copy
  // (System Settings › Privacy & Security) actually applies.
  if (isTauri) {
    try {
      const os = await import('@tauri-apps/plugin-os')
      isMacDesktop.value = os.platform() === 'macos'
    } catch { /* non-tauri or plugin missing — leave false */ }
  }

  maybeShowFirstRun()
})

onUnmounted(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  cleanupMain?.()
})
</script>

<template>
  <div class="bg-app-canvas text-app min-h-screen">
    <!-- Native traffic lights handled by macOS (titleBarStyle: Overlay) -->
    <!-- Reserve space so content doesn't overlap the native buttons -->
    <div v-if="isTauri && showSidebar && !isWindowChromeHidden" class="fixed top-0 left-0 w-[78px] h-[38px] z-[200]"
      style="-webkit-app-region: no-drag" />

    <!-- Splash screen -->
    <Transition name="splash-fade">
      <div v-if="!appReady" class="fixed inset-0 z-[9999] flex items-center justify-center bg-[var(--app-background)]">
        <svg width="48" height="48" viewBox="0 0 533 533" fill="currentColor" class="text-app-accent animate-pulse">
          <path
            d="M266.5 410.156C230.912 410.156 199.106 402.203 171.081 386.297C143.056 370.39 121.036 348.519 105.022 320.684C89.0072 292.848 81 261.256 81 225.909C81 190.12 89.0072 158.308 105.022 130.472C121.036 102.636 143.056 80.7655 171.081 64.8593C199.106 48.9531 230.912 41 266.5 41C302.087 41 333.671 48.9531 361.252 64.8593C389.277 80.7655 411.297 102.636 427.311 130.472C443.326 158.308 451.555 190.12 452 225.909C452 261.256 443.77 292.848 427.311 320.684C411.297 348.519 389.277 370.39 361.252 386.297C333.671 402.203 302.087 410.156 266.5 410.156ZM266.5 363.763C292.301 363.763 315.433 357.798 335.896 345.868C356.359 333.939 372.373 317.591 383.939 296.824C395.505 276.058 401.288 252.42 401.288 225.909C401.288 199.399 395.505 175.761 383.939 154.994C372.373 133.786 356.359 117.217 335.896 105.287C315.433 93.3579 292.301 87.393 266.5 87.393C240.699 87.393 217.567 93.3579 197.104 105.287C176.641 117.217 160.405 133.786 148.394 154.994C136.828 175.761 131.045 199.399 131.045 225.909C131.045 252.42 136.828 276.058 148.394 296.824C160.405 317.591 176.641 333.939 197.104 345.868C217.567 357.798 240.699 363.763 266.5 363.763Z" />
          <path
            d="M378.22 451.578C393.077 451.578 405.121 460.85 405.121 472.289C405.121 483.727 393.077 493 378.22 493H160.945C146.089 493 134.044 483.727 134.044 472.289C134.044 460.85 146.089 451.578 160.945 451.578H378.22Z" />
        </svg>
      </div>
    </Transition>

    <!-- Main content. Last-resort error boundary for routes that don't use
         DefaultLayout (login, onboarding, …); pages under DefaultLayout are
         already bounded there, keeping the chrome alive. -->
    <ErrorBoundary v-if="appReady" :key="$route.fullPath">
      <RouterView />
    </ErrorBoundary>

    <!-- Bridge-triggered New Project modal (architect project setup flow) -->
    <ProjectSetupHost v-if="appReady" />

    <!-- ⌘K assistant panel lives inside DefaultLayout (with its
         drag + resize + Transition wrapper). MainShell intentionally
         does NOT mount it — having both caused two panels to render
         simultaneously on the personal route tree. If org-tree
         layouts ever need the assistant, add the mount there
         alongside the same drag wrapper rather than re-introducing
         it at the shell level. -->
    <!-- <AssistantPanel /> -->

    <!-- Brain permission gate. Registers `permission.request` on the brain
         bridge; pops a modal when brain's "ask" gate fires mid-tool.
         Operator's separate pendingPermission flow (see handlePermission)
         is still served by the inline operator modal below until operator
         is fully decommissioned. -->
    <PermissionGate v-if="appReady" />

    <!-- Operator permission modal — legacy path, kept until operator
         is decommissioned. Triggered by useStreamStatus().pendingPermission
         (set by operator stream events) and resolved via operator.send. -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="streamStatus.pendingPermission.value"
          class="fixed inset-0 z-[9000] flex items-center justify-center p-4">
          <div class="absolute inset-0 bg-black/50" @click="handlePermission('deny', false)" />
          <div
            class="relative bg-[var(--app-surface)] border border-[var(--app-border)] rounded-xl shadow-2xl max-w-md w-full">
            <div class="px-5 pt-5 pb-3">
              <h3 class="text-sm font-semibold text-[var(--app-foreground)]">Permission Required</h3>
              <p class="text-xs text-[var(--app-muted)] mt-1">
                Agent wants to use <span class="font-mono text-[var(--app-foreground)]">{{
                  streamStatus.pendingPermission.value?.tool }}</span>
              </p>
              <div v-if="streamStatus.pendingPermission.value?.input"
                class="mt-3 p-3 rounded-lg bg-[var(--app-background)] border border-[var(--app-border)] max-h-32 overflow-y-auto">
                <pre
                  class="text-[11px] text-[var(--app-muted)] whitespace-pre-wrap break-all font-mono">{{ streamStatus.pendingPermission.value.input }}</pre>
              </div>
            </div>
            <div class="px-5 pb-5 pt-3 flex gap-2 justify-end border-t border-[var(--app-border)]">
              <button class="px-3 py-1.5 rounded-md text-xs font-medium text-red-400 hover:bg-red-500/10 transition"
                @click="handlePermission('deny', false)">
                Deny
              </button>
              <button
                class="px-3 py-1.5 rounded-md text-xs font-medium text-[var(--app-foreground)] hover:bg-white/5 border border-[var(--app-border)] transition"
                @click="handlePermission('allow', false)">
                Allow Once
              </button>
              <button
                class="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--app-accent)] text-white hover:opacity-90 transition"
                @click="handlePermission('allow', true)">
                Always Allow
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Global toast notifications -->
    <Notification />

    <!-- First-run macOS permissions primer. Shown once per user before the
         guided tour; dismissing it flips the flag and hands off to the tour. -->
    <PermissionsOnboarding v-if="appReady && permissionsOpen" @done="markPermissionsSeen" />

    <!-- First-run guided tour. Only renders when the flag isn't set for
         the current user; skip/finish both flip the flag. -->
    <GuidedTour v-model="tourOpen" :steps="tourSteps" @finish="markTourDone" @skip="markTourDone" />
  </div>
</template>

<style>
.splash-fade-leave-active {
  transition: opacity 0.3s ease;
}

.splash-fade-leave-to {
  opacity: 0;
}
</style>
