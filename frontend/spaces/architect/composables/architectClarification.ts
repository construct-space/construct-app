import type { InterviewQuestion } from '../data/architect-knowledge'

const QUESTION_START_RE = /^(why|how|what|when|where|who|whom|whose|can|could|should|would|do|does|did|is|are|am|will)\b/i
const CLARIFICATION_HINT_RE = /\b(why ask|already said|i said|you asked|don'?t ask|shouldn'?t ask|what do you mean|which one|difference between|same as)\b/i

export function isLikelyClarificationQuestion(text: string, currentQuestion?: InterviewQuestion | null): boolean {
  const normalized = text.trim()
  if (!normalized) return false

  const lower = normalized.toLowerCase()
  if (currentQuestion) {
    const optionValues = new Set(currentQuestion.options.map(option => option.value.trim().toLowerCase()))
    const optionLabels = new Set(currentQuestion.options.map(option => option.label.trim().toLowerCase()))
    if (optionValues.has(lower) || optionLabels.has(lower)) return false
  }

  if (normalized.includes('?')) return true
  if (QUESTION_START_RE.test(normalized)) return true
  if (CLARIFICATION_HINT_RE.test(lower)) return true

  return false
}
