/**
 * useArchitectEngine - Core logic for the Architect split-view UI
 *
 * Manages: AI calls, question flow, selection, navigation, and keyboard shortcuts.
 * Project creation logic lives in useArchitectProject.
 * JSON parsing lives in utils/json-parse.
 *
 * Post-interview flow: dispatches planning to the architect agent and
 * documentation directly to the docs agent so docs land in the project root.
 */
import { ref, computed, watch, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { useProjectStore } from '@/stores/project'
import { useToolbar } from '@/composables/useToolbar'
import { useOperator } from '@/operator'
import { useAIModel } from '@/composables/useAIModel'
import { useSpaces } from '@/composables/useSpaces'
import { isLikelyClarificationQuestion } from './architectClarification'
import { buildArchitectPlanInput } from './architectPlanInput'
import { buildArchitectPromptDescription, getArchitectScopeKey } from './architectEngineHelpers'
import { useArchitectProject } from './useArchitectProject'
import { parseJsonArray, parseJsonObject } from '@/utils/json-parse'
import type { InterviewQuestion } from '../data/architect-knowledge'
import type { ArchitectPlan } from '../utils/documentsGenerator'
import { buildArchitectDocsTask } from '../utils/docsTaskBuilder'
import type { StreamEvent } from '@/operator/types'

// ─── Types ───

export interface ArchitectDecision {
  id: string
  label: string
  value: string | string[]
  icon?: string
  status: 'done' | 'active' | 'pending'
}

export function useArchitectEngine() {
  const projectStore = useProjectStore()
  const { setPageItems, clearToolbar } = useToolbar()
  const { loadSpaces } = useSpaces()
  const { defaultModelId, init: initAIModel, resolveModelId } = useAIModel()
  const operator = useOperator()

  let abortController: AbortController | null = null
  let activeStreamCleanup: (() => void) | null = null

  // ─── State ───

  const route = useRoute()
  const currentProject = computed(() => projectStore.currentProject ?? null)
  // Only treat as "inside project" when accessed via a project-scoped route
  // (e.g. /app/projects/:projectId/architect), not the top-level /app/architect
  const isInsideProject = computed(() => !!currentProject.value && !!route.params.projectId)
  const selectedModel = computed(() => resolveModelId(defaultModelId.value, { allowAuto: false }))
  const scopeKey = computed(() => getArchitectScopeKey(route.params.projectId))

  // Core flow state
  const description = ref('')
  const questions = ref<InterviewQuestion[]>([])
  const answers = ref<Record<string, string | string[]>>({})
  const plan = ref<ArchitectPlan | null>(null)

  // Loading
  const isGeneratingQuestions = ref(false)
  const isGeneratingPlan = ref(false)
  const isGeneratingDocs = ref(false)
  const isClarifying = ref(false)
  const isThinking = ref(false)
  const thinkingMessage = ref('')
  const errorMessage = ref('')
  const clarificationMessage = ref('')
  const docsStreamContent = ref('')

  // Selection state for the active question
  const activeQuestionIndex = ref(-1) // -1 = describe step
  const selectedSingle = ref<string | null>(null)
  const selectedMulti = ref<string[]>([])
  const showOtherInput = ref(false)
  const otherInputValue = ref('')

  // ─── Project (delegated) ───

  const project = useArchitectProject({
    plan,
    answers,
    currentProject: currentProject as any,
    isInsideProject,
    onReset: handleReset,
    generateDocs: (projectPath: string) => generateDocs(projectPath),
  })

  function clearActiveStreamCleanup() {
    const cleanup = activeStreamCleanup
    activeStreamCleanup = null
    cleanup?.()
  }

  function abortActiveRequest() {
    abortController?.abort()
    abortController = null
    clearActiveStreamCleanup()
  }

  function resetLoadingState() {
    isGeneratingQuestions.value = false
    isGeneratingPlan.value = false
    isGeneratingDocs.value = false
    isClarifying.value = false
    isThinking.value = false
    thinkingMessage.value = ''
  }

  function getPromptDescription(input = description.value): string {
    return buildArchitectPromptDescription(
      input,
      isInsideProject.value && currentProject.value ? currentProject.value : null,
    )
  }

  async function dispatchAgentTask(
    agentId: string,
    task: string,
    signal: AbortSignal | undefined,
    onChunk: (chunk: StreamEvent) => void,
    options?: {
      projectPath?: string
      projectName?: string
    },
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('Cancelled'))
        return
      }

      let settled = false
      let localCleanup: (() => void) | null = null

      const finish = (callback: () => void) => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', handleAbort)
        if (localCleanup) {
          if (activeStreamCleanup === localCleanup) activeStreamCleanup = null
          localCleanup()
          localCleanup = null
        }
        callback()
      }

      const handleAbort = () => {
        finish(() => reject(new Error('Cancelled')))
      }

      signal?.addEventListener('abort', handleAbort, { once: true })

      operator.dispatchStream(
        agentId,
        task,
        (chunk: StreamEvent) => {
          if (signal?.aborted) return
          onChunk(chunk)
        },
        () => finish(resolve),
        (err: string) => finish(() => reject(new Error(err))),
        selectedModel.value,
        options,
      )
        .then((cleanup) => {
          if (settled) {
            cleanup()
            return
          }
          localCleanup = cleanup
          activeStreamCleanup = cleanup
          if (signal?.aborted) handleAbort()
        })
        .catch((err) => {
          finish(() => reject(err instanceof Error ? err : new Error(String(err))))
        })
    })
  }

  // ─── AI Chat ───
  // Dispatches to Operator's architect agent. Operator handles system prompts,
  // LLM calls, and tool execution. Frontend just sends the task and gets back content.

  async function architectCall(
    mode: 'questions' | 'plan' | 'clarify' | 'review',
    _model: string,
    signal?: AbortSignal,
  _onStatus?: (status: string) => void,
    options?: {
      clarification?: string
      currentQuestion?: InterviewQuestion | null
      planJson?: string
    },
  ): Promise<string> {
    if (!operator.isTauri.value) {
      throw new Error('AI requires the Construct desktop app.')
    }
    if (signal?.aborted) throw new Error('Cancelled')

    // Build the task prompt based on mode
    let task: string
    const scopedDescription = getPromptDescription()

    if (mode === 'questions') {
      task = [
        'Generate interview questions for this project description.',
        'Output ONLY a JSON array of questions, no other text.',
        'Each question: {id, label, description, type: "single"|"multi", options: [{value, label, icon?, description?}]}',
        'If the description sounds like a Construct space/plugin, ask only the space-specific questions needed for that workflow.',
        `\nDescription: ${scopedDescription}`,
      ].join('\n')
    } else if (mode === 'plan') {
      const planInput = buildArchitectPlanInput(scopedDescription, questions.value, answers.value)
      task = [
        'Generate a project plan based on these decisions.',
        'Output ONLY a JSON object.',
        'For regular projects use: {name, description, stack: {layer: tech}, features: [], files: [{path, description}], phases: [{name, tasks: []}]}',
        'For Construct spaces use: {name, description, type: "construct-space", spaceId: "my-space", spaceIcon?: "i-lucide-puzzle", spaceScope?: "project"|"app"|"both", decisions, stack, features, files, phases}',
        `\nProject: ${planInput.description}`,
        `\nDecisions:\n${planInput.answers}`,
      ].join('\n')
    } else if (mode === 'clarify') {
      task = [
        'The user is asking for clarification about a question during project planning.',
        `Question: ${JSON.stringify(options?.currentQuestion)}`,
        `User asks: ${options?.clarification}`,
        'Output a JSON object: {answer: "your helpful clarification", keepQuestion: true}',
      ].join('\n')
    } else {
      // review
      task = [
        'Review this project plan for issues.',
        'Output a JSON object: {issues: [{severity, area, problem, suggestion}]}',
        `\nPlan:\n${options?.planJson}`,
      ].join('\n')
    }

    if (signal?.aborted) throw new Error('Cancelled')

    // Use streaming dispatch to avoid blocking the UI thread
    let content = ''
    await dispatchAgentTask('architect', task, signal, (chunk: StreamEvent) => {
      if (chunk.content) content += chunk.content
    })

    if (signal?.aborted) throw new Error('Cancelled')
    if (!content.trim()) throw new Error('Empty response from AI. Check your AI provider settings.')
    return content
  }

  // ─── Computed ───

  const isDone = computed(() => plan.value !== null)
  const isLoading = computed(() => isGeneratingQuestions.value || isGeneratingPlan.value || isGeneratingDocs.value || isClarifying.value)

  const currentQuestion = computed(() => {
    if (activeQuestionIndex.value < 0 || activeQuestionIndex.value >= questions.value.length) return null
    return questions.value[activeQuestionIndex.value] || null
  })

  const questionFlow = computed(() => {
    return questions.value.map((q, i) => {
      const isAnswered = !!answers.value[q.id]
      const isCurrent = i === activeQuestionIndex.value && !isDone.value
      return {
        ...q,
        index: i,
        answered: isAnswered,
        active: isCurrent,
        upcoming: !isAnswered && !isCurrent,
        answerLabel: isAnswered ? getAnswerLabel(q.id) : null,
      }
    })
  })

  const decisions = computed((): ArchitectDecision[] => {
    return questions.value.map((q, i) => {
      const val = answers.value[q.id]
      const isAnswered = !!val
      const isCurrent = i === activeQuestionIndex.value && !isDone.value

      return {
        id: q.id,
        label: q.id.toUpperCase().replace(/([A-Z])/g, ' $1').trim(),
        value: val || '',
        icon: q.options[0]?.icon,
        status: isAnswered ? 'done' : isCurrent ? 'active' : 'pending',
      }
    })
  })

  const answeredCount = computed(() => Object.keys(answers.value).length)
  const totalQuestions = computed(() => questions.value.length)

  // ─── Selection ───

  watch(activeQuestionIndex, () => {
    selectedSingle.value = null
    selectedMulti.value = []
    showOtherInput.value = false
    otherInputValue.value = ''
    clarificationMessage.value = ''
  })

  function selectOption(value: string) {
    if (!currentQuestion.value) return

    if (value === '__other__') {
      showOtherInput.value = true
      selectedSingle.value = null
      return
    }

    showOtherInput.value = false
    otherInputValue.value = ''

    if (currentQuestion.value.type === 'multi') {
      if (value === 'none') {
        selectedMulti.value = ['none']
      } else {
        const idx = selectedMulti.value.indexOf(value)
        if (idx === -1) {
          selectedMulti.value = [...selectedMulti.value.filter(v => v !== 'none'), value]
        } else {
          selectedMulti.value = selectedMulti.value.filter(v => v !== value)
        }
      }
    } else {
      selectedSingle.value = value
      setTimeout(confirmSelection, 200)
    }
  }

  function confirmSelection() {
    if (!currentQuestion.value) return

    const qId = currentQuestion.value.id
    const value = currentQuestion.value.type === 'multi'
      ? [...selectedMulti.value]
      : selectedSingle.value!

    if (!value || (Array.isArray(value) && value.length === 0)) return

    answers.value[qId] = value
    clarificationMessage.value = ''
    advanceToNext()
  }

  function confirmOther() {
    if (!currentQuestion.value || !otherInputValue.value.trim()) return

    const qId = currentQuestion.value.id
    const customValue = otherInputValue.value.trim()

    if (currentQuestion.value.type === 'multi') {
      selectedMulti.value = [...selectedMulti.value.filter(v => v !== 'none'), customValue]
      showOtherInput.value = false
      otherInputValue.value = ''
    } else {
      answers.value[qId] = customValue
      clarificationMessage.value = ''
      showOtherInput.value = false
      otherInputValue.value = ''
      advanceToNext()
    }
  }

  function advanceToNext() {
    if (activeQuestionIndex.value < questions.value.length - 1) {
      activeQuestionIndex.value++
    } else {
      void generatePlan()
    }
  }

  // ─── Navigation ───

  function goToQuestion(index: number) {
    if (index < 0 || index >= questions.value.length) return

    for (let i = index; i < questions.value.length; i++) {
      const q = questions.value[i]
      if (q) {
        const { [q.id]: _removed, ...rest } = answers.value
        answers.value = rest
      }
    }
    plan.value = null
    activeQuestionIndex.value = index

    const q = questions.value[index]
    if (q) {
      const prev = answers.value[q.id]
      if (Array.isArray(prev)) {
        selectedMulti.value = [...prev]
        selectedSingle.value = null
      } else if (prev) {
        selectedSingle.value = prev as string
        selectedMulti.value = []
      }
    }
  }

  function getAnswerLabel(questionId: string): string {
    const val = answers.value[questionId]
    if (!val) return ''
    const q = questions.value.find(q => q.id === questionId)
    if (!q) return Array.isArray(val) ? val.join(', ') : String(val)

    if (Array.isArray(val)) {
      return val.map(v => q.options.find(o => o.value === v)?.label || v).join(', ')
    }
    return q.options.find(o => o.value === val)?.label || String(val)
  }

  // ─── Thinking Message Rotation ───

  function rotateMessages(messages: string[], intervalMs: number): () => void {
    let i = 0
    thinkingMessage.value = messages[0]
    const timer = setInterval(() => {
      i = (i + 1) % messages.length
      thinkingMessage.value = messages[i]
    }, intervalMs)
    return () => clearInterval(timer)
  }

  // ─── AI Call 1: Generate Questions ───

  async function submitDescription(desc?: string) {
    const text = desc || description.value.trim()
    if (!text) return
    description.value = text.trim()

    abortActiveRequest()
    const controller = new AbortController()
    abortController = controller

    isGeneratingQuestions.value = true
    isThinking.value = true
    errorMessage.value = ''
    clarificationMessage.value = ''

    const stopRotation = rotateMessages([
      'Reading your description...',
      'Understanding the scope...',
      'Thinking about what to ask...',
      'Identifying key decisions...',
      'Preparing your interview...',
    ], 2200)

    await nextTick()

    try {
      const content = await architectCall(
        'questions',
        selectedModel.value,
        controller.signal,
        (status) => { thinkingMessage.value = status },
      )

      const parsed = parseJsonArray<InterviewQuestion>(content)
      if (parsed.length > 0) {
        questions.value = parsed
        activeQuestionIndex.value = 0
      } else {
        errorMessage.value = 'Failed to generate questions. The AI response was not in the expected format.'
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to connect to AI'
      if (msg !== 'Cancelled') errorMessage.value = msg
    } finally {
      stopRotation()
      isGeneratingQuestions.value = false
      isThinking.value = false
      if (abortController === controller) abortController = null
    }
  }

  // ─── AI Call 2: Generate Plan (metadata) ───

  async function generatePlan() {
    abortActiveRequest()
    const controller = new AbortController()
    abortController = controller

    isGeneratingPlan.value = true
    isThinking.value = true
    errorMessage.value = ''
    clarificationMessage.value = ''

    const stopRotation = rotateMessages([
      'Analyzing your choices...',
      'Designing the architecture...',
      'Planning the implementation...',
      'Writing the blueprint...',
      'Finalizing the plan...',
    ], 2500)

    await nextTick()

    try {
      const content = await architectCall(
        'plan',
        selectedModel.value,
        controller.signal,
        (status) => { thinkingMessage.value = status },
      )

      const parsed = parseJsonObject(content)
      if (parsed) {
        plan.value = parsed as unknown as ArchitectPlan
      } else {
        errorMessage.value = 'Failed to generate plan. The AI response was not in the expected format.'
        activeQuestionIndex.value = questions.value.length - 1
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to connect to AI'
      if (msg !== 'Cancelled') errorMessage.value = msg
    } finally {
      stopRotation()
      isGeneratingPlan.value = false
      isThinking.value = false
      if (abortController === controller) abortController = null
    }
  }

  // ─── AI Call 3: Generate Docs (streamed directly to docs agent) ───

  /**
   * Dispatch full interview context directly to the docs agent so docs are
   * written to the selected project root via write_file. Streams progress to the UI.
   */
  async function generateDocs(projectPath: string) {
    if (!plan.value) return

    abortActiveRequest()
    const controller = new AbortController()
    abortController = controller
    isGeneratingDocs.value = true
    isThinking.value = true
    docsStreamContent.value = ''
    errorMessage.value = ''

    const stopRotation = rotateMessages([
      'Writing project documentation...',
      'Generating product requirements...',
      'Designing technical architecture...',
      'Building setup guide...',
      'Creating AI context doc...',
      'Finalizing documentation...',
    ], 3000)

    try {
      const planInput = buildArchitectPlanInput(getPromptDescription(), questions.value, answers.value)
      const interviewAnswers = Object.entries(planInput.answers)
        .map(([key, value]) => `- ${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
        .join('\n') || '- No additional structured answers recorded.'
      const task = buildArchitectDocsTask({
        plan: plan.value,
        projectPath,
        interviewDescription: planInput.description,
        interviewAnswers,
      })

      await dispatchAgentTask(
        'docs',
        task,
        controller.signal,
        (chunk: StreamEvent) => {
          if (chunk.content) {
            docsStreamContent.value += chunk.content
            // Update thinking message based on content
            if (chunk.content.includes('01-') || chunk.content.includes('product-requirements')) {
              thinkingMessage.value = 'Writing product requirements...'
            } else if (chunk.content.includes('02-') || chunk.content.includes('technical-architecture')) {
              thinkingMessage.value = 'Writing technical architecture...'
            } else if (chunk.content.includes('03-') || chunk.content.includes('data-models')) {
              thinkingMessage.value = 'Writing data models...'
            } else if (chunk.content.includes('04-') || chunk.content.includes('ui-specification')) {
              thinkingMessage.value = 'Writing UI specification...'
            } else if (chunk.content.includes('05-') || chunk.content.includes('backend-endpoints')) {
              thinkingMessage.value = 'Writing backend endpoints...'
            } else if (chunk.content.includes('06-') || chunk.content.includes('backend-modules')) {
              thinkingMessage.value = 'Writing backend modules...'
            } else if (chunk.content.includes('07-') || chunk.content.includes('roadmap')) {
              thinkingMessage.value = 'Writing roadmap...'
            } else if (chunk.content.includes('08-') || chunk.content.includes('setup-guide')) {
              thinkingMessage.value = 'Writing setup guide...'
            } else if (chunk.content.includes('09-') || chunk.content.includes('ai-context')) {
              thinkingMessage.value = 'Writing AI context doc...'
            } else if (chunk.content.includes('10-') || chunk.content.includes('game-design-system')) {
              thinkingMessage.value = 'Writing game design doc...'
            } else if (chunk.content.includes('README')) {
              thinkingMessage.value = 'Writing README...'
            }
          }
        },
        {
          projectPath,
          projectName: plan.value.name,
        },
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to generate documentation'
      if (msg !== 'Cancelled') errorMessage.value = msg
    } finally {
      stopRotation()
      isGeneratingDocs.value = false
      isThinking.value = false
      if (abortController === controller) abortController = null
    }
  }

  // ─── Reset ───

  function handleReset() {
    abortActiveRequest()
    resetLoadingState()
    description.value = ''
    questions.value = []
    answers.value = {}
    plan.value = null
    activeQuestionIndex.value = -1
    selectedSingle.value = null
    selectedMulti.value = []
    showOtherInput.value = false
    otherInputValue.value = ''
    errorMessage.value = ''
    clarificationMessage.value = ''
    docsStreamContent.value = ''
    project.resetProjectState()
  }

  function cancelRequest() {
    abortActiveRequest()
    resetLoadingState()
  }

  async function requestClarification(text: string) {
    if (!currentQuestion.value) return
    abortActiveRequest()
    const controller = new AbortController()
    abortController = controller

    isClarifying.value = true
    isThinking.value = true
    errorMessage.value = ''
    thinkingMessage.value = 'Clarifying the current question...'

    try {
      const content = await architectCall(
        'clarify',
        selectedModel.value,
        controller.signal,
        (status) => { thinkingMessage.value = status },
        {
          clarification: text,
          currentQuestion: currentQuestion.value,
        },
      )

      const parsed = parseJsonObject(content) as { answer?: string, keepQuestion?: boolean } | null
      clarificationMessage.value = typeof parsed?.answer === 'string' && parsed.answer.trim()
        ? parsed.answer.trim()
        : content.trim()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to clarify the current question'
      if (msg !== 'Cancelled') errorMessage.value = msg
    } finally {
      isClarifying.value = false
      isThinking.value = false
      if (abortController === controller) abortController = null
    }
  }

  // ─── Input handling (bottom bar) ───

  function handleInput(text: string) {
    if (activeQuestionIndex.value < 0) {
      submitDescription(text)
    } else {
      if (!currentQuestion.value) return
      if (isLikelyClarificationQuestion(text, currentQuestion.value)) {
        void requestClarification(text)
        return
      }
      const qId = currentQuestion.value.id
      answers.value[qId] = text.trim()
      clarificationMessage.value = ''
      advanceToNext()
    }
  }

  // ─── Keyboard Shortcuts ───

  function handleKeydown(e: KeyboardEvent) {
    if (activeQuestionIndex.value < 0 || !currentQuestion.value) return
    if (isDone.value || isLoading.value) return

    if (showOtherInput.value) {
      if (e.key === 'Escape') {
        e.preventDefault()
        showOtherInput.value = false
        otherInputValue.value = ''
      }
      if (e.key === 'Enter' && otherInputValue.value.trim()) {
        e.preventDefault()
        confirmOther()
      }
      return
    }

    const num = parseInt(e.key)
    if (num >= 1 && num <= currentQuestion.value.options.length) {
      e.preventDefault()
      selectOption(currentQuestion.value.options[num - 1]!.value)
    }

    if (e.key === 'Enter' && currentQuestion.value.type === 'multi' && selectedMulti.value.length > 0) {
      e.preventDefault()
      confirmSelection()
    }

    if (e.key === 'Escape' || (e.key === 'Backspace' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement))) {
      e.preventDefault()
      if (activeQuestionIndex.value > 0) {
        goToQuestion(activeQuestionIndex.value - 1)
      } else {
        handleReset()
      }
    }
  }

  // ─── Lifecycle ───

  function setup() {
    initAIModel()
    loadSpaces()
    window.addEventListener('keydown', handleKeydown)
    setPageItems([{
      id: 'architect-reset',
      icon: 'i-lucide-refresh-cw',
      label: 'Start Over',
      type: 'action',
      category: 'space',
      onClick: handleReset,
    }])
  }

  function cleanup() {
    window.removeEventListener('keydown', handleKeydown)
    clearToolbar()
    abortActiveRequest()
    resetLoadingState()
  }

  watch(scopeKey, (next, prev) => {
    if (prev && next !== prev) {
      handleReset()
    }
  })

  return {
    // State
    description,
    questions,
    answers,
    plan,
    activeQuestionIndex,
    selectedSingle,
    selectedMulti,
    showOtherInput,
    otherInputValue,
    errorMessage,
    isGeneratingQuestions,
    isGeneratingPlan,
    isGeneratingDocs,
    isClarifying,
    isThinking,
    thinkingMessage,
    clarificationMessage,
    docsStreamContent,
    isLoading,
    isDone,
    currentQuestion,
    isInsideProject,
    currentProject,

    // Flow
    questionFlow,
    decisions,
    answeredCount,
    totalQuestions,

    // Project (re-exported from useArchitectProject)
    showProjectConfig: project.showProjectConfig,
    projectPath: project.projectPath,
    initGit: project.initGit,
    isKicking: project.isKicking,
    kickoffProgress: project.kickoffProgress,
    progressMessage: project.progressMessage,
    isConstructSpace: project.isConstructSpace,
    detectedTemplate: project.detectedTemplate,
    detectedBackendTemplate: project.detectedBackendTemplate,
    rawFrontendName: project.rawFrontendName,
    rawBackendName: project.rawBackendName,

    // Actions
    submitDescription,
    selectOption,
    confirmSelection,
    confirmOther,
    goToQuestion,
    getAnswerLabel,
    handleReset,
    cancelRequest,
    handleInput,
    generateDocs,
    showConfigStep: project.showConfigStep,
    browseProjectDir: project.browseProjectDir,
    createProject: project.createProject,
    saveFeaturePlan: project.saveFeaturePlan,

    // Lifecycle
    setup,
    cleanup,
  }
}
