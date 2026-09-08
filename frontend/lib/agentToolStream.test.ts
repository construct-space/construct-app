import { describe, it, expect } from 'vitest'
import { unwrapToolCall, findLastRunningTool, findOldestRunningTool, applyTaskResult, type ToolBlockLike, type WorkflowTask } from './agentToolStream'

describe('unwrapToolCall', () => {
  it('unwraps the call_tool dispatcher to the real tool + its args', () => {
    const r = unwrapToolCall('call_tool', { name: 'task_update', args: { id: 25, status: 'completed' } })
    expect(r.tool).toBe('task_update')
    expect(JSON.parse(r.input)).toEqual({ id: 25, status: 'completed' })
  })
  it('passes through a normal tool unchanged', () => {
    const r = unwrapToolCall('bash', { command: 'ls' })
    expect(r.tool).toBe('bash')
    expect(JSON.parse(r.input)).toEqual({ command: 'ls' })
  })
  it('tolerates string input and non-wrapped call', () => {
    expect(unwrapToolCall('edit', '{"path":"a.ts"}').tool).toBe('edit')
    expect(unwrapToolCall('call_tool', 'not json').tool).toBe('call_tool')
  })
})

describe('findLastRunningTool', () => {
  it('returns the most recent running block of the given tool', () => {
    const blocks: ToolBlockLike[] = [
      { type: 'tool', callId: 'a', tool: 'bash', state: 'done' },
      { type: 'tool', callId: 'b', tool: 'bash', state: 'running' },
      { type: 'tool', callId: 'c', tool: 'edit', state: 'running' },
    ]
    expect(findLastRunningTool(blocks, 'bash')?.callId).toBe('b')
    expect(findLastRunningTool(blocks, 'edit')?.callId).toBe('c')
    expect(findLastRunningTool(blocks, 'read')).toBeUndefined()
  })
})

describe('findOldestRunningTool', () => {
  it('returns the first still-running block regardless of tool name', () => {
    const blocks: ToolBlockLike[] = [
      { type: 'tool', callId: 'a', tool: 'task_create', state: 'done' },
      { type: 'tool', callId: 'b', tool: 'task_create', state: 'running' },
      { type: 'tool', callId: 'c', tool: 'task_create', state: 'running' },
    ]
    // FIFO: the oldest running block, used when a result carries no id/name.
    expect(findOldestRunningTool(blocks)?.callId).toBe('b')
  })
  it('returns undefined when nothing is running', () => {
    expect(findOldestRunningTool([{ type: 'tool', callId: 'a', tool: 'bash', state: 'done' }])).toBeUndefined()
  })
})

describe('result correlation without id/name (the empty-result-event case)', () => {
  it('recovers the tool name from the call block so task results land', () => {
    // Simulate the brain's tool_result: no name, empty id. The call block
    // carries the real (unwrapped) tool name; that is what must drive
    // applyTaskResult — the result event has none.
    const blocks: ToolBlockLike[] = [
      { type: 'tool', callId: 'task_create-1', tool: 'task_create', state: 'running' },
    ]
    const resultContent = '{"id":1,"title":"Update CSS","status":"pending"}'
    const existing = findOldestRunningTool(blocks)
    expect(existing?.tool).toBe('task_create')
    const tasks = new Map<number, WorkflowTask>()
    applyTaskResult(existing?.tool || '', resultContent, tasks)
    expect(tasks.get(1)).toMatchObject({ id: 1, title: 'Update CSS', status: 'pending' })
  })
})

describe('applyTaskResult', () => {
  it('adds a task from task_create result', () => {
    const tasks = new Map<number, WorkflowTask>()
    applyTaskResult('task_create', '{"id":1,"title":"Scaffold","status":"pending"}', tasks)
    expect(tasks.get(1)).toMatchObject({ id: 1, title: 'Scaffold', status: 'pending' })
  })
  it('updates status from task_update', () => {
    const tasks = new Map<number, WorkflowTask>([[1, { id: 1, title: 'Scaffold', status: 'pending' }]])
    applyTaskResult('task_update', '{"id":1,"title":"Scaffold","status":"completed"}', tasks)
    expect(tasks.get(1)?.status).toBe('completed')
  })
  it('rebuilds from a task_list array', () => {
    const tasks = new Map<number, WorkflowTask>()
    applyTaskResult('task_list', '[{"id":1,"title":"A","status":"completed"},{"id":2,"title":"B","status":"in_progress"}]', tasks)
    expect(tasks.size).toBe(2)
    expect(tasks.get(2)?.status).toBe('in_progress')
  })
  it('tolerates a leading log line before the JSON', () => {
    const tasks = new Map<number, WorkflowTask>()
    applyTaskResult('task_create', 'Created task:\n{"id":3,"title":"C","status":"pending"}', tasks)
    expect(tasks.get(3)?.title).toBe('C')
  })
  it('ignores non-task tools', () => {
    const tasks = new Map<number, WorkflowTask>()
    applyTaskResult('bash', '{"id":1,"title":"x","status":"pending"}', tasks)
    expect(tasks.size).toBe(0)
  })
})
