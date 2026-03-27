<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { IS_DEV_INSTANCE } from '@/lib/appPaths'
import { useProjectStore } from '@/stores/project'
import { useToolbar } from '@/composables/useToolbar'
import { buildProjectRoutePath } from '@/utils/projectRoutes'
import { useVibe } from '../composables/useVibe'
import { vibeStatusBadgeClass } from '../composables/useVibeFormat'
import { Zap } from 'lucide-vue-next'

const standalonePrompts = [
  'What should Vibe build?',
  'What are we building today?',
  'Drop an idea, Vibe does the rest.',
  'Describe it. Vibe ships it.',
  'One goal. Full execution.',
  'From idea to running code.',
  'Build something real.',
  'Turn words into software.',
]
const projectPrompts = [
  'Ready to build.',
  'Let\'s ship this.',
  'Time to code.',
  'Let\'s get to work.',
]
import VibeHeader from '../components/VibeHeader.vue'
import VibeChat from '../components/VibeChat.vue'
import VibeActivity from '../components/VibeActivity.vue'
import VibeSessionList from '../components/VibeSessionList.vue'
import CodeRain from '../components/MatrixRain.vue'
import { useVibePreview } from '../composables/useVibePreview'
import { buildConstructSpaceDevRoute, isConstructSpaceHandoff } from '../utils/spaceLaunch'
import { sameVibeSessionProject } from '../utils/sessionProject'

const route = useRoute()
const router = useRouter()
const projectStore = useProjectStore()
const { setBreadcrumbs } = useToolbar()
const toast = useNotification()
const vibe = useVibe()
const preview = useVibePreview()

// Show toast when preview fails
watch(() => preview.error.value, (err) => {
  if (err) toast.add({ title: 'Failed to start dev server', description: err, color: 'error' })
})

