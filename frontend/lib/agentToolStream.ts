/**
 * Shared helpers for the agent tool stream used by the Builder and Space
 * Developer pages (and spacekit). Both build chat blocks inline from the
 * brain's `tool_call` / `tool_result` events; this module holds the bits that
 * were getting it wrong or duplicated:
 *
 *  - unwrapping the pi-shape `call_tool` dispatcher to the real tool,
 *  - correlating a result back to its call when the brain didn't carry a
 *    stable call_id (otherwise the call half spins "running" forever),
 *  - turning task_create / task_update / task_list results into the
 *    WorkflowTask map the TasksPanel renders.
 */

export interface WorkflowTask {
  id: number
  title: string
  description?: string
  status: 'pending' | 'in_progress' | 'completed' | 'error' | 'skipped'
}

// Minimal structural shape of a tool block — matches the ToolCallBlock in both
// BlockRenderer components without importing either.
export interface ToolBlockLike {
  type: string
  callId: string
  tool: string
  title?: string
  input?: string
  result?: string
  isError?: boolean
  state: 'running' | 'done' | 'error'
}

/**
 * The brain exposes most tools behind a `call_tool` (and `list_tools`)
 * dispatcher. Raw, that surfaces as `call_tool({"name":"task_update",…})`.
 * Unwrap to the real tool + its own args.
 */
export function unwrapToolCall(
  name: string,
  rawInput: unknown,
): { tool: string; input: string } {
  const input = typeof rawInput === 'string' ? rawInput : rawInput != null ? JSON.stringify(rawInput) : ''
  if ((name === 'call_tool' || name === 'call') && input) {
    try {
      const p = JSON.parse(input) as { name?: string; tool?: string; args?: unknown; arguments?: unknown }
      const inner = p.name || p.tool
      if (inner) {
        const innerArgs = p.args ?? p.arguments
        return { tool: inner, input: innerArgs !== undefined ? (typeof innerArgs === 'string' ? innerArgs : JSON.stringify(innerArgs)) : '' }
      }
    } catch { /* not wrapped — fall through */ }
  }
  return { tool: name, input }
}

/** Most-recent still-running tool block with a given name. */
export function findLastRunningTool<T extends ToolBlockLike>(blocks: T[], tool: string): T | undefined {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i]
    if (b.type === 'tool' && b.state === 'running' && b.tool === tool) return b
  }
  return undefined
}

/**
 * Oldest still-running tool block, regardless of name. Last-resort
 * correlation for a result that carries neither a stable call id nor a
 * tool name (the brain's tool_result is `{id, output, is_error}` with an
 * often-empty id and no name). Results generally complete in call order,
 * so the oldest running block (FIFO) is the best guess.
 */
export function findOldestRunningTool<T extends ToolBlockLike>(blocks: T[]): T | undefined {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    if (b.type === 'tool' && b.state === 'running') return b
  }
  return undefined
}

/**
 * Update the task map from a task tool's result. task_list returns an array
 * (authoritative rebuild of what's listed); task_create / task_update return a
 * single task. Tolerant of extra wrapping text around the JSON.
 */
export function applyTaskResult(tool: string, content: string, tasks: Map<number, WorkflowTask>): void {
  if (!content) return
  if (tool !== 'task_create' && tool !== 'task_update' && tool !== 'task_list') return
  const parsed = extractJson(content)
  if (parsed == null) return
  const list = Array.isArray(parsed) ? parsed : [parsed]
  for (const item of list) {
    const t = coerceTask(item)
    if (t) tasks.set(t.id, t)
  }
}

function coerceTask(item: unknown): WorkflowTask | null {
  if (!item || typeof item !== 'object') return null
  const o = item as Record<string, unknown>
  const id = typeof o.id === 'number' ? o.id : Number(o.id)
  if (!Number.isFinite(id)) return null
  const status = String(o.status ?? 'pending') as WorkflowTask['status']
  return {
    id,
    title: String(o.title ?? `Task ${id}`),
    description: typeof o.description === 'string' ? o.description : undefined,
    status,
  }
}

// Pull the first JSON object/array out of a tool result string. The result is
// usually pure JSON, but be tolerant of a leading log line or trailing note.
function extractJson(s: string): unknown {
  const trimmed = s.trim()
  try {
    return JSON.parse(trimmed)
  } catch { /* try to find an embedded object/array */ }
  const start = trimmed.search(/[[{]/)
  if (start < 0) return null
  const open = trimmed[start]
  const close = open === '[' ? ']' : '}'
  const end = trimmed.lastIndexOf(close)
  if (end <= start) return null
  try {
    return JSON.parse(trimmed.slice(start, end + 1))
  } catch {
    return null
  }
}
