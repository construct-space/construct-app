import { z } from 'zod'

const markdownBlockSchema = z.object({
  type: z.literal('markdown'),
  text: z.string(),
})

const listBlockSchema = z.object({
  type: z.literal('list'),
  items: z.array(z.string()),
  ordered: z.boolean().optional(),
})

const stepsBlockSchema = z.object({
  type: z.literal('steps'),
  items: z.array(z.object({
    title: z.string(),
    body: z.string().optional(),
    status: z.enum(['todo', 'doing', 'done']).optional(),
  })),
})

const kvBlockSchema = z.object({
  type: z.literal('kv'),
  items: z.array(z.object({
    label: z.string(),
    value: z.string(),
  })),
})

export const assistantContentBlockSchema = z.discriminatedUnion('type', [
  markdownBlockSchema,
  listBlockSchema,
  stepsBlockSchema,
  kvBlockSchema,
])

export const assistantEnvelopeSchema = z.object({
  version: z.literal('assistant.v1'),
  state: z.enum(['ok', 'refusal', 'incomplete', 'error']),
  provider: z.string(),
  stop_reason: z.string().optional(),
  content: z.object({
    title: z.string().optional(),
    summary: z.string().optional(),
    blocks: z.array(assistantContentBlockSchema),
    data: z.record(z.string(), z.unknown()).optional(),
  }).optional(),
  refusal: z.object({
    message: z.string(),
  }).optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
  }).optional(),
})

export type AssistantContentBlock = z.infer<typeof assistantContentBlockSchema>
export type AssistantEnvelope = z.infer<typeof assistantEnvelopeSchema>

export function tryParseAssistantEnvelope(raw: string, stopReason?: string): AssistantEnvelope | null {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{')) return null

  // Truncated response — JSON may be incomplete
  if (stopReason === 'max_tokens') {
    return {
      version: 'assistant.v1',
      state: 'incomplete',
      provider: 'unknown',
      stop_reason: 'max_tokens',
    }
  }

  try {
    const parsed = JSON.parse(trimmed)

    // Handle refusal responses (model declined to answer)
    if (parsed.type === 'error' && parsed.error?.type === 'refusal') {
      return {
        version: 'assistant.v1',
        state: 'refusal',
        provider: 'unknown',
        refusal: { message: parsed.error.message || 'Request refused' },
      }
    }

    const result = assistantEnvelopeSchema.safeParse(parsed)
    return result.success ? result.data : null
  } catch {
    return null
  }
}
