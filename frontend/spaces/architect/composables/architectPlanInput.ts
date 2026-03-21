import type { InterviewQuestion } from '../data/architect-knowledge'

export interface ArchitectPlanInput {
  description: string
  answers: Record<string, string | string[]>
}

export function buildArchitectPlanInput(
  description: string,
  questions: InterviewQuestion[],
  answers: Record<string, string | string[]>,
): ArchitectPlanInput {
  const sanitizedAnswers: Record<string, string | string[]> = {}
  const supplementalRequirements: string[] = []
  const questionMap = new Map(questions.map(question => [question.id, question]))

  for (const [questionId, rawAnswer] of Object.entries(answers)) {
    const question = questionMap.get(questionId)
    if (!question) {
      sanitizedAnswers[questionId] = rawAnswer
      continue
    }

    if (Array.isArray(rawAnswer)) {
      if (rawAnswer.length > 0) sanitizedAnswers[questionId] = rawAnswer
      continue
    }

    const answer = rawAnswer.trim()
    if (!answer) continue

    if (question.type === 'single' && shouldTreatAsSupplementalRequirement(question, answer)) {
      supplementalRequirements.push(answer)
      continue
    }

    sanitizedAnswers[questionId] = answer
  }

  let normalizedDescription = description.trim()
  if (supplementalRequirements.length > 0) {
    normalizedDescription += `\n\nAdditional user requirements:\n${supplementalRequirements.map(note => `- ${note}`).join('\n')}`
  }

  return {
    description: normalizedDescription,
    answers: sanitizedAnswers,
  }
}

export function shouldTreatAsSupplementalRequirement(question: InterviewQuestion, answer: string): boolean {
  const normalizedAnswer = answer.trim().toLowerCase()
  if (!normalizedAnswer) return false

  const optionValues = new Set(question.options.map(option => option.value.trim().toLowerCase()))
  if (optionValues.has(normalizedAnswer)) return false

  const optionLabels = new Set(question.options.map(option => option.label.trim().toLowerCase()))
  if (optionLabels.has(normalizedAnswer)) return false

  const wordCount = normalizedAnswer.split(/\s+/).filter(Boolean).length
  const supplementalHints = /designer|designger|devops|product owner|tasks?|milestones?|deadline|deliverables?|document|docs?|requirements?|getx/i

  return wordCount >= 8 || normalizedAnswer.length >= 60 || supplementalHints.test(answer)
}
