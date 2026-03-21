<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { IS_DEV_INSTANCE } from '@/lib/appPaths'
import { useProjectStore } from '@/stores/project'
import { useToolbar } from '@/composables/useToolbar'
import { buildProjectRoutePath } from '@/utils/projectRoutes'
import { useVibe } from '../composables/useVibe'

const vibePrompts = [
  'What should Vibe build?',
  'What are we building today?',
  'Drop an idea, Vibe does the rest.',
  'Describe it. Vibe ships it.',
  'One goal. Full execution.',
  'From idea to running code.',
  'What\'s the next thing?',
  'Build something real.',
  'Ship it before lunch.',
  'Turn words into software.',
]
const vibeTitle = ref(vibePrompts[Math.floor(Math.random() * vibePrompts.length)])
import VibeHeader from '../components/VibeHeader.vue'
import VibeChat from '../components/VibeChat.vue'
import VibeActivity from '../components/VibeActivity.vue'
import VibeSessionList from '../components/VibeSessionList.vue'
import MatrixRain from '../components/MatrixRain.vue'
import { useVibePreview } from '../composables/useVibePreview'
import { buildConstructSpaceDevRoute, isConstructSpaceHandoff } from '../utils/spaceLaunch'
import { sameVibeSessionProject } from '../utils/sessionProject'

const route = useRoute()
const router = useRouter()
const projectStore = useProjectStore()
const { setBreadcrumbs } = useToolbar()
const toast = useToast()
const vibe = useVibe()
const preview = useVibePreview()
const spaceActionStarting = ref(false)
const completionActionError = ref('')

// Set breadcrumb to include project name when session has project context
const isProjectRoute = computed(() => /^\/app\/projects\//.test(route.path))
const isProjectVibeRoute = computed(() => /^\/app\/projects\/[^/]+\/vibe/.test(route.path))
const routeProjectId = computed(() => {
  const raw = route.params.projectId
  return typeof raw === 'string' ? raw.trim() : ''
})
watch(
  () => vibe.session.value?.project_name || projectStore.currentProject?.name,
  (projectName) => {
    if (isProjectRoute.value || !projectName) {
      setBreadcrumbs([]) // Let route-based breadcrumbs handle it
      return
    }
    setBreadcrumbs([
      { label: 'PROJECTS', to: '/app/projects' },
      { label: projectName.toUpperCase() },
      { label: 'VIBE' },
    ])
  },
  { immediate: true },
)

watch(
  () => isProjectVibeRoute.value,
  (isProject) => {
    // Avoid carrying stale project selection into global Vibe entry.
    if (!isProject) {
      projectStore.clearCurrentProject()
    }
  },
  { immediate: true },
)


// ─── Resizable split ───
const splitPercent = ref(50)
const isDragging = ref(false)
const containerRef = ref<HTMLElement>()

function onDividerMouseDown(e: MouseEvent) {
  e.preventDefault()
  isDragging.value = true
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
}

function onMouseMove(e: MouseEvent) {
  if (!isDragging.value || !containerRef.value) return
  const rect = containerRef.value.getBoundingClientRect()
  const x = e.clientX - rect.left
  const pct = (x / rect.width) * 100
  splitPercent.value = Math.min(75, Math.max(25, pct))
}

function onMouseUp() {
  isDragging.value = false
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)
}

function onDividerDblClick() {
  splitPercent.value = 50
}

// Status label: prefer streamStatus when active, fall back to session status
const headerStatus = computed(() => {
  const streamState = vibe.status.value.state
  const sessionState = vibe.session.value?.status?.toLowerCase() || ''
  if (sessionState === 'cancelled' || sessionState === 'canceled') return 'Cancelled'
  if (streamState === 'complete') return 'Done'
  if (streamState === 'error') return 'Failed'
  // Use session phase label — not the tool call detail
  const sess = vibe.session.value?.status
  if (sess) {
    const normalized = sess.toLowerCase()
    if (normalized === 'complete') return 'Done'
    if (normalized === 'cancelled' || normalized === 'canceled') return 'Cancelled'
    if (normalized === 'failed' || normalized === 'error' || normalized === 'blocked') return 'Failed'
    return sess.charAt(0).toUpperCase() + sess.slice(1).replace(/_/g, ' ')
  }
  if (streamState === 'thinking') return 'Thinking'
  if (streamState === 'tool_running' || streamState === 'tool_done') return 'Implementing'
  if (vibe.isRunning.value) return 'Running'
  return 'Ready'
})

