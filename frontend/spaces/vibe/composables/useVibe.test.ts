import { describe, expect, it } from 'vitest'
import { shouldAdoptStoredMessages } from './useVibe'

describe('shouldAdoptStoredMessages', () => {
  it('accepts same-length message updates when content changed', () => {
    const current = [
      { id: 'user-1', role: 'user' as const, content: 'Build it' },
      { id: 'assistant-1', role: 'assistant' as const, content: 'Working' },
    ]
    const stored = [
      { id: 'user-1', role: 'user' as const, content: 'Build it' },
      { id: 'assistant-1', role: 'assistant' as const, content: 'Working on the implementation' },
    ]

    expect(shouldAdoptStoredMessages(current, stored)).toBe(true)
  })

  it('keeps the current messages when storage is behind', () => {
    const current = [
      { id: 'user-1', role: 'user' as const, content: 'Build it' },
      { id: 'assistant-1', role: 'assistant' as const, content: 'Done' },
    ]
    const stored = [
      { id: 'user-1', role: 'user' as const, content: 'Build it' },
    ]

    expect(shouldAdoptStoredMessages(current, stored)).toBe(false)
  })
})
