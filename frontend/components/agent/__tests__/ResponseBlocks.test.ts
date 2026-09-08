import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ResponseBlocks from '../ResponseBlocks.vue'

const renderMarkdownPartsMock = vi.fn((content: string) => [
  { key: 'done:x', html: `<p>md:${content}</p>` },
])
const renderStreamingMarkdownPartsMock = vi.fn((content: string) => [
  { key: 'tail', html: `<p>stream:${content}</p>` },
])

vi.mock('@/composables/useMarkdown', () => ({
  useMarkdown: () => ({
    renderMarkdownParts: renderMarkdownPartsMock,
    renderStreamingMarkdownParts: renderStreamingMarkdownPartsMock,
  }),
}))

describe('ResponseBlocks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses streaming markdown rendering for streamed text blocks', () => {
    mount(ResponseBlocks, {
      props: {
        streaming: true,
        blocks: [
          { type: 'text', content: 'Writing **partial' },
        ],
      },
    })

    expect(renderStreamingMarkdownPartsMock).toHaveBeenCalledWith('Writing **partial')
    expect(renderMarkdownPartsMock).not.toHaveBeenCalled()
  })

  it('uses normal markdown rendering after streaming completes', () => {
    mount(ResponseBlocks, {
      props: {
        streaming: false,
        blocks: [
          { type: 'text', content: 'Writing **complete**' },
        ],
      },
    })

    expect(renderMarkdownPartsMock).toHaveBeenCalledWith('Writing **complete**')
    expect(renderStreamingMarkdownPartsMock).not.toHaveBeenCalled()
  })

  // Regression: a too-broad OPTION_RE used to strip every trailing list line
  // while streaming, so list-shaped answers froze at their pre-list text until
  // the stream finished — reading as a hang. Lists/prose must stream whole.
  it('streams numbered and bulleted list content without stripping it', () => {
    const content = 'Here are the reasons:\n1. First reason\n2. Second reason\n- a bullet'
    mount(ResponseBlocks, {
      props: { streaming: true, blocks: [{ type: 'text', content }] },
    })

    expect(renderStreamingMarkdownPartsMock).toHaveBeenCalledWith(content)
  })

  // The original intent still holds: genuine trailing lettered choice-options
  // (which become buttons) are hidden until streaming completes.
  it('hides a trailing run of lettered choice-options while streaming', () => {
    mount(ResponseBlocks, {
      props: {
        streaming: true,
        blocks: [{ type: 'text', content: 'Pick one:\na) Yes\nb) No' }],
      },
    })

    expect(renderStreamingMarkdownPartsMock).toHaveBeenCalledWith('Pick one:')
  })
})
