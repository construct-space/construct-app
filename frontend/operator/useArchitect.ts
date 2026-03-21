/**
 * useArchitect — Project planning flow
 *
 * Dispatches to the architect agent in Operator.
 * Frontend handles: description input → question flow UI → plan display.
 * Operator handles: LLM calls, system prompts, tool execution.
 *
 * The architect agent's system prompt tells it to output structured JSON.
 * Frontend parses that JSON for the UI (questions, plan).
 */

import { ref, computed, watch, nextTick } from 'vue'
import { useOperator } from './client'
import type { StreamEvent } from './types'

// ─── Types ───

export interface InterviewQuestion {
  id: string
  label: string
  description?: string
  type: 'single' | 'multi'
  options: { value: string; label: string; icon?: string; description?: string }[]
}

export interface ArchitectPlan {
  name: string
  description: string
  stack: Record<string, string>
  features: string[]
  files: { path: string; description: string }[]
  phases: { name: string; tasks: string[] }[]
}

export interface ArchitectDecision {
  id: string
  label: string
  value: string | string[]
  status: 'done' | 'active' | 'pending'
}

export function useArchitect() {
  const operator = useOperator()

  // Core flow state
  const description = ref('')
  const questions = ref<InterviewQuestion[]>([])
  const answers = ref<Record<string, string | string[]>>({})
  const plan = ref<ArchitectPlan | null>(null)

  // Loading
  const isGeneratingQuestions = ref(false)
  const isGeneratingPlan = ref(false)
  const isThinking = ref(false)
  const thinkingMessage = ref('')
  const errorMessage = ref('')

  // Selection state
  const activeQuestionIndex = ref(-1) // -1 = describe step
  const selectedSingle = ref<string | null>(null)
  const selectedMulti = ref<string[]>([])

  // ─── Computed ───

  const isDone = computed(() => plan.value !== null)
  const isLoading = computed(() => isGeneratingQuestions.value || isGeneratingPlan.value)
  const currentQuestion = computed(() => {
    if (activeQuestionIndex.value < 0 || activeQuestionIndex.value >= questions.value.length) return null
    return questions.value[activeQuestionIndex.value] || null
  })
  const answeredCount = computed(() => Object.keys(answers.value).length)
  const totalQuestions = computed(() => questions.value.length)

  const decisions = computed((): ArchitectDecision[] => {
    return questions.value.map((q, i) => {
      const val = answers.value[q.id]
      const isAnswered = !!val
      const isCurrent = i === activeQuestionIndex.value && !isDone.value
      return {
        id: q.id,
        label: q.id.toUpperCase().replace(/([A-Z])/g, ' $1').trim(),
        value: val || '',
        status: isAnswered ? 'done' : isCurrent ? 'active' : 'pending',
      }
    })
  })

  // Reset selection when question changes
  watch(activeQuestionIndex, () => {
    selectedSingle.value = null
    selectedMulti.value = []
  })

  // ─── AI Calls via Operator ───

  async function submitDescription(desc?: string) {
    const text = desc || description.value.trim()
    if (!text) return
    description.value = text

    isGeneratingQuestions.value = true
    isThinking.value = true
    thinkingMessage.value = 'Analyzing your description...'
    errorMessage.value = ''

    await nextTick()

    try {
      // Dispatch to architect agent via streaming (non-blocking)
      let content = ''
      await new Promise<void>((resolve, reject) => {
        operator.dispatchStream(
          'architect',
          [
            'Generate interview questions for this project description.',
            'Output ONLY a JSON array of questions, no other text.',
            'Each question: {id, label, description, type: "single"|"multi", options: [{value, label, icon?, description?}]}',
            `\nDescription: ${text}`,
          ].join('\n'),
          (chunk: StreamEvent) => { if (chunk.content) content += chunk.content },
          () => resolve(),
          (err: string) => reject(new Error(err)),
        ).catch(reject)
      })

      const parsed = tryParseJsonArray<InterviewQuestion>(content)
      if (parsed.length > 0) {
        questions.value = parsed
        activeQuestionIndex.value = 0
      } else {
        errorMessage.value = 'Failed to generate questions. Try rephrasing your description.'
      }
    } catch (e) {
      errorMessage.value = e instanceof Error ? e.message : 'Failed to connect to AI'
    } finally {
      isGeneratingQuestions.value = false
      isThinking.value = false
    }
  }

  async function generatePlan() {
    isGeneratingPlan.value = true
    isThinking.value = true
    thinkingMessage.value = 'Designing the architecture...'
    errorMessage.value = ''

    await nextTick()

    try {
      const answersText = questions.value
        .map(q => `${q.label}: ${Array.isArray(answers.value[q.id]) ? (answers.value[q.id] as string[]).join(', ') : answers.value[q.id]}`)
        .join('\n')

      let planContent = ''
      await new Promise<void>((resolve, reject) => {
        operator.dispatchStream(
          'architect',
          [
            'Generate a project plan based on these decisions.',
            'Output ONLY a JSON object with: {name, description, stack: {layer: tech}, features: [], files: [{path, description}], phases: [{name, tasks: []}]}',
            `\nProject: ${description.value}`,
            `\nDecisions:\n${answersText}`,
          ].join('\n'),
          (chunk: StreamEvent) => { if (chunk.content) planContent += chunk.content },
          () => resolve(),
          (err: string) => reject(new Error(err)),
        ).catch(reject)
      })

      const parsed = tryParseJsonObject<ArchitectPlan>(planContent)
      if (parsed) {
        plan.value = parsed
      } else {
        errorMessage.value = 'Failed to generate plan.'
        activeQuestionIndex.value = questions.value.length - 1
      }
    } catch (e) {
      errorMessage.value = e instanceof Error ? e.message : 'Failed to connect to AI'
    } finally {
      isGeneratingPlan.value = false
      isThinking.value = false
    }
  }

  // ─── Selection ───

  function selectOption(value: string) {
    if (!currentQuestion.value) return

    if (currentQuestion.value.type === 'multi') {
      const idx = selectedMulti.value.indexOf(value)
      if (idx === -1) {
        selectedMulti.value = [...selectedMulti.value.filter(v => v !== 'none'), value]
      } else {
        selectedMulti.value = selectedMulti.value.filter(v => v !== value)
      }
    } else {
      selectedSingle.value = value
      setTimeout(confirmSelection, 200)
    }
  }

  function confirmSelection() {
    if (!currentQuestion.value) return
    const qId = currentQuestion.value.id
    const value = currentQuestion.value.type === 'multi' ? [...selectedMulti.value] : selectedSingle.value!
    if (!value || (Array.isArray(value) && value.length === 0)) return

    answers.value[qId] = value
    advanceToNext()
  }

  function advanceToNext() {
    if (activeQuestionIndex.value < questions.value.length - 1) {
      activeQuestionIndex.value++
    } else {
      void generatePlan()
    }
  }

  function goToQuestion(index: number) {
    if (index < 0 || index >= questions.value.length) return
    for (let i = index; i < questions.value.length; i++) {
      const q = questions.value[i]
      if (q) delete answers.value[q.id]
    }
    plan.value = null
    activeQuestionIndex.value = index
  }

  // ─── Reset ───

  function reset() {
    description.value = ''
    questions.value = []
    answers.value = {}
    plan.value = null
    activeQuestionIndex.value = -1
    selectedSingle.value = null
    selectedMulti.value = []
    errorMessage.value = ''
  }

  // ─── JSON Parsing Helpers ───

  function tryParseJsonArray<T>(content: string): T[] {
    // Try direct parse
    try {
      const parsed = JSON.parse(content)
      if (Array.isArray(parsed)) return parsed
    } catch { /* continue */ }
    // Try extracting from markdown code block
    const match = content.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (match?.[1]) {
      try {
        const parsed = JSON.parse(match[1])
        if (Array.isArray(parsed)) return parsed
      } catch { /* continue */ }
    }
    // Try finding array in content
    const arrayMatch = content.match(/\[[\s\S]*\]/)
    if (arrayMatch) {
      try { return JSON.parse(arrayMatch[0]) } catch { /* ignore */ }
    }
    return []
  }

  function tryParseJsonObject<T>(content: string): T | null {
    try {
      const parsed = JSON.parse(content)
      if (typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
    } catch { /* continue */ }
    const match = content.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (match?.[1]) {
      try {
        const parsed = JSON.parse(match[1])
        if (typeof parsed === 'object') return parsed
      } catch { /* continue */ }
    }
    const objMatch = content.match(/\{[\s\S]*\}/)
    if (objMatch) {
      try { return JSON.parse(objMatch[0]) } catch { /* ignore */ }
    }
    return null
  }

  return {
    // State
    description,
    questions,
    answers,
    plan,
    activeQuestionIndex,
    selectedSingle,
    selectedMulti,
    errorMessage,
    isGeneratingQuestions,
    isGeneratingPlan,
    isThinking,
    thinkingMessage,
    isLoading,
    isDone,
    currentQuestion,
    decisions,
    answeredCount,
    totalQuestions,

    // Actions
    submitDescription,
    selectOption,
    confirmSelection,
    goToQuestion,
    reset,
  }
}