const hasProjectContext = computed(() => !!projectStore.currentProject)
const currentProjectPath = computed(() => projectStore.currentProject?.local_path || projectStore.currentProject?.path || '')
const vibeTitle = computed(() => {
  const prompts = hasProjectContext.value ? projectPrompts : standalonePrompts
  return prompts[Math.floor(Math.random() * prompts.length)]
})
const vibeSubtitle = computed(() =>
  hasProjectContext.value
    ? 'Vibe will read the project docs and start building.'
    : 'Describe a goal and Vibe will plan, implement, and verify in one flow.',
)

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
    // Navigate directly in the current instance — no need to spawn a DEV window
    if (route.path !== targetRoute) {
      await router.push(targetRoute)
    }
    return
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to navigate to space.'
    completionActionError.value = message
    toast.add({
      title: 'Navigation failed',
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
        <div v-if="!vibe.hasSession.value && !vibe.isRunning.value"
          class="flex-1 min-h-0 overflow-y-auto flex flex-col lg:flex-row">
          <!-- Left: centered goal input -->
          <div class="relative isolate flex min-h-0 flex-1 items-center justify-center px-6 py-6 lg:px-10 xl:px-14">
            <CodeRain />
            <div class="relative z-10 w-full max-w-2xl space-y-6">
              <div class="space-y-4">
                <div class="inline-flex h-14 w-14 items-center justify-center rounded-3xl bg-[var(--app-accent)]/10">
                  <svg class="size-7 text-[var(--app-accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                </div>
                <div class="space-y-2">
                  <h1 class="text-3xl font-bold tracking-tight text-[var(--app-foreground)]">
                    {{ vibeTitle }}
                  </h1>
                  <p class="max-w-xl text-sm leading-7 text-[var(--app-muted)]">
                    {{ vibeSubtitle }}
                  </p>
                  <p v-if="currentProjectPath" class="text-xs text-[var(--app-muted)]/40 font-mono">
                    {{ currentProjectPath }}
                  </p>
                  <p v-else-if="projectStore.projectsRoot" class="text-xs text-[var(--app-muted)]/40 font-mono">
                    {{ projectStore.projectsRoot }}
                  </p>
                </div>
              </div>

              <div class="rounded-3xl border border-app bg-app-panel p-4 shadow-[0_18px_48px_rgba(0,0,0,0.18)] sm:p-5">
                <p class="text-[11px] uppercase tracking-[0.18em] text-app-muted/70">Goal</p>
                <div class="mt-3">
                  <textarea v-model="vibe.draft.value"
                    class="w-full rounded-2xl border border-app bg-[var(--app-background)] px-4 py-3 text-sm text-app-foreground placeholder-app-muted/40 outline-none focus:border-[var(--app-accent)]/30 focus:ring-1 focus:ring-[var(--app-accent)]/30 resize-none transition-colors"
                    :placeholder="hasProjectContext ? 'Or describe a specific goal...' : 'e.g. Build an HTML landing page for a SaaS product with hero, pricing, testimonials, and a contact form...'"
                    rows="5" @keydown.enter.exact.prevent="submitDraft()" @keydown.enter.meta.prevent="submitDraft()"
                    @keydown.enter.ctrl.prevent="submitDraft()" />
                </div>

                <div v-if="vibe.error.value" class="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3">
                  <div class="flex items-start gap-2">
                    <svg class="size-4 text-red-400 mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    <p class="text-sm text-red-300 flex-1">{{ vibe.error.value }}</p>
                  </div>
                </div>

                <div class="mt-4 flex flex-col gap-3 sm:flex-row">
                  <button v-if="hasProjectContext"
                    class="flex-1 rounded-2xl py-3 text-sm font-semibold transition-all duration-200 bg-[var(--app-accent)] text-black hover:opacity-90 cursor-pointer"
                    @click="if (!vibe.draft.value.trim()) vibe.draft.value = 'Read the project docs in docs/ and implement the full project. Use space_create for Construct Spaces.'; submitDraft()">
                    Start Vibing
                  </button>
                  <button v-else
                    class="flex-1 rounded-2xl py-3 text-sm font-semibold transition-all duration-200"
                    :class="vibe.draft.value.trim()
                      ? 'bg-[var(--app-accent)] text-black hover:opacity-90 cursor-pointer'
                      : 'bg-app-panel text-app-muted/40 cursor-not-allowed'"
                    :disabled="!vibe.draft.value.trim()"
                    @click="submitDraft()">
                    Start Vibing
                  </button>
                </div>
              </div>

              <div v-if="vibe.handoff.value" class="rounded-2xl border border-[var(--app-accent)]/20 bg-[var(--app-accent)]/5 px-4 py-3">
                <p class="text-[11px] uppercase tracking-[0.16em] text-[var(--app-accent)]/80">Architect handoff attached</p>
                <p class="mt-1 text-sm leading-6 text-app-muted">{{ vibe.handoff.value.description?.slice(0, 160) }}</p>
              </div>
            </div>
          </div>

          <!-- Right: session history -->
          <VibeSessionList v-if="isProjectVibeRoute"
            class="w-full max-h-[300px] lg:max-h-none lg:w-[380px] xl:w-[420px] shrink-0"
            :sessions="visibleSavedSessions" :is-loading="vibe.isLoadingHistory.value" @open="vibe.openSession($event)"
            @delete="vibe.deleteSession($event)" @refresh="vibe.refreshHistory()" />
        </div>

        <!-- ═══ Active session: goal banner + split pane ═══ -->
        <template v-else>
          <!-- Toolbar slots: left=status, center=goal, right=actions -->
          <Teleport to="#toolbar-left">
            <div class="flex items-center gap-1.5 text-[11px]">
              <Zap class="size-3 text-[var(--app-accent)]" />
              <span v-if="vibe.isRunning.value" class="size-1.5 rounded-full bg-[var(--app-accent)] animate-pulse" />
              <span class="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider" :class="vibeStatusBadgeClass(headerStatus)">
                {{ headerStatus }}
              </span>
            </div>
          </Teleport>
          <Teleport to="#toolbar-center">
            <button
              class="flex items-center gap-1.5 text-[11px] text-[var(--app-muted)] hover:text-[var(--app-foreground)] transition truncate max-w-[300px]"
              :title="vibe.session.value?.goal || ''"
              @click="openGoalDoc()">
              <span class="truncate">{{ vibe.session.value?.goal || vibe.submittedGoal.value || '' }}</span>
            </button>
          </Teleport>
          <Teleport to="#toolbar-right">
            <div class="flex items-center gap-1.5">
              <button
                class="rounded-md px-2 py-0.5 text-[10px] font-medium text-[var(--app-muted)] transition hover:text-[var(--app-foreground)] hover:bg-[color-mix(in_srgb,var(--app-foreground)_5%,transparent)]"
                :disabled="vibe.isRunning.value"
                @click="vibe.newGoal()">
                New Goal
              </button>
              <template v-if="!vibe.isRunning.value && (vibe.status.value.state === 'complete' || vibe.session.value?.status === 'complete')">
                <button v-if="isConstructSpace"
                  class="rounded-md bg-emerald-500 px-2.5 py-0.5 text-[10px] font-semibold text-white transition hover:bg-emerald-600"
                  :disabled="spaceActionStarting"
                  @click="openSpaceInConstructDev()">
                  Open Space
                </button>
                <button v-else-if="!preview.serverUrl.value"
                  class="rounded-md bg-emerald-500 px-2.5 py-0.5 text-[10px] font-semibold text-white transition hover:bg-emerald-600"
                  :disabled="preview.isStarting.value"
                  @click="preview.start(vibe.session.value?.project_path || vibe.projectPath.value || '')">
                  Run
                </button>
              </template>
            </div>
          </Teleport>

          <!-- Error banner (persistent, visible) -->
          <div v-if="vibe.error.value"
            class="shrink-0 flex items-start gap-2 px-4 py-2.5 border-b border-red-500/20 bg-red-500/8">
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
              <VibeChat :messages="vibe.messages.value" :draft="vibe.draft.value" :is-running="vibe.isRunning.value"
                :queue-count="vibe.inputQueue.value.length" :error="vibe.error.value"
                :goal="vibe.session.value?.goal || vibe.submittedGoal.value || ''"
                :tool-count="vibe.toolHistory.value.length" :is-done="vibe.status.value.state === 'complete'"
                :status-message="vibe.statusMessage.value" :status-update="vibe.statusNarration.value"
                :status-state="vibe.status.value.state" :session-status="vibe.session.value?.status || ''"
                :project-path="vibe.session.value?.project_path || vibe.projectPath.value || ''"
                :is-construct-space="isConstructSpace" :preview-url="preview.serverUrl.value"
                :preview-starting="preview.isStarting.value" :preview-running="preview.isRunning.value"
                :space-action-starting="spaceActionStarting" :completion-action-error="completionPanelError"
                :progress-updates="vibe.progressUpdates.value" @update:draft="vibe.draft.value = $event"
                @submit="submitDraft()"
                @preview-start="preview.start(vibe.session.value?.project_path || vibe.projectPath.value || '')"
                @preview-open="preview.openInConstruct()" @preview-stop="preview.stop()"
                @space-open="openSpaceInConstructDev()" />
            </div>

            <!-- DIVIDER -->
            <div
              class="w-1 shrink-0 cursor-col-resize group relative flex items-center justify-center hover:bg-[var(--app-accent)]/10 transition-colors"
              :class="isDragging && 'bg-[var(--app-accent)]/10'" @mousedown="onDividerMouseDown" @dblclick="onDividerDblClick">
              <div class="w-px h-full group-hover:w-0.5 rounded-full transition-all"
                :class="isDragging ? 'w-0.5 bg-[var(--app-accent)]/40' : 'bg-[var(--app-border)]/20 group-hover:bg-[var(--app-accent)]/30'" />
            </div>

            <!-- RIGHT: Activity -->
            <div class="min-h-0 overflow-hidden flex-1 flex flex-col bg-black/10">
              <VibeActivity :tool-history="vibe.toolHistory.value" :turn="vibe.status.value.turn"
                :max-turns="vibe.status.value.maxTurns" :is-running="vibe.isRunning.value" @stop="vibe.stop()" />
            </div>
          </div>
        </template>
      </div>
    </template>
  </DashboardPanel>
</template>