// Filter sessions to current project only (for the header goal switcher)
const currentProjectSessions = computed(() => {
  const activeSession = vibe.session.value
  const currentProject = vibe.currentProject.value
  const projectRef = activeSession?.project_id || activeSession?.project_path || activeSession?.project_name
    ? {
        session_id: activeSession.session_id || undefined,
        project_id: activeSession.project_id,
        project_path: activeSession.project_path,
        project_name: activeSession.project_name,
      }
    : isProjectVibeRoute.value && (routeProjectId.value || currentProject)
      ? {
          project_id: routeProjectId.value || (currentProject?.id ? String(currentProject.id) : undefined),
          project_path: vibe.projectPath.value || undefined,
          project_name: currentProject?.name,
        }
      : null

  if (!projectRef) return vibe.savedSessions.value
  return vibe.savedSessions.value.filter(s => sameVibeSessionProject(s, projectRef))
})

const visibleSavedSessions = computed(() => isProjectVibeRoute.value ? currentProjectSessions.value : [])
const isConstructSpace = computed(() => isConstructSpaceHandoff(vibe.handoff.value))
const constructSpaceRoute = computed(() => buildConstructSpaceDevRoute({
  handoff: vibe.handoff.value,
  routeProjectId: routeProjectId.value,
  project: vibe.currentProject.value,
}))
const completionPanelError = computed(() => isConstructSpace.value
  ? completionActionError.value
  : completionActionError.value || preview.error.value)

watch(
  () => vibe.session.value?.session_id,
  () => {
    completionActionError.value = ''
  },
)

function submitDraft() {
  vibe.submit()
}

async function openSpaceInConstructDev() {
  completionActionError.value = ''

  const targetRoute = constructSpaceRoute.value
  if (!targetRoute) {
    const message = 'Could not resolve the Construct DEV route for this space.'
    completionActionError.value = message
    toast.add({
      title: 'Space route unavailable',
      description: message,
      color: 'warning',
    })
    return
  }

  spaceActionStarting.value = true
  try {
    if (IS_DEV_INSTANCE.value) {
      if (route.path !== targetRoute) {
        await router.push(targetRoute)
      }
      return
    }

    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('open_construct_dev_route', { route: targetRoute })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to open Construct DEV for this space.'
    completionActionError.value = message
    toast.add({
      title: 'Could not open Construct DEV',
      description: message,
      color: 'warning',
    })
  } finally {
    spaceActionStarting.value = false
  }
}

async function openGoalDoc() {
  const projectPath = vibe.session.value?.project_path || vibe.projectPath.value
  if (!projectPath) return
  // Open the docs folder in the docs space
  const project = projectStore.openProject(projectPath)
  if (project) {
    router.push(`${buildProjectRoutePath(project)}/docs`)
  }
}
</script>

