<script setup lang="ts">
/**
 * Architect Space - AI-powered project planning (Split-view UI)
 *
 * Left panel: Questions stacking vertically with curved brace decoration
 * Right panel: Live project summary with decisions, features, create button
 * Bottom: Input bar with Expand and Attach buttons
 */
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useArchitectEngine } from '../composables/useArchitectEngine'
import ArchitectQuestionFlow from '../components/ArchitectQuestionFlow.vue'
import ArchitectProjectSummary from '../components/ArchitectProjectSummary.vue'
import ArchitectBottomInput from '../components/ArchitectBottomInput.vue'
import ArchitectProjectConfig from '../components/ArchitectProjectConfig.vue'
import { storeVibeHandoff } from '../utils/vibeHandoff'

const route = useRoute()
const router = useRouter()
const engine = useArchitectEngine()

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
  splitPercent.value = Math.min(80, Math.max(20, pct))
}

function onMouseUp() {
  isDragging.value = false
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', onMouseUp)
}

function onDividerDblClick() {
  splitPercent.value = 50
}

// Derive selected values for the active question
const activeSelectedValues = computed(() => {
  if (!engine.currentQuestion.value) return []
  if (engine.currentQuestion.value.type === 'multi') return engine.selectedMulti.value
  return engine.selectedSingle.value ? [engine.selectedSingle.value] : []
})

// Input placeholder changes based on state
const inputPlaceholder = computed(() => {
  if (!engine.questions.value.length) return 'Describe what you want to build...'
  if (engine.isDone.value) return 'Start over with a new idea...'
  return 'Type your answer or ask a question...'
})

// Whether we're in the initial describe phase (no questions yet)
const isDescribePhase = computed(() => {
  return engine.activeQuestionIndex.value < 0 && !engine.isGeneratingQuestions.value && !engine.questions.value.length
})

// Show the right panel once we have at least a description
const showSummary = computed(() => {
  return engine.description.value.trim().length > 0 && !isDescribePhase.value
})

function handleSubmit(text: string) {
  engine.handleInput(text)
}

function handleExpand(text: string) {
  // Future: AI enriches the prompt
  // For now, just submit as-is
  engine.handleInput(text)
}

function handleAttach() {
  // Future: file/screenshot upload dialog
}

function handleOpenVibe() {
  if (!engine.plan.value) return

  const handoffId = storeVibeHandoff({
    source: 'architect',
    description: engine.description.value,
    plan: engine.plan.value,
    decisions: engine.decisions.value.map(decision => ({
      id: decision.id,
      label: decision.label,
      value: decision.value,
    })),
    projectId: typeof route.params.projectId === 'string' ? route.params.projectId : undefined,
  })

  const target = typeof route.params.projectId === 'string' && route.params.projectId
    ? `/app/projects/${route.params.projectId}/vibe`
    : '/app/vibe'

  router.push({
    path: target,
    query: {
      handoff: handoffId,
      autorun: '1',
      source: 'architect',
    },
  })
}

onMounted(() => engine.setup())
onUnmounted(() => engine.cleanup())
</script>

