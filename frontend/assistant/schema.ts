import { z } from 'zod'

const markdownBlockSchema = z.object({
  type: z.literal('markdown'),
  text: z.string(),
})

const listBlockSchema = z.object({
  type: z.literal('list'),
  items: z.array(z.string()),
  ordered: z.boolean().nullish(),
})

const stepsBlockSchema = z.object({
  type: z.literal('steps'),
  items: z.array(z.object({
    title: z.string(),
    body: z.string().nullish(),
    status: z.enum(['todo', 'doing', 'done']).nullish(),
  })),
})

const kvBlockSchema = z.object({
  type: z.literal('kv'),
  items: z.array(z.object({
    label: z.string(),
    value: z.string(),
  })),
})

const actionBlockSchema = z.object({
  type: z.literal('action'),
  actions: z.array(z.object({
    id: z.string(),
    label: z.string(),
    icon: z.string().nullish(),
    variant: z.enum(['primary', 'secondary', 'danger']).nullish(),
    disabled: z.boolean().nullish(),
    // Either `url` (open external/embedded URL) or `spaceId` (navigate to an
    // installed Space). At least one must be set when the button is meant to
    // do something; we don't enforce that here so a model can still emit an
    // info-only action.
    url: z.string().url().nullish(),
    spaceId: z.string().nullish(),
    // Marketplace install — the executor calls
    // useSpaceMarketplace().installSpace(installSpaceId).
    installSpaceId: z.string().nullish(),
    page: z.string().nullish(),
    openMode: z.enum(['browser', 'preview', 'space-preview', 'space']).nullish(),
    auto: z.boolean().nullish(),
  })),
})

// Coerce common model drift before discriminating:
//   { type: 'text', text } → { type: 'markdown', text }
const blockPreprocessor = z.preprocess((val) => {
  if (val && typeof val === 'object' && (val as { type?: unknown }).type === 'text') {
    return { ...(val as Record<string, unknown>), type: 'markdown' }
  }
  return val
}, z.discriminatedUnion('type', [
  markdownBlockSchema,
  listBlockSchema,
  stepsBlockSchema,
  kvBlockSchema,
  actionBlockSchema,
]))

export const assistantContentBlockSchema = blockPreprocessor

export const assistantEnvelopeSchema = z.object({
  version: z.literal('assistant.v1'),
  state: z.enum(['ok', 'refusal', 'incomplete', 'error']),
  provider: z.string(),
  // OpenAI strict mode emits explicit `null` for optional fields (every
  // property must be in `required`, optional emulated via nullable type
  // unions). `.nullish()` accepts both null and undefined so the same
  // envelope round-trips through Anthropic (omitted) and OpenAI (null).
  stop_reason: z.string().nullish(),
  // Models sometimes emit `content` as a plain string instead of the
  // structured envelope. Coerce that into a single markdown block so the
  // response still renders instead of falling through to raw JSON.
  content: z.preprocess((val) => {
    if (typeof val === 'string') {
      return { title: null, summary: null, blocks: [{ type: 'markdown', text: val }] }
    }
    return val
  }, z.object({
    title: z.string().nullish(),
    summary: z.string().nullish(),
    blocks: z.array(assistantContentBlockSchema),
    data: z.record(z.string(), z.unknown()).nullish(),
  }).nullish()),
  refusal: z.object({
    message: z.string(),
  }).nullish(),
  error: z.object({
    code: z.string(),
    message: z.string(),
  }).nullish(),
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
