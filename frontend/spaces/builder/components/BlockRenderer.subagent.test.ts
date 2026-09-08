import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import BlockRenderer from './BlockRenderer.vue'
import type { AgentBlock, Block } from './BlockRenderer.vue'

describe('BlockRenderer subagent blocks', () => {
  it('renders explorer activity as an expandable Explore block', async () => {
    const blocks: Block[] = [{
      type: 'agent',
      callId: 'spawn-1',
      agentId: 'builder-explorer',
      agentName: 'Builder Explorer',
      task: 'Find boss difficulty configuration.',
      title: 'Explore(builder-explorer)',
      state: 'running',
      children: [{
        type: 'tool',
        callId: 'grep-1',
        tool: 'grep',
        title: 'Search boss config',
        input: '{"pattern":"boss"}',
        state: 'done',
        result: 'src/boss.ts:12 hp: 100',
      }],
    } as AgentBlock]

    const wrapper = mount(BlockRenderer, {
      props: {
        blocks,
        streaming: true,
      },
    })

    expect(wrapper.text()).toContain('Explore(builder-explorer)')
    expect(wrapper.text()).toContain('Find boss difficulty configuration.')
    expect(wrapper.text()).not.toContain('src/boss.ts:12 hp: 100')

    await wrapper.get('[data-test="agent-block-toggle"]').trigger('click')

    // Tool calls render Claude-Code-style as `Tool(arg)` — capitalized label,
    // and the unwrapped pattern as the inline argument.
    expect(wrapper.text()).toContain('Grep(')
    expect(wrapper.text()).toContain('src/boss.ts:12 hp: 100')
  })
})
