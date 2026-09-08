import type { ActionBlock, ResponseBlock, TaskListBlock, TableBlock, TextBlock } from './blocks'
import { assistantContentBlockSchema, tryParseAssistantEnvelope } from './schema'
import type { AssistantContentBlock, AssistantEnvelope } from './schema'
import { getAssistantType } from './registry'

function text(content: string): TextBlock {
  return { type: 'text', content }
}

function normalizeList(block: Extract<AssistantContentBlock, { type: 'list' }>): TextBlock {
  const prefix = block.ordered ? (index: number) => `${index + 1}.` : () => '-'
  return text(block.items.map((item, index) => `${prefix(index)} ${item}`).join('\n'))
}

function normalizeSteps(block: Extract<AssistantContentBlock, { type: 'steps' }>): TaskListBlock {
  return {
    type: 'tasklist',
    tasks: block.items.map((item, index) => ({
      id: `step-${index + 1}`,
      title: item.title,
      ...(item.body ? { description: item.body } : {}),
      status: item.status === 'done'
        ? 'done'
        : item.status === 'doing'
          ? 'running'
          : 'pending',
    })),
  }
}

function normalizeKv(block: Extract<AssistantContentBlock, { type: 'kv' }>): TableBlock {
  return {
    type: 'table',
    headers: ['Label', 'Value'],
    rows: block.items.map(item => [item.label, item.value]),
  }
}

function normalizeAction(block: Extract<AssistantContentBlock, { type: 'action' }>): ActionBlock {
  return {
    type: 'action',
    actions: block.actions.map(action => ({
      id: action.id,
      label: action.label,
      ...(action.icon ? { icon: action.icon } : {}),
      ...(action.variant ? { variant: action.variant } : {}),
      ...(action.disabled != null ? { disabled: action.disabled } : {}),
      ...(action.url ? { url: action.url } : {}),
      ...(action.spaceId ? { spaceId: action.spaceId } : {}),
      ...(action.installSpaceId ? { installSpaceId: action.installSpaceId } : {}),
      ...(action.page ? { page: action.page } : {}),
      ...(action.openMode ? { openMode: action.openMode } : {}),
      ...(action.auto != null ? { auto: action.auto } : {}),
    })),
  }
}

function deriveDataActions(data: Record<string, unknown> | undefined): ActionBlock[] {
  if (!data) return []

  const url = typeof data.open_url === 'string'
    ? data.open_url
    : typeof data.website_url === 'string'
      ? data.website_url
      : null

  if (!url) return []

  const label = typeof data.open_label === 'string' && data.open_label.trim()
    ? data.open_label
    : 'Open Website'

  const openMode = data.open_mode === 'preview' || data.open_mode === 'space-preview'
    ? data.open_mode
    : 'browser'

  return [{
    type: 'action',
    actions: [{
      id: 'open-website',
      label,
      url,
      openMode,
      auto: true,
    }],
  }]
}

