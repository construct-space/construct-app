import { z } from 'zod'

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

export const architectQuestionsSchema = z.object({
  version: z.literal('architect.v1'),
  state: z.literal('questions'),
  questions: z.array(questionSchema),
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
