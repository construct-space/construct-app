import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useBrowserHistoryStore } from './browserHistory'

describe('browserHistory store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('adds new entry', () => {
    const store = useBrowserHistoryStore()
    store.add({
      url: 'https://example.com',
      title: 'Example',
      favicon: null,
    })

    expect(store.entries).toHaveLength(1)
    expect(store.entries[0].url).toBe('https://example.com')
    expect(store.entries[0].visitCount).toBe(1)
  })

  it('updates existing entry and moves to front', () => {
    const store = useBrowserHistoryStore()
    store.add({
      url: 'https://example.com',
      title: 'Example',
      favicon: null,
    })
    store.add({
      url: 'https://other.com',
      title: 'Other',
      favicon: null,
    })

    // Add first URL again
    store.add({
      url: 'https://example.com',
      title: 'Example Updated',
      favicon: 'favicon.ico',
    })

    expect(store.entries).toHaveLength(2)
    expect(store.entries[0].url).toBe('https://example.com')
    expect(store.entries[0].visitCount).toBe(2)
    expect(store.entries[0].title).toBe('Example Updated')
    expect(store.entries[0].favicon).toBe('favicon.ico')
  })

  it('caps entries at MAX_ENTRIES (5000)', { timeout: 30000 }, () => {
    const store = useBrowserHistoryStore()

    // Add 5001 entries
    for (let i = 0; i < 5001; i++) {
      store.add({
        url: `https://example${i}.com`,
        title: `Example ${i}`,
        favicon: null,
      })
    }

    expect(store.entries.length).toBeLessThanOrEqual(5000)
    expect(store.entries).toHaveLength(5000)
    // Most recent should be first
    expect(store.entries[0].url).toBe('https://example5000.com')
    // Oldest should be dropped
    expect(store.entries.some(e => e.url === 'https://example0.com')).toBe(false)
  })

  it('searches by URL', () => {
    const store = useBrowserHistoryStore()
    store.add({
      url: 'https://google.com/search',
      title: 'Google',
      favicon: null,
    })
    store.add({
      url: 'https://github.com/user/repo',
      title: 'GitHub',
      favicon: null,
    })
    store.add({
      url: 'https://github.com/other/project',
      title: 'GitHub Project',
      favicon: null,
    })

    const results = store.search('github')
    expect(results).toHaveLength(2)
    expect(results.every(e => e.url.includes('github.com'))).toBe(true)
  })

  it('searches by title', () => {
    const store = useBrowserHistoryStore()
    store.add({
      url: 'https://example.com',
      title: 'Google Search',
      favicon: null,
    })
    store.add({
      url: 'https://other.com',
      title: 'GitHub Repo',
      favicon: null,
    })

    const results = store.search('google')
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Google Search')
  })

  it('search is case-insensitive', () => {
    const store = useBrowserHistoryStore()
    store.add({
      url: 'https://EXAMPLE.COM',
      title: 'Example',
      favicon: null,
    })

    const results = store.search('example')
    expect(results).toHaveLength(1)
  })

  it('returns recent entries with limit', () => {
    const store = useBrowserHistoryStore()

    for (let i = 0; i < 30; i++) {
      store.add({
        url: `https://example${i}.com`,
        title: `Example ${i}`,
        favicon: null,
      })
    }

    const recent = store.getRecent(10)
    expect(recent).toHaveLength(10)
    // Most recent should be first
    expect(recent[0].url).toBe('https://example29.com')
  })

  it('removes entry by id', () => {
    const store = useBrowserHistoryStore()
    store.add({
      url: 'https://example.com',
      title: 'Example',
      favicon: null,
    })

    const id = store.entries[0].id
    store.remove(id)

    expect(store.entries).toHaveLength(0)
  })

  it('clears all entries', () => {
    const store = useBrowserHistoryStore()

    for (let i = 0; i < 10; i++) {
      store.add({
        url: `https://example${i}.com`,
        title: `Example ${i}`,
        favicon: null,
      })
    }

    store.clear()
    expect(store.entries).toHaveLength(0)
  })

  it('generates unique IDs', () => {
    const store = useBrowserHistoryStore()
    const ids = new Set<string>()

    for (let i = 0; i < 100; i++) {
      store.add({
        url: `https://unique${i}.com`,
        title: `Unique ${i}`,
        favicon: null,
      })
    }

    // Collect all IDs from entries
    for (const entry of store.entries) {
      ids.add(entry.id)
    }

    // All 100 entries should have unique IDs
    expect(ids.size).toBe(100)
    // No duplicate IDs
    expect(store.entries.length).toBe(100)
  })
})
