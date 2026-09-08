export interface TextBlock {
  type: 'text'
  content: string
}

export interface ImageBlock {
  type: 'image'
  src: string
  alt?: string
}

export interface FileBlock {
  type: 'file'
  name: string
  path?: string
  size?: number
}

export interface ToolBlock {
  type: 'tool'
  tool: string
  title: string
  callId: string
  input?: string
  result?: string
  state: 'running' | 'done' | 'error'
}

export interface CodeBlock {
  type: 'code'
  language: string
  content: string
  filename?: string
}

export interface SvgBlock {
  type: 'svg'
  content: string
}

export interface ErrorBlock {
  type: 'error'
  message: string
}

export interface StatusBlock {
  type: 'status'
  state: string
  message: string
  turn?: number
  maxTurns?: number
}

export interface QuestionBlock {
  type: 'question'
  id: string
  question: string
  questionType: 'single' | 'multi'
  options: { value: string; label: string; icon?: string; description?: string }[]
  answer?: string | string[]
}

export interface PlanBlock {
  type: 'plan'
  name: string
  description: string
  planType?: string
  spaceId?: string
  decisions?: Record<string, unknown>
  stack?: Record<string, unknown>
  features?: { name: string; description: string; priority?: string }[]
  tasks?: {
    id: number
    title: string
    description: string
    files?: string[]
    steps?: string[]
    depends?: number[]
    commit?: string
  }[]
  phases?: { name: string; tasks: string[] }[]
}

export interface TaskListBlock {
  type: 'tasklist'
  tasks: {
    id: string | number
    title: string
    description?: string
    status: 'pending' | 'running' | 'done' | 'error' | 'skipped'
    commit?: string
  }[]
}

export interface ProgressBlock {
  type: 'progress'
  headline: string
  detail?: string
  phase?: string
  percent?: number
}

export interface TableBlock {
  type: 'table'
  headers: string[]
  rows: string[][]
  caption?: string
}

export interface JsonBlock {
  type: 'json'
  data: unknown
  label?: string
  collapsed?: boolean
}

export interface ActionBlock {
  type: 'action'
  actions: {
    id: string
    label: string
    description?: string
    icon?: string
    variant?: 'primary' | 'secondary' | 'danger'
    disabled?: boolean
    url?: string
    spaceId?: string
    installSpaceId?: string
    page?: string
    openMode?: 'browser' | 'preview' | 'space-preview' | 'space'
    auto?: boolean
  }[]
}

export interface LinkBlock {
  type: 'link'
  url: string
  title?: string
  description?: string
  favicon?: string
}

export interface DiffBlock {
  type: 'diff'
  filename: string
  hunks: string
  language?: string
}

export interface CustomBlock {
  type: `${string}:${string}`
  data: Record<string, unknown>
}

export type RequestBlock = TextBlock | ImageBlock | FileBlock

export type ResponseBlock =
  | TextBlock
  | ToolBlock
  | CodeBlock
  | SvgBlock
  | ImageBlock
  | ErrorBlock
  | StatusBlock
  | QuestionBlock
  | PlanBlock
  | TaskListBlock
  | ProgressBlock
  | TableBlock
  | JsonBlock
  | ActionBlock
  | LinkBlock
  | DiffBlock
  | CustomBlock

export interface TurnStreamState {
  /** Current render phase for this turn */
  renderState: import('./streamClassification').StreamRenderState
  /** Whether we are buffering content behind a placeholder */
  isBuffering: boolean
  /** Accumulated raw content during buffering */
  bufferContent: string
  /** Timestamp when buffering started (for elapsed time display) */
  bufferStartedAt: number | null
}

/** Construct gateway routing metadata, surfaced when the upstream is
 *  provider-api (X-Construct-* response headers). Lets the assistant
 *  bubble render a chip like "via apoc/backup #1 → openrouter/deepseek-v4-pro". */
export interface RoutingInfo {
  operator?: string
  slot?: string
  routingTarget?: string
  upstream?: string
}

export interface Turn {
  id: string
  request: RequestBlock[]
  response: ResponseBlock[]
  agentId: string
  status: 'pending' | 'streaming' | 'done' | 'error'
  timestamp: number
  turns?: number
  /** Streaming coordination state — tracks buffer/render phase */
  streamState?: TurnStreamState
  /** Set when the gateway emitted X-Construct-* headers for this turn. */
  routing?: RoutingInfo
}

const OPTION_LINE = /^\s*(?:[-*]|\(?([a-z0-9])\)?[.):]\s*\*{0,2})(.+?)(?:\*{0,2}\s*[-—]\s*(.+))?$/i

export function extractQuestion(text: string): { before: string; question: QuestionBlock } | null {
  const trimmed = text.trimEnd()
  if (trimmed.length < 40) return null
  if (!trimmed.includes('?')) return null

  const lines = trimmed.split('\n')
  const optionEnd = lines.length
  let optionStart = optionEnd

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]?.trim() || ''
    if (!line) {
      if (optionStart < optionEnd) break
      continue
    }
    if (OPTION_LINE.test(line)) {
      optionStart = i
      continue
    }
    break
  }

  if (optionStart >= optionEnd || optionEnd - optionStart < 2) return null

  const options: QuestionBlock['options'] = []
  for (let i = optionStart; i < optionEnd; i += 1) {
    const match = lines[i]?.trim().match(OPTION_LINE)
    if (!match) continue

    const rawLabel = (match[2] || '').replace(/\*{1,2}/g, '').trim()
    const description = (match[3] || '').replace(/\*{1,2}/g, '').trim() || undefined
    const isGenericLabel = /^option\s+[a-z0-9]$/i.test(rawLabel)
    const label = isGenericLabel && description ? description : rawLabel
    const desc = isGenericLabel && description ? undefined : description

    if (label) {
      options.push({ value: label, label, description: desc })
    }
  }

  if (options.length < 2) return null

  let questionLine = ''
  for (let i = optionStart - 1; i >= 0; i -= 1) {
    const line = lines[i]?.trim() || ''
    if (!line) continue
    questionLine = line.replace(/^#+\s*/, '').replace(/\*{1,2}/g, '')
    break
  }
  if (!questionLine) return null

  let beforeEnd = optionStart - 1
  for (; beforeEnd >= 0; beforeEnd -= 1) {
    const line = lines[beforeEnd]?.trim() || ''
    if (
      line === questionLine.trim()
      || line.replace(/^#+\s*/, '').replace(/\*{1,2}/g, '') === questionLine
    ) {
      break
    }
  }

  const before = lines.slice(0, beforeEnd).join('\n').trimEnd()
  const fullBlock = trimmed.toLowerCase()
  const isMulti = /select\s*(multiple|all|any)|choose\s*(multiple|all|any)|pick\s*(multiple|all|any)|multi.?select|more\s+than\s+one|allow\s+multiple/i.test(fullBlock)

  return {
    before,
    question: {
      type: 'question',
      id: `q-${Date.now()}`,
      question: questionLine,
      questionType: isMulti ? 'multi' : 'single',
      options,
    },
  }
}