function parseEmbeddedStructuredBlocks(raw: string): ResponseBlock[] | null {
  const directEnvelope = tryParseAssistantEnvelope(raw)
  if (directEnvelope) return normalizeAssistantEnvelope(directEnvelope)

  const lines = raw.split('\n')
  const blocks: ResponseBlock[] = []
  const textBuffer: string[] = []
  let liftedAny = false

  const flushText = () => {
    const content = textBuffer.join('\n').trim()
    if (content) blocks.push(text(content))
    textBuffer.length = 0
  }

  // Try to parse a JSON object that starts at line `i`. Returns the parsed
  // value, the inclusive end line, and the candidate string, or null.
  function tryParseObjectAt(i: number): { parsed: unknown; candidate: string; end: number } | null {
    const startLine = lines[i] ?? ''
    if (!startLine.trim().startsWith('{')) return null
    let candidate = startLine
    let balance = (startLine.match(/\{/g) || []).length - (startLine.match(/\}/g) || []).length
    let end = i
    while (balance > 0 && end + 1 < lines.length) {
      end += 1
      const next = lines[end] ?? ''
      candidate += `\n${next}`
      balance += (next.match(/\{/g) || []).length - (next.match(/\}/g) || []).length
    }
    try {
      return { parsed: JSON.parse(candidate), candidate, end }
    } catch {
      return null
    }
  }

  function tryLift(parsed: unknown, candidate: string): ResponseBlock[] | null {
    const envelope = tryParseAssistantEnvelope(candidate)
    if (envelope) return normalizeAssistantEnvelope(envelope)
    const block = assistantContentBlockSchema.safeParse(parsed)
    if (block.success && block.data.type === 'action') {
      return normalizeContentBlock(block.data)
    }
    return null
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    const trimmed = line.trim()

    // Skip fenced code blocks but peek inside for liftable JSON. Models
    // routinely wrap action JSON in ```json … ``` — we don't want that
    // to render as a code block in chat.
    if (trimmed.startsWith('```')) {
      // Find the matching closing fence
      let close = i + 1
      while (close < lines.length && !((lines[close] ?? '').trim().startsWith('```'))) {
        close += 1
      }
      const fenceBody = lines.slice(i + 1, close).join('\n')
      const parsedFence = (() => {
        try {
          return JSON.parse(fenceBody.trim())
        } catch {
          return undefined
        }
      })()
      if (parsedFence !== undefined) {
        const lifted = tryLift(parsedFence, fenceBody.trim())
        if (lifted) {
          flushText()
          blocks.push(...lifted)
          liftedAny = true
          i = close
          continue
        }
      }
      // Not liftable — keep the fence as-is in the text buffer
      for (let j = i; j <= close && j < lines.length; j += 1) {
        textBuffer.push(lines[j] ?? '')
      }
      i = close
      continue
    }

    if (!trimmed.startsWith('{')) {
      textBuffer.push(line)
      continue
    }

    const parsedObj = tryParseObjectAt(i)
    if (parsedObj) {
      const lifted = tryLift(parsedObj.parsed, parsedObj.candidate)
      if (lifted) {
        flushText()
        blocks.push(...lifted)
        liftedAny = true
        i = parsedObj.end
        continue
      }
      textBuffer.push(parsedObj.candidate)
      i = parsedObj.end
      continue
    }

    textBuffer.push(line)
  }

  flushText()
  if (!liftedAny) return null
  return blocks
}

function normalizeContentBlock(block: AssistantContentBlock): ResponseBlock[] {
  switch (block.type) {
    case 'markdown':
      // Models often inline action JSON inside markdown text instead of
      // emitting a separate action block. Lift those out so they render
      // as buttons (and trigger auto-fire) instead of as raw text.
      return parseEmbeddedStructuredBlocks(block.text) ?? [text(block.text)]
    case 'list':
      return [normalizeList(block)]
    case 'steps':
      return [normalizeSteps(block)]
    case 'kv':
      return [normalizeKv(block)]
    case 'action':
      return [normalizeAction(block)]
  }
}

export function normalizeAssistantEnvelope(envelope: AssistantEnvelope): ResponseBlock[] {
  if (envelope.state === 'error') {
    return [{ type: 'error', message: envelope.error?.message || 'Assistant request failed.' }]
  }

  if (envelope.state === 'refusal') {
    return [text(envelope.refusal?.message || 'The assistant refused to answer this request.')]
  }

  const blocks: ResponseBlock[] = []
  const content = envelope.content

  if (!content) {
    if (envelope.state === 'incomplete') {
      return [text('The assistant response was incomplete.')]
    }
    return blocks
  }

  if (content.title) {
    blocks.push(text(`## ${content.title}`))
  }

  if (content.summary) {
    blocks.push(text(content.summary))
  }

  blocks.push(...content.blocks.flatMap(normalizeContentBlock))
  blocks.push(...deriveDataActions(content.data ?? undefined))

  if (content.data && Object.keys(content.data).length > 0) {
    blocks.push({
      type: 'json',
      label: 'Data',
      data: content.data,
    })
  }

  if (envelope.state === 'incomplete') {
    blocks.push(text('The assistant response was incomplete.'))
  }

  return blocks
}

/**
 * Dispatch normalizer: if the assistant type has a per-type normalizer, use it;
 * otherwise fall back to the default assistant.v1 envelope normalizer.
 */
export function normalize(assistantType: string, raw: unknown): ResponseBlock[] {
  const config = getAssistantType(assistantType)
  if (config?.normalizer) {
    return config.normalizer(raw)
  }
  // Default: treat as assistant.v1 envelope
  if (typeof raw === 'object' && raw !== null) {
    return normalizeAssistantEnvelope(raw as AssistantEnvelope)
  }
  if (typeof raw === 'string') {
    const parsed = parseEmbeddedStructuredBlocks(raw)
    if (parsed) return parsed
    return [text(raw)]
  }
  return [text(JSON.stringify(raw))]
}
