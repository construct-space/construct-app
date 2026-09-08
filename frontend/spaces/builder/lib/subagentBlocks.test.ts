import { describe, expect, it } from 'vitest'
import type { Block } from '../components/BlockRenderer.vue'
import { applyBuilderStreamEvent, createBuilderStreamBlockState } from './subagentBlocks'
import type { StreamEvent } from '@/brain/types'

describe('subagent block stream ingestion', () => {
  it('nests explorer stream activity under the active Explore block', () => {
    const blocks: Block[] = []
    const state = createBuilderStreamBlockState()

    applyBuilderStreamEvent(blocks, state, event('tool.call', {
      tool: 'spawn_agent',
      call_id: 'spawn-1',
      input: JSON.stringify({
        agent_id: 'builder-explorer',
        task: 'Find boss difficulty configuration.',
      }),
      title: 'spawn_agent',
    }))
    applyBuilderStreamEvent(blocks, state, event('agent.spawn', {
      agent_id: 'builder-explorer',
      agent_name: 'Builder Explorer',
      source: 'builtin:builder',
    }))
    applyBuilderStreamEvent(blocks, state, event('tool.call', {
      tool: 'grep',
      call_id: 'grep-1',
      input: '{"pattern":"boss"}',
      title: 'Search boss config',
    }))
    applyBuilderStreamEvent(blocks, state, event('tool.result', {
      tool: 'grep',
      call_id: 'grep-1',
      content: 'src/boss.ts:12 hp: 100',
      is_error: false,
      title: 'Search boss config',
    }))
    applyBuilderStreamEvent(blocks, state, event('tool.result', {
      tool: 'spawn_agent',
      call_id: 'spawn-1',
      content: 'Findings:\n- src/boss.ts:12 hp: 100',
      is_error: false,
      title: 'spawn_agent',
    }))

    expect(blocks).toHaveLength(1)
    const explore = blocks[0]
    expect(explore.type).toBe('agent')
    if (explore.type !== 'agent') throw new Error('expected agent block')

    expect(explore.agentId).toBe('builder-explorer')
    expect(explore.agentName).toBe('Builder Explorer')
    expect(explore.task).toBe('Find boss difficulty configuration.')
    expect(explore.state).toBe('done')
    expect(explore.children).toHaveLength(1)
    expect(explore.children[0]).toMatchObject({
      type: 'tool',
      tool: 'grep',
      state: 'done',
      result: 'src/boss.ts:12 hp: 100',
    })
    expect(state.activeAgentCallId).toBeNull()
  })
})

function event(type: string, data: Record<string, unknown>): StreamEvent {
  return { type, data, content: '', done: false }
}
