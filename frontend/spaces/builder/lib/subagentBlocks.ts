import type { StreamEvent } from '@/brain/types'
import type { AgentBlock, Block, ThinkingBlock, ToolCallBlock } from '../components/BlockRenderer.vue'

export interface BuilderStreamBlockState {
  activeAgentCallId: string | null
}

export interface BuilderStreamBlockResult {
  handled: boolean
  tool?: string
  callId?: string
  isError?: boolean
  textDelta?: string
  previewRequested?: boolean
  toolResult?: boolean
}

interface SpawnInput {
  agent_id?: string
  task?: string
}

export function createBuilderStreamBlockState(): BuilderStreamBlockState {
  return { activeAgentCallId: null }
}

export function applyBuilderStreamEvent(
  blocks: Block[],
  state: BuilderStreamBlockState,
  chunk: StreamEvent,
): BuilderStreamBlockResult {
  if (chunk.type === 'agent.spawn') {
    const agent = activeAgent(blocks, state)
    if (agent) {
      agent.agentId = stringData(chunk, 'agent_id') || agent.agentId
      agent.agentName = stringData(chunk, 'agent_name') || agent.agentName
      agent.source = stringData(chunk, 'source') || agent.source
      agent.title = `Explore(${agent.agentId})`
    }
    return { handled: true }
  }

  if (chunk.type === 'tool.call') {
    const rawTool = stringData(chunk, 'tool')
    const callId = stringData(chunk, 'call_id') || `${rawTool}-${Date.now()}`
    const { tool, input } = unwrapTool(rawTool, inputData(chunk))
    const title = stringData(chunk, 'title') || tool

    if (tool === 'spawn_agent') {
      const spawn = parseSpawnInput(input)
      const agentId = spawn.agent_id || 'agent'
      const block: AgentBlock = {
        type: 'agent',
        callId,
        agentId,
        task: spawn.task || '',
        title: `Explore(${agentId})`,
        state: 'running',
        children: [],
      }
      blocks.push(block)
      state.activeAgentCallId = callId
      return { handled: true, tool, callId }
    }

    targetBlocks(blocks, state).push({
      type: 'tool',
      callId,
      tool,
      title,
      input,
      state: 'running',
    } as ToolCallBlock)

    return {
      handled: true,
      tool,
      callId,
      previewRequested: tool === 'start_preview',
    }
  }

  if (chunk.type === 'tool.result') {
    const rawTool = stringData(chunk, 'tool')
    const callId = stringData(chunk, 'call_id')
    const isError = Boolean(chunk.data?.is_error)
    const content = stringData(chunk, 'content')
    const { tool, input } = unwrapTool(rawTool, inputData(chunk))
    const title = stringData(chunk, 'title') || tool

    if (tool === 'spawn_agent') {
      const agent = findAgentBlock(blocks, callId)
      if (agent) {
        agent.result = content
        agent.isError = isError
        agent.state = isError ? 'error' : 'done'
      }
      if (state.activeAgentCallId === callId) state.activeAgentCallId = null
      return { handled: true, tool, callId, isError, toolResult: true }
    }

    const target = targetBlocks(blocks, state)
    // Prefer the brain-supplied call_id; when it's missing/unmatched, fall back
    // to the most recent still-running block with the same (unwrapped) tool
    // name. Without this fallback the call and its result render as two
    // separate blocks and the call half spins "running" forever.
    const existing = findToolBlock(target, callId) || findLastRunningTool(target, tool)
    if (existing) {
      existing.result = content
      existing.isError = isError
      existing.state = isError ? 'error' : 'done'
      if (!existing.input && input) existing.input = input
    } else {
      target.push({
        type: 'tool',
        callId: callId || `${tool}-${Date.now()}`,
        tool,
        title,
        input,
        result: content,
        isError,
        state: isError ? 'error' : 'done',
      } as ToolCallBlock)
    }
    return { handled: true, tool, callId, isError, toolResult: true }
  }

  if (chunk.type === 'thinking') {
    const text = stringData(chunk, 'text')
    if (!text) return { handled: true }
    const target = targetBlocks(blocks, state)
    const last = target[target.length - 1]
    if (last?.type === 'thinking') last.text += text
    else target.push({ type: 'thinking', text } as ThinkingBlock)
    return { handled: true }
  }

  if (chunk.type === 'text' || !chunk.type) {
    const text = chunk.content || stringData(chunk, 'text')
    if (!text) return { handled: true }
    const target = targetBlocks(blocks, state)
    const last = target[target.length - 1]
    if (last?.type === 'text') last.text += text
    else target.push({ type: 'text', text })
    return {
      handled: true,
      textDelta: state.activeAgentCallId ? undefined : text,
    }
  }

  return { handled: false }
}

function stringData(chunk: StreamEvent, key: string): string {
  const value = chunk.data?.[key]
  return typeof value === 'string' ? value : ''
}

function inputData(chunk: StreamEvent): string {
  const rawInput = chunk.data?.input
  if (typeof rawInput === 'string') return rawInput
  return rawInput ? JSON.stringify(rawInput) : ''
}

// The brain exposes a "pi-shape" tool surface: most tools are hidden behind a
// `call_tool` (and `list_tools`) dispatcher. Raw, that surfaces in the UI as
// `call_tool ({"name":"task_update","args":{…}})`, which is noise — the user
// cares about the *real* tool. Unwrap it so we display `task_update ({…})`.
function unwrapTool(tool: string, input: string): { tool: string; input: string } {
  if ((tool === 'call_tool' || tool === 'call') && input) {
    try {
      const p = JSON.parse(input) as { name?: string; tool?: string; args?: unknown; arguments?: unknown }
      const inner = p.name || p.tool
      if (inner) {
        const innerArgs = p.args ?? p.arguments
        return { tool: inner, input: innerArgs !== undefined ? (typeof innerArgs === 'string' ? innerArgs : JSON.stringify(innerArgs)) : '' }
      }
    } catch { /* not a wrapped call — fall through */ }
  }
  return { tool, input }
}

// Most-recent still-running tool block with a given (unwrapped) name. Used to
// correlate a `tool.result` back to its `tool.call` when the brain didn't
// carry a stable call_id — without this every tool renders as two blocks
// (an orphaned "running" row + a "done" row).
function findLastRunningTool(blocks: Block[], tool: string): ToolCallBlock | undefined {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i]
    if (b.type === 'tool' && b.state === 'running' && b.tool === tool) return b
  }
  return undefined
}

function parseSpawnInput(input: string): SpawnInput {
  if (!input) return {}
  try {
    return JSON.parse(input) as SpawnInput
  } catch {
    return {}
  }
}

function targetBlocks(blocks: Block[], state: BuilderStreamBlockState): Block[] {
  return activeAgent(blocks, state)?.children ?? blocks
}

function activeAgent(blocks: Block[], state: BuilderStreamBlockState): AgentBlock | undefined {
  return state.activeAgentCallId ? findAgentBlock(blocks, state.activeAgentCallId) : undefined
}

function findAgentBlock(blocks: Block[], callId: string): AgentBlock | undefined {
  if (!callId) return undefined
  return blocks.find((block): block is AgentBlock => block.type === 'agent' && block.callId === callId)
}

function findToolBlock(blocks: Block[], callId: string): ToolCallBlock | undefined {
  if (!callId) return undefined
  return blocks.find((block): block is ToolCallBlock => block.type === 'tool' && block.callId === callId)
}
