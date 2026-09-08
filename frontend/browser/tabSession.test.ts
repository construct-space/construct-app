import { describe, it, expect } from 'vitest'
import { useTabSession } from './composables/useTabSession'

describe('useTabSession', () => {
  it('pushes closed tab to stack', () => {
    const session = useTabSession()
    session.pushClosed({ url: 'https://example.com', title: 'Example' })
    expect(session.canReopen()).toBe(true)
  })

  it('pops most recent closed tab', () => {
    const session = useTabSession()
    session.pushClosed({ url: 'https://example.com', title: 'Example' })
    session.pushClosed({ url: 'https://google.com', title: 'Google' })
    const restored = session.popClosed()
    expect(restored?.url).toBe('https://google.com')
  })

  it('caps stack at 10 entries', () => {
    const session = useTabSession()
    for (let i = 0; i < 15; i++) {
      session.pushClosed({ url: `https://site${i}.com`, title: `Site ${i}` })
    }
    const urls = []
    for (let i = 0; i < 10; i++) {
      const tab = session.popClosed()
      if (tab) urls.push(tab.url)
    }
    expect(urls.length).toBe(10)
    expect(urls[0]).toBe('https://site14.com')
  })

  it('clears stack', () => {
    const session = useTabSession()
    session.pushClosed({ url: 'https://example.com', title: 'Example' })
    session.clear()
    expect(session.canReopen()).toBe(false)
  })
})
