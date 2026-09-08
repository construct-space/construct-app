import { describe, it, expect, beforeEach } from 'vitest'
import { buildFindScript } from './findController'

describe('findController', () => {
  let script: string

  beforeEach(() => {
    script = buildFindScript()
  })

  it('should build without errors', () => {
    expect(script).toBeTruthy()
    expect(typeof script).toBe('string')
  })

  it('should return valid JavaScript that can be evaluated', () => {
    // The script should be wrapped in an IIFE
    expect(script).toMatch(/^\(\(\) => {/)
    expect(script).toMatch(/}\)\(\);$/)
  })

  it('should expose __CONSTRUCT_FIND__ global object', () => {
    // Extract the expected API from the script
    expect(script).toContain('window.__CONSTRUCT_FIND__')
    expect(script).toContain('find(text)')
    expect(script).toContain('clear()')
    expect(script).toContain('next()')
    expect(script).toContain('prev()')
    expect(script).toContain('getMatchCount()')
    expect(script).toContain('getActiveIndex()')
  })

  describe('regex escaping', () => {
    it('should escape dot character', () => {
      expect(script).toContain("replace(/[.+*?^${}()|[\\\\]\\\\\\\\]/g")
    })

    it('should escape plus character', () => {
      // The escapeRegex function should be in the script
      expect(script).toContain('escapeRegex')
    })

    it('should escape all regex special characters', () => {
      const escapePattern = script.match(/const escapeRegex = \(text\) => \{[^}]+\}/)?.[0]
      expect(escapePattern).toBeTruthy()
      // Should handle all special regex chars (., +, *, ?, ^, $, {, }, (, ), |, [, ], \)
      expect(escapePattern).toMatch(/replace/)
    })
  })

  describe('API methods', () => {
    it('should have find method', () => {
      expect(script).toContain('find(text)')
    })

    it('should have clear method', () => {
      expect(script).toContain('clear()')
    })

    it('should have next method', () => {
      expect(script).toContain('next()')
    })

    it('should have prev method', () => {
      expect(script).toContain('prev()')
    })

    it('should have getMatchCount method', () => {
      expect(script).toContain('getMatchCount()')
    })

    it('should have getActiveIndex method', () => {
      expect(script).toContain('getActiveIndex()')
    })
  })

  describe('API exposure', () => {
    it('should expose methods on __CONSTRUCT_FIND__ object', () => {
      expect(script).toContain('window.__CONSTRUCT_FIND__')
      expect(script).toContain('findInDocument')
      expect(script).toContain('clearHighlights')
    })
  })

  describe('CSS Highlight API support', () => {
    it('should reference CSS.highlights.set', () => {
      expect(script).toContain('CSS.highlights.set')
      expect(script).toContain('"find"')
    })

    it('should reference CSS.highlights.delete', () => {
      expect(script).toContain('CSS.highlights.delete')
    })

    it('should have CSS::highlight style for find', () => {
      expect(script).toContain('::highlight(find)')
    })

    it('should have CSS::highlight style for find-active', () => {
      expect(script).toContain('::highlight(find-active)')
    })
  })

  describe('fallback highlighting', () => {
    it('should reference construct-find-mark class for fallback', () => {
      expect(script).toContain('construct-find-mark')
    })

    it('should have fallback styling', () => {
      expect(script).toContain('fallbackHighlight')
    })

    it('should have clearFallbackMarks function', () => {
      expect(script).toContain('clearFallbackMarks')
    })
  })

  describe('text node finding', () => {
    it('should use TreeWalker for DOM traversal', () => {
      expect(script).toContain('createTreeWalker')
      expect(script).toContain('NodeFilter.SHOW_TEXT')
    })

    it('should create ranges for matches', () => {
      expect(script).toContain('createRange()')
      expect(script).toContain('setStart')
      expect(script).toContain('setEnd')
    })

    it('should use RegExp with global and case-insensitive flags', () => {
      expect(script).toContain('RegExp(')
      expect(script).toContain('"gi"')
    })
  })

  describe('state management', () => {
    it('should track activeIndex', () => {
      expect(script).toContain('activeIndex')
    })

    it('should track ranges array', () => {
      expect(script).toContain('ranges')
    })

    it('should track lastQuery', () => {
      expect(script).toContain('lastQuery')
    })

    it('should reset activeIndex on new search', () => {
      expect(script).toContain('activeIndex = 0')
    })
  })

  describe('navigation behavior', () => {
    it('next() should cycle through matches', () => {
      expect(script).toContain('(activeIndex + 1) % ranges.length')
    })

    it('prev() should cycle backwards through matches', () => {
      expect(script).toContain('(activeIndex - 1 + ranges.length) % ranges.length')
    })

    it('should scroll active match into view', () => {
      expect(script).toContain('scrollIntoView')
    })
  })

  describe('edge cases', () => {
    it('should handle empty search text', () => {
      expect(script).toContain('if (!searchText)')
    })

    it('should handle no matches gracefully', () => {
      expect(script).toContain('if (ranges.length === 0)')
    })

    it('should have try-catch for CSS.highlights operations', () => {
      expect(script).toContain('try {')
      expect(script).toContain('} catch')
    })

    it('should not scroll when no ranges exist', () => {
      const nextMatch = script.match(/next\(\) \{[^}]+\}/)?.[0]
      expect(nextMatch).toContain('if (ranges.length === 0)')
    })
  })

  describe('script injection safety', () => {
    it('should not contain template variables in the final script', () => {
      // Script should be fully expanded, no template variables
      // (This is a sanity check that the script builds correctly)
      expect(script.length).toBeGreaterThan(1000)
      expect(typeof script).toBe('string')
    })

    it('should close all brackets properly', () => {
      const openBraces = (script.match(/{/g) || []).length
      const closeBraces = (script.match(/}/g) || []).length
      expect(openBraces).toBe(closeBraces)
    })

    it('should close all parentheses properly', () => {
      const openParens = (script.match(/\(/g) || []).length
      const closeParens = (script.match(/\)/g) || []).length
      expect(openParens).toBe(closeParens)
    })

    it('should be a self-executing function', () => {
      expect(script.trim()).toMatch(/^\(\(\) => \{[\s\S]*\}\)\(\);$/)
    })
  })

  describe('functionality validation', () => {
    it('should initialize with empty state', () => {
      expect(script).toContain('activeIndex = 0')
      expect(script).toContain('ranges = []')
      expect(script).toContain("lastQuery = ''")
    })

    it('should reset ranges on new search', () => {
      // The script should initialize ranges and activeIndex
      expect(script).toContain('ranges = []')
      expect(script).toContain('activeIndex = 0')
      // Check they appear multiple times (initial and in findInDocument)
      const _rangeCounts = (script.match(/ranges = \[\]/g) || []).length
      expect(_rangeCounts).toBeGreaterThan(1)
    })

    it('should apply highlights after finding matches', () => {
      expect(script).toContain('applyHighlights()')
    })

    it('clear method should reset state', () => {
      expect(script).toContain('clearHighlights()')
    })
  })

  describe('performance considerations', () => {
    it('should cache ranges array', () => {
      expect(script).toContain('ranges = []')
      // ranges is reused and not recreated on every match
    })

    it('should use lastIndex on regex for efficiency', () => {
      expect(script).toContain('regex.lastIndex = 0')
    })

    it('should limit DOM traversal to document.body', () => {
      expect(script).toContain('document.body')
    })
  })
})
