import { z } from 'zod'

/**
 * architect.v1 — Canonical UI contract for the Architect space.
 *
 * This is the SOLE output schema the Architect agent must produce.
 * All LLM output must conform to the `architectEnvelopeSchema` discriminated
 * union. The normalizer provides temporary fallback parsing for legacy shapes,
 * but those paths are deprecated and will be removed.
 *
 * Contract invariants:
 * - Exactly ONE question per `questions` state (single-question progression)
 * - `plan.docs` is adaptive — the doc set varies by project type
 * - All states require `version: "architect.v1"`
 */

const optionSchema = z.object({
  value: z.string(),
  label: z.string(),
  description: z.string().optional(),
  icon: z.string().optional(),
})

const questionSchema = z.object({
  id: z.string(),
  question: z.string(),
  type: z.enum(['single', 'multi']),
  options: z.array(optionSchema),
})

/**
 * Questions state: presents exactly ONE question at a time.
 * The `questions` array contains a single element — the active question.
 * The next question is determined by the user's answer to this one.
 */
export const architectQuestionsSchema = z.object({
  version: z.literal('architect.v1'),
  state: z.literal('questions'),
  questions: z.array(questionSchema).min(1).max(1),
})

export const architectPlanSchema = z.object({
  version: z.literal('architect.v1'),
  state: z.literal('plan'),
  title: z.string(),
  summary: z.string(),
  decisions: z.array(z.object({ label: z.string(), value: z.string() })),
  docs: z.array(z.object({ path: z.string(), title: z.string() })),
  next_actions: z.array(z.object({ id: z.string(), label: z.string() })),
})

export const architectProgressSchema = z.object({
  version: z.literal('architect.v1'),
  state: z.literal('progress'),
  message: z.string(),
})

export const architectEnvelopeSchema = z.discriminatedUnion('state', [
  architectQuestionsSchema,
  architectPlanSchema,
  architectProgressSchema,
])

export type ArchitectEnvelope = z.infer<typeof architectEnvelopeSchema>
