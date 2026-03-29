import type { ResponseBlock, TaskListBlock, TableBlock, TextBlock } from './blocks'
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

function normalizeContentBlock(block: AssistantContentBlock): ResponseBlock {
  switch (block.type) {
    case 'markdown':
      return text(block.text)
    case 'list':
      return normalizeList(block)
    case 'steps':
      return normalizeSteps(block)
    case 'kv':
      return normalizeKv(block)
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

  blocks.push(...content.blocks.map(normalizeContentBlock))

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
  return [text(typeof raw === 'string' ? raw : JSON.stringify(raw))]
}
