import type { ResponseBlock, CustomBlock } from '@/assistant/blocks'
import { architectEnvelopeSchema } from './schema'

function textBlock(content: string): ResponseBlock {
  return { type: 'text', content }
}

function customBlock(type: `${string}:${string}`, data: Record<string, unknown>): ResponseBlock {
  return { type, data } satisfies CustomBlock
}

/**
 * Try to extract a JSON object from raw LLM output.
 * Handles: raw JSON string, markdown-wrapped ```json blocks, or already-parsed objects.
 */
function extractJSON(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === 'object' && raw !== null) return raw as Record<string, unknown>
  if (typeof raw !== 'string') return null

  const str = (raw as string).trim()

  // Try markdown code block
  const codeBlock = str.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlock) {
    try { return JSON.parse(codeBlock[1]) } catch { /* fall through */ }
  }

  // Try raw JSON
  if (str.startsWith('{') || str.startsWith('[')) {
    try { return JSON.parse(str) } catch { /* fall through */ }
  }

  return null
}

/**
 * Normalize a single question from the LLM's format to our format.
 * Handles both `options` (architect.v1) and `choices` (legacy prompt format).
 */
/**
 * Infer whether a question is single or multi-select.
 * The LLM often sends "single" even when multi makes sense.
 * Heuristic: if 5+ options and the question asks "what to include/which features/what sections",
 * it's almost certainly multi-select.
 */
function inferQuestionType(q: Record<string, unknown>, options: Array<unknown>): 'single' | 'multi' {
  if ((q.type as string) === 'multi') return 'multi'
  if ((q.type as string) === 'single' && options.length <= 4) return 'single'

  // Auto-detect multi from question text + option count
  const text = ((q.question as string) || (q.text as string) || (q.label as string) || '').toLowerCase()
  const multiKeywords = ['include', 'features', 'sections', 'which of', 'select', 'what should', 'what pages', 'what components']
  if (options.length >= 5 && multiKeywords.some(kw => text.includes(kw))) {
    return 'multi'
  }

  return (q.type as string) === 'multi' ? 'multi' : 'single'
}

let questionCounter = 0
function normalizeQuestion(q: Record<string, unknown>) {
  const options = (q.options || q.choices || []) as Array<unknown>
  questionCounter++
  return {
    id: String(q.id || `q-${questionCounter}`),
    question: (q.question as string) || (q.label as string) || '',
    type: inferQuestionType(q, options),
    options: options.map((opt: unknown) => {
      if (typeof opt === 'string') return { value: opt, label: opt }
      const o = opt as Record<string, unknown>
      return { value: (o.value as string) || (o.label as string) || '', label: (o.label as string) || (o.value as string) || '', description: o.description as string | undefined }
    }),
  }
}

export function normalizeArchitectOutput(raw: unknown): ResponseBlock[] {
  const obj = extractJSON(raw)

  // If we couldn't parse JSON at all, return as text
  if (!obj) {
    return [textBlock(typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2))]
  }

  // Try strict architect.v1 envelope first
  const parsed = architectEnvelopeSchema.safeParse(obj)
  if (parsed.success) {
    const envelope = parsed.data
    switch (envelope.state) {
      case 'questions':
        return [customBlock('architect:questions', { questions: envelope.questions })]
      case 'plan':
        return [customBlock('architect:plan', {
          title: envelope.title, summary: envelope.summary,
          decisions: envelope.decisions, docs: envelope.docs,
          nextActions: envelope.next_actions,
        })]
      case 'progress':
        return [customBlock('architect:progress', { message: envelope.message })]
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // @deprecated Legacy fallbacks — temporary compatibility for non-v1 output.
  // TODO(0.8): Remove all fallback paths below. The agent MUST produce
  // architect.v1 envelopes. These exist only to avoid breaking during the
  // transition period.
  // ──────────────────────────────────────────────────────────────────────────

  /** @deprecated Legacy: questions array without architect.v1 envelope.
   * Truncates to the FIRST question only to match the v1 single-question contract.
   * TODO(0.8): Remove this fallback entirely. */
  const questions = (obj.questions || obj.interview) as Array<Record<string, unknown>> | undefined
  if (Array.isArray(questions) && questions.length > 0) {
    const withOptions = questions.filter(q => q.options || q.choices)
    if (withOptions.length > 0) {
      return [customBlock('architect:questions', {
        questions: [normalizeQuestion(withOptions[0])],
      })]
    }
    return [textBlock((questions[0].question as string) || (questions[0].text as string) || (questions[0].label as string) || '')]
  }

  /** @deprecated Legacy: single question object without envelope */
  if (obj.text || (typeof obj.question === 'string')) {
    const questionText = (obj.text as string) || (obj.question as string) || ''
    if (obj.options || obj.choices) {
      return [customBlock('architect:questions', {
        questions: [normalizeQuestion(obj)],
      })]
    }
    return [textBlock(questionText)]
  }

  /** @deprecated Legacy: plan object without envelope */
  if (obj.name && (obj.decisions || obj.stack || obj.features || obj.phases)) {
    return [customBlock('architect:plan', {
      title: (obj.name as string) || 'Project Plan',
      summary: (obj.description as string) || '',
      decisions: Array.isArray(obj.decisions) ? obj.decisions : [],
      docs: Array.isArray(obj.files) ? (obj.files as Array<Record<string, unknown>>).map(f => ({ path: (f.path as string) || '', title: (f.name as string) || (f.path as string) || '' })) : [],
      nextActions: [],
    })]
  }

  /** @deprecated Legacy: clarify/answer format */
  if (obj.answer) {
    return [textBlock(obj.answer as string)]
  }

  /** @deprecated Legacy: review format */
  if (Array.isArray(obj.issues)) {
    const issues = obj.issues as Array<Record<string, unknown>>
    const text = issues.map(i => `**${i.severity}** [${i.area}]: ${i.problem}\n  → ${i.suggestion}`).join('\n\n')
    return [textBlock(text)]
  }

  // Unknown JSON — render as text
  return [textBlock(JSON.stringify(obj, null, 2))]
}