<template>
  <DashboardPanel :grow="true" :ui="{ body: '!p-0 !overflow-hidden' }">
    <template #body>
      <div class="flex flex-col overflow-hidden" style="height: calc(100vh - 72px)">

        <!-- ═══ Empty state: goal input + session history ═══ -->
        <div v-if="!vibe.hasSession.value && !vibe.isRunning.value" class="flex-1 min-h-0 overflow-y-auto flex flex-col lg:flex-row">

          <!-- Left: centered goal input -->
          <div class="relative isolate flex min-h-0 flex-1 items-center justify-center px-6 py-6 lg:px-10 xl:px-14">
            <MatrixRain />
            <div class="relative z-10 w-full max-w-2xl space-y-6">
              <div class="space-y-4">
                <div class="inline-flex h-14 w-14 items-center justify-center rounded-3xl bg-[#00ff41]/10">
                  <Icon name="i-lucide-zap" class="size-7 text-[#00ff41]" />
                </div>
                <div class="space-y-2">
                  <h1 class="text-3xl font-bold tracking-tight text-app-foreground">
                    {{ vibeTitle }}
                  </h1>
                  <p class="max-w-xl text-sm leading-7 text-app-muted">
                    Describe a goal and Vibe will plan, implement, and verify in one flow.
                  </p>
                  <p v-if="projectStore.projectsRoot" class="text-xs text-app-muted/40">
                    <Icon name="i-lucide-folder" class="size-3 inline mr-1" />{{ projectStore.projectsRoot }}
                  </p>
                </div>
              </div>

              <div class="rounded-3xl border border-app bg-app-panel p-4 shadow-[0_18px_48px_rgba(0,0,0,0.18)] sm:p-5">
                <p class="text-[11px] uppercase tracking-[0.18em] text-app-muted/70">Goal</p>
                <div class="mt-3">
                  <textarea
                    v-model="vibe.draft.value"
                    class="w-full rounded-2xl border border-app bg-[var(--app-background)] px-4 py-3 text-sm text-app-foreground placeholder-app-muted/40 outline-none focus:border-[#00ff41]/30 focus:ring-1 focus:ring-[#00ff41]/30 resize-none transition-colors"
                    placeholder="e.g. Build an HTML landing page for a SaaS product with hero, pricing, testimonials, and a contact form..."
                    rows="5"
                    @keydown.enter.exact.prevent="submitDraft()"
                    @keydown.enter.meta.prevent="submitDraft()"
                    @keydown.enter.ctrl.prevent="submitDraft()"
                  />
                </div>

                <div v-if="vibe.error.value" class="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3">
                  <div class="flex items-start gap-2">
                    <Icon name="i-lucide-alert-circle" class="size-4 text-red-400 mt-0.5 shrink-0" />
                    <p class="text-sm text-red-300 flex-1">{{ vibe.error.value }}</p>
                  </div>
                </div>

                <div class="mt-4 flex flex-col gap-3 sm:flex-row">
                  <button
                    class="flex-1 rounded-2xl py-3 text-sm font-semibold transition-all duration-200"
                    :class="vibe.draft.value.trim()
                      ? 'bg-[#00ff41] text-black hover:bg-[#33ff6a] cursor-pointer'
                      : 'bg-app-panel text-app-muted/40 cursor-not-allowed'"
                    :disabled="!vibe.draft.value.trim()"
                    @click="submitDraft()"
                  >
                    Start Vibing
                  </button>
                </div>
              </div>

              <div v-if="vibe.handoff.value" class="rounded-2xl border border-[#00ff41]/20 bg-[#00ff41]/6 px-4 py-3">
                <p class="text-[11px] uppercase tracking-[0.16em] text-[#66ff93]/80">Architect handoff attached</p>
                <p class="mt-1 text-sm leading-6 text-app-muted">{{ vibe.handoff.value.description?.slice(0, 160) }}</p>
              </div>
            </div>
          </div>

          <!-- Right: session history -->
          <VibeSessionList
            v-if="isProjectVibeRoute"
            class="w-full max-h-[300px] lg:max-h-none lg:w-[380px] xl:w-[420px] shrink-0"
            :sessions="visibleSavedSessions"
            :is-loading="vibe.isLoadingHistory.value"
            @open="vibe.openSession($event)"
            @delete="vibe.deleteSession($event)"
            @refresh="vibe.refreshHistory()"
          />
        </div>

        <!-- ═══ Active session: header + split pane ═══ -->
        <template v-else>
          <VibeHeader
            :project-name="vibe.currentProject.value?.name || vibe.session.value?.project_name || ''"
            :status-label="headerStatus"
            :is-running="vibe.isRunning.value"
            :is-construct-space="isConstructSpace"
            :preview-url="preview.serverUrl.value"
            :preview-starting="preview.isStarting.value"
            :preview-running="preview.isRunning.value"
            :space-action-starting="spaceActionStarting"
            :project-path="vibe.session.value?.project_path || vibe.projectPath.value || ''"
            :is-done="vibe.status.value.state === 'complete' || vibe.session.value?.status === 'complete'"
            :saved-sessions="currentProjectSessions"
            :current-session-id="vibe.session.value?.session_id || ''"
            @new-goal="vibe.newGoal()"
            @new-project="vibe.newProject()"
            @switch-session="vibe.openSession($event)"
            @reset="vibe.reset(); preview.stop()"
            @stop="vibe.stop()"
            @preview-start="preview.start(vibe.session.value?.project_path || vibe.projectPath.value || '')"
            @preview-open="preview.openInConstruct()"
            @preview-stop="preview.stop()"
            @space-open="openSpaceInConstructDev()"
          />

          <!-- Goal banner -->
          <div class="shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-app bg-[#00ff41]/[0.03]">
            <div class="min-w-0">
              <p class="text-[10px] uppercase tracking-[0.14em] text-[#33ff6a]/70">Goal</p>
              <p class="mt-0.5 text-sm leading-6 text-app truncate">
                {{ vibe.session.value?.goal || vibe.submittedGoal.value || vibe.draft.value || 'Waiting for goal...' }}
              </p>
            </div>
            <button
              v-if="vibe.session.value?.project_path"
              class="shrink-0 ml-3 rounded-lg border border-app bg-white/5 px-2.5 py-1 text-[10px] font-medium text-app-muted transition hover:bg-white/8 hover:text-app"
              title="Open goal doc"
              @click="openGoalDoc()"
            >
              <Icon name="i-lucide-file-text" class="size-3 inline mr-0.5" />
              Goal Doc
            </button>
          </div>

          <!-- Error banner (persistent, visible) -->
          <div v-if="vibe.error.value" class="shrink-0 flex items-start gap-2 px-4 py-2.5 border-b border-red-500/20 bg-red-500/8">
            <Icon name="i-lucide-alert-circle" class="size-4 text-red-400 mt-0.5 shrink-0" />
            <p class="text-sm text-red-300 flex-1">{{ vibe.error.value }}</p>
            <button class="shrink-0 text-red-400/60 hover:text-red-300 transition" @click="vibe.clearError()">
              <Icon name="i-lucide-x" class="size-3.5" />
            </button>
          </div>

          <!-- Split pane -->
          <div ref="containerRef" class="flex-1 flex min-h-0" :class="isDragging && 'select-none'">

            <!-- LEFT: Chat -->
            <div class="flex flex-col min-w-0 min-h-0 overflow-hidden" :style="{ width: splitPercent + '%' }">
              <VibeChat
                :messages="vibe.messages.value"
                :draft="vibe.draft.value"
                :is-running="vibe.isRunning.value"
                :queue-count="vibe.inputQueue.value.length"
                :error="vibe.error.value"
                :goal="vibe.session.value?.goal || vibe.submittedGoal.value || ''"
                :tool-count="vibe.toolHistory.value.length"
                :is-done="vibe.status.value.state === 'complete'"
                :status-message="vibe.statusMessage.value"
                :status-update="vibe.statusNarration.value"
                :status-state="vibe.status.value.state"
                :session-status="vibe.session.value?.status || ''"
                :project-path="vibe.session.value?.project_path || vibe.projectPath.value || ''"
                :is-construct-space="isConstructSpace"
                :preview-url="preview.serverUrl.value"
                :preview-starting="preview.isStarting.value"
                :preview-running="preview.isRunning.value"
                :space-action-starting="spaceActionStarting"
                :completion-action-error="completionPanelError"
                :progress-updates="vibe.progressUpdates.value"
                :tool-history="vibe.toolHistory.value"
                @update:draft="vibe.draft.value = $event"
                @submit="submitDraft()"
                @preview-start="preview.start(vibe.session.value?.project_path || vibe.projectPath.value || '')"
                @preview-open="preview.openInConstruct()"
                @preview-stop="preview.stop()"
                @space-open="openSpaceInConstructDev()"
              />
            </div>

            <!-- DIVIDER -->
            <div
              class="w-1 shrink-0 cursor-col-resize group relative flex items-center justify-center hover:bg-[#00ff41]/10 transition-colors"
              :class="isDragging && 'bg-[#00ff41]/10'"
              @mousedown="onDividerMouseDown"
              @dblclick="onDividerDblClick"
            >
              <div
                class="w-px h-full group-hover:w-0.5 rounded-full transition-all"
                :class="isDragging ? 'w-0.5 bg-[#00ff41]/40' : 'bg-[var(--app-border)]/20 group-hover:bg-[#00ff41]/30'"
              />
            </div>

            <!-- RIGHT: Activity -->
            <div class="min-h-0 overflow-hidden flex-1 flex flex-col bg-black/10">
              <VibeActivity
                :tool-history="vibe.toolHistory.value"
                :turn="vibe.status.value.turn"
                :max-turns="vibe.status.value.maxTurns"
                :is-running="vibe.isRunning.value"
                @stop="vibe.stop()"
              />
            </div>
          </div>
        </template>
      </div>
    </template>
  </DashboardPanel>
</template>
