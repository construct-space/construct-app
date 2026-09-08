import { describe, it, expect } from 'vitest'
import {
  splitMarkdownBlocks,
  renderStreamingMarkdownParts,
  renderMarkdownParts,
} from './useMarkdown'

describe('splitMarkdownBlocks', () => {
  it('returns empty array for empty input', () => {
    expect(splitMarkdownBlocks('')).toEqual([])
  })

  it('splits on blank lines', () => {
    expect(splitMarkdownBlocks('one\n\ntwo\n\nthree')).toEqual(['one', 'two', 'three'])
  })

  it('keeps fenced code blocks intact across blank lines', () => {
    const input = '```ts\nconst a = 1\n\nconst b = 2\n```\n\nafter'
    expect(splitMarkdownBlocks(input)).toEqual([
      '```ts\nconst a = 1\n\nconst b = 2\n```',
      'after',
    ])
  })

  it('keeps a markdown table as a single block', () => {
    const input = '| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |'
    expect(splitMarkdownBlocks(input)).toEqual([input])
  })

  it('drops trailing whitespace-only blocks', () => {
    expect(splitMarkdownBlocks('one\n\n\n\n')).toEqual(['one'])
  })
})

describe('renderStreamingMarkdownParts', () => {
  it('returns one part per block plus a stable "tail" key on the last', () => {
    const parts = renderStreamingMarkdownParts('first\n\nsecond\n\nthird')
    expect(parts).toHaveLength(3)
    expect(parts[parts.length - 1].key).toBe('tail')
    // Completed block keys are content-derived, so identical content
    // produces identical keys across calls — that's what lets Vue keep
    // the same DOM node mounted.
    const again = renderStreamingMarkdownParts('first\n\nsecond\n\nthird')
    expect(again[0].key).toBe(parts[0].key)
    expect(again[1].key).toBe(parts[1].key)
  })

  it('reuses cached html for completed blocks across chunks', () => {
    // Simulate two chunks of the same stream — the completed block
    // ("first") must yield the SAME html string reference so v-html
    // skips the DOM patch.
    const a = renderStreamingMarkdownParts('first\n\nsecond')
    const b = renderStreamingMarkdownParts('first\n\nsecond more')
    expect(a[0].html).toBe(b[0].html) // same reference, not just equal
    expect(a[0].key).toBe(b[0].key)
    // Tail keeps its slot (key) but html updates as the tail grows.
    expect(a[1].key).toBe('tail')
    expect(b[1].key).toBe('tail')
  })

  it('handles a code block being streamed without splitting it', () => {
    const partial = '```ts\nconst x = 1\n\nconst y = 2'
    const parts = renderStreamingMarkdownParts(partial)
    expect(parts).toHaveLength(1)
    expect(parts[0].key).toBe('tail')
  })
})

describe('renderMarkdownParts', () => {
  it('returns one part per block, all with done: keys', () => {
    const parts = renderMarkdownParts('alpha\n\nbeta')
    expect(parts).toHaveLength(2)
    expect(parts.every(p => p.key.startsWith('done:'))).toBe(true)
  })
})
