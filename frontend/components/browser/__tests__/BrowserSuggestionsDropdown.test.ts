import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import BrowserSuggestionsDropdown from '../BrowserSuggestionsDropdown.vue'

describe('BrowserSuggestionsDropdown', () => {
  // Task 33: Verify suggestions ranking by bookmarks first, then history

  const mockSuggestions = [
    {
      id: '1',
      title: 'History Page 1',
      url: 'https://example.com/history1',
      source: 'history' as const,
      score: 100,
    },
    {
      id: '2',
      title: 'Bookmarked Page',
      url: 'https://example.com/bookmark',
      source: 'bookmark' as const,
      score: 50,
    },
    {
      id: '3',
      title: 'History Page 2',
      url: 'https://example.com/history2',
      source: 'history' as const,
      score: 80,
    },
    {
      id: '4',
      title: 'Another Bookmark',
      url: 'https://example.com/bookmark2',
      source: 'bookmark' as const,
      score: 90,
    },
  ]

  it('renders suggestion list', () => {
    const wrapper = mount(BrowserSuggestionsDropdown, {
      props: {
        suggestions: mockSuggestions,
        address: 'https://example.com',
      },
    })

    const items = wrapper.findAll('.suggestion-item')
    expect(items.length).toBe(mockSuggestions.length)
  })

  it('ranks bookmarks before history', () => {
    const wrapper = mount(BrowserSuggestionsDropdown, {
      props: {
        suggestions: mockSuggestions,
        address: 'https://example.com',
      },
    })

    const items = wrapper.findAll('.suggestion-item')
    const sources = items.map((item) => {
      const url = item.find('.suggestion-url').text()
      return mockSuggestions.find((s) => s.url === url)?.source
    })

    // All bookmarks should come before history
    const bookmarkIndices = sources
      .map((source, idx) => (source === 'bookmark' ? idx : -1))
      .filter((idx) => idx >= 0)
    const historyIndices = sources
      .map((source, idx) => (source === 'history' ? idx : -1))
      .filter((idx) => idx >= 0)

    if (bookmarkIndices.length > 0 && historyIndices.length > 0) {
      const lastBookmarkIdx = Math.max(...bookmarkIndices)
      const firstHistoryIdx = Math.min(...historyIndices)
      expect(lastBookmarkIdx).toBeLessThan(firstHistoryIdx)
    }
  })

  it('sorts by score within same source', () => {
    // Create suggestions with same source but different scores
    const suggestions = [
      {
        id: '1',
        title: 'Lower Score History',
        url: 'https://example.com/history1',
        source: 'history' as const,
        score: 30,
      },
      {
        id: '2',
        title: 'Higher Score History',
        url: 'https://example.com/history2',
        source: 'history' as const,
        score: 80,
      },
    ]

    const wrapper = mount(BrowserSuggestionsDropdown, {
      props: {
        suggestions,
        address: 'https://example.com',
      },
    })

    const items = wrapper.findAll('.suggestion-item')
    const titles = items.map((item) => item.find('.suggestion-title').text())

    // Higher score should come first
    expect(titles[0]).toBe('Higher Score History')
    expect(titles[1]).toBe('Lower Score History')
  })

  it('supports keyboard navigation', async () => {
    const wrapper = mount(BrowserSuggestionsDropdown, {
      props: {
        suggestions: mockSuggestions,
        address: 'https://example.com',
      },
    })

    // Initial selection should be 0
    let items = wrapper.findAll('.suggestion-item')
    expect(items[0].classes()).toContain('suggestion-item--selected')

    // Arrow down should move selection
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
    })
    window.dispatchEvent(event)
    await wrapper.vm.$nextTick()

    items = wrapper.findAll('.suggestion-item')
    expect(items[1].classes()).toContain('suggestion-item--selected')
  })

  it('has proper ARIA attributes for accessibility', async () => {
    const wrapper = mount(BrowserSuggestionsDropdown, {
      props: {
        suggestions: mockSuggestions,
        address: 'https://example.com',
      },
    })

    // Check main dropdown has role
    expect(wrapper.find('.suggestions-dropdown').attributes('role')).toBe('listbox')
    expect(wrapper.find('.suggestions-dropdown').attributes('aria-label')).toBeDefined()

    // Check items have role and aria-selected
    const items = wrapper.findAll('[role="option"]')
    expect(items.length).toBe(mockSuggestions.length)
    expect(items[0].attributes('aria-selected')).toBe('true')
  })

  it('emits select event on selection', async () => {
    const wrapper = mount(BrowserSuggestionsDropdown, {
      props: {
        suggestions: mockSuggestions,
        address: 'https://example.com',
      },
    })

    // Due to ranking, the first suggestion should be a bookmark
    await wrapper.find('.suggestion-item').trigger('click')

    expect(wrapper.emitted('select')).toBeTruthy()
    const emittedSuggestion = wrapper.emitted('select')?.[0]?.[0]
    // First item should be a bookmark (due to ranking)
    expect(emittedSuggestion?.source).toBe('bookmark')
  })
})