<template>
  <DashboardPanel :grow="true" :ui="{ body: '!p-0 !overflow-hidden' }">
    <template #body>
      <div class="flex flex-col overflow-hidden" style="height: calc(100vh - 72px)">
        <!-- Split view: Questions | Summary -->
        <div ref="containerRef" class="flex-1 flex min-h-0" :class="isDragging && 'select-none'">
          <!-- LEFT PANEL: Questions Flow -->
          <div
            class="flex flex-col min-w-0 min-h-0 overflow-hidden"
            :style="showSummary ? { width: splitPercent + '%' } : { width: '100%' }"
          >
            <!-- Describe phase: centered input -->
            <div v-if="isDescribePhase" class="flex-1 flex items-center justify-center px-8">
              <div class="w-full max-w-xl space-y-6">
                <div class="text-center space-y-3">
                  <div class="w-12 h-12 rounded-2xl bg-[var(--app-accent)]/10 flex items-center justify-center mx-auto">
                    <Icon name="i-lucide-pill" class="size-6 text-red-500" />
                  </div>
                  <h1 class="text-2xl font-bold text-app-foreground">
                    {{ engine.isInsideProject.value ? `Add to ${engine.currentProject.value?.name}` : 'What are we building?' }}
                  </h1>
                  <p class="text-sm text-app-muted">Describe your project and I'll help you plan it</p>
                </div>

                <!-- Description textarea -->
                <div class="relative">
                  <textarea
                    v-model="engine.description.value"
                    class="w-full bg-[color-mix(in_srgb,var(--app-background),white_6%)] rounded-xl px-4 py-3 text-sm text-app-foreground placeholder-app-muted/40 outline-none focus:ring-1 focus:ring-[var(--app-accent)]/30 resize-none transition-colors"
                    placeholder="e.g. A dashboard for managing team projects with real-time collaboration..."
                    rows="4"
                    @keydown.enter.meta.prevent="engine.submitDescription()"
                    @keydown.enter.ctrl.prevent="engine.submitDescription()"
                  />
                </div>

                <!-- Error message -->
                <div v-if="engine.errorMessage.value" class="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3">
                  <div class="flex items-start gap-2">
                    <Icon name="i-lucide-alert-circle" class="size-4 text-red-400 mt-0.5 shrink-0" />
                    <p class="text-sm text-red-300 flex-1">{{ engine.errorMessage.value }}</p>
                    <button class="text-red-400 hover:text-red-300" @click="engine.errorMessage.value = ''">
                      <Icon name="i-lucide-x" class="size-4" />
                    </button>
                  </div>
                </div>

                <button
                  class="w-full py-3 rounded-xl text-sm font-semibold transition-all duration-200"
                  :class="engine.description.value.trim()
                    ? 'bg-[var(--app-accent)] text-[var(--app-accent-foreground)] hover:opacity-90 cursor-pointer'
                    : 'bg-[color-mix(in_srgb,var(--app-background),white_6%)] text-app-muted/40 cursor-not-allowed'"
                  :disabled="!engine.description.value.trim()"
                  @click="engine.submitDescription()"
                >
                  Start Planning
                </button>
              </div>
            </div>

            <!-- Question flow (after describe) -->
            <template v-else-if="!engine.showProjectConfig.value">
              <ArchitectQuestionFlow
                :description="engine.description.value"
                :question-flow="engine.questionFlow.value"
                :is-thinking="engine.isThinking.value"
                :thinking-message="engine.thinkingMessage.value"
                :is-generating-questions="engine.isGeneratingQuestions.value"
                :is-generating-plan="engine.isGeneratingPlan.value"
                :is-clarifying="engine.isClarifying.value"
                :error-message="engine.errorMessage.value"
                :clarification-message="engine.clarificationMessage.value"
                :selected-values="activeSelectedValues"
                :show-other-input="engine.showOtherInput.value"
                :other-input-value="engine.otherInputValue.value"
                :has-questions="engine.questions.value.length > 0"
                @select="engine.selectOption"
                @confirm="engine.confirmSelection"
                @confirm-other="engine.confirmOther"
                @go-to="engine.goToQuestion"
                @cancel="engine.cancelRequest"
                @update:show-other-input="engine.showOtherInput.value = $event"
                @update:other-input-value="engine.otherInputValue.value = $event"
              />

              <!-- Bottom input (always visible during flow) -->
              <ArchitectBottomInput
                :placeholder="inputPlaceholder"
                :disabled="engine.isLoading.value"
                :show-expand="!engine.isDone.value"
                @submit="handleSubmit"
                @expand="handleExpand"
                @attach="handleAttach"
              />
            </template>

            <!-- Project config step -->
            <div v-else class="flex-1 overflow-y-auto p-8">
              <div class="max-w-xl mx-auto">
                <ArchitectProjectConfig
                  v-model:project-path="engine.projectPath.value"
                  v-model:init-git="engine.initGit.value"
                  :plan="engine.plan.value!"
                  :is-kicking="engine.isKicking.value"
                  :kickoff-progress="engine.kickoffProgress.value"
                  :progress-message="engine.progressMessage.value"
                  :is-construct-space="engine.isConstructSpace.value"
                  :detected-template="engine.detectedTemplate.value"
                  :detected-backend-template="engine.detectedBackendTemplate.value"
                  :raw-frontend-name="engine.rawFrontendName.value"
                  :raw-backend-name="engine.rawBackendName.value"
                  @create="engine.createProject"
                  @back="engine.showProjectConfig.value = false"
                  @browse="engine.browseProjectDir"
                />
              </div>
            </div>
          </div>

          <!-- RESIZE DIVIDER -->
          <div
            v-if="showSummary"
            class="w-1 shrink-0 cursor-col-resize group relative flex items-center justify-center hover:bg-[var(--app-accent)]/10 transition-colors"
            :class="isDragging && 'bg-[var(--app-accent)]/10'"
            @mousedown="onDividerMouseDown"
            @dblclick="onDividerDblClick"
          >
            <div
              class="w-px h-full group-hover:w-0.5 rounded-full transition-all"
              :class="isDragging ? 'w-0.5 bg-[var(--app-accent)]/40' : 'bg-[var(--app-border)]/20 group-hover:bg-[var(--app-accent)]/30'"
            />
          </div>

          <!-- RIGHT PANEL: Project Summary -->
          <div
            v-if="showSummary"
            class="min-h-0 overflow-hidden flex-1"
          >
            <ArchitectProjectSummary
              :description="engine.description.value"
              :decisions="engine.decisions.value"
              :plan="engine.plan.value"
              :is-done="engine.isDone.value"
              :is-inside-project="engine.isInsideProject.value"
              :is-kicking="engine.isKicking.value"
              :project-name="engine.currentProject.value?.name"
              @create-project="engine.showConfigStep"
              @save-feature="engine.saveFeaturePlan"
              @edit-choices="engine.goToQuestion"
              @open-vibe="handleOpenVibe"
            />
          </div>
        </div>
      </div>
    </template>
  </DashboardPanel>
</template>
