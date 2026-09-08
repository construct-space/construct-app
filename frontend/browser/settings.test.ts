import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BROWSER_SETTINGS,
  INTERNAL_BROWSER_SETTINGS_URL,
  normalizeBrowserTarget,
  normalizeHomeUrl,
  sanitizeBrowserSettings,
  searchUrlForQuery,
} from './settings'

describe('browser settings helpers', () => {
  it('normalizes home urls conservatively', () => {
    expect(normalizeHomeUrl('construct.space')).toBe('https://construct.space')
    expect(normalizeHomeUrl(INTERNAL_BROWSER_SETTINGS_URL)).toBe(INTERNAL_BROWSER_SETTINGS_URL)
    expect(normalizeHomeUrl('not a url')).toBe(DEFAULT_BROWSER_SETTINGS.homeUrl)
  })

  it('sanitizes persisted settings payloads', () => {
    expect(sanitizeBrowserSettings({
      homeUrl: 'dark.com',
      searchEngine: 'duckduckgo',
      openExternalLinksInNewTab: false,
      theme: 'light',
      defaultZoom: 1.2,
      openDownloadsInFolder: true,
    })).toEqual({
      homeUrl: 'https://dark.com',
      searchEngine: 'duckduckgo',
      openExternalLinksInNewTab: false,
      zoomByOrigin: {},
      pinnedTabUrls: [],
      theme: 'light',
      defaultZoom: 1.2,
      openDownloadsInFolder: true,
    })

    expect(sanitizeBrowserSettings({ searchEngine: 'bing' })).toEqual(DEFAULT_BROWSER_SETTINGS)
  })

  it('turns free text into the active search engine url', () => {
    expect(searchUrlForQuery('tailwind themes', 'google')).toContain('google.com/search')
    expect(normalizeBrowserTarget('tailwind themes', {
      ...DEFAULT_BROWSER_SETTINGS,
      searchEngine: 'kagi',
    })).toContain('kagi.com/search?q=tailwind%20themes')
  })

  it('keeps internal browser pages and plain urls intact', () => {
    expect(normalizeBrowserTarget(INTERNAL_BROWSER_SETTINGS_URL, DEFAULT_BROWSER_SETTINGS))
      .toBe(INTERNAL_BROWSER_SETTINGS_URL)
    expect(normalizeBrowserTarget('https://dark.com', DEFAULT_BROWSER_SETTINGS))
      .toBe('https://dark.com')
    expect(normalizeBrowserTarget('dark.com', DEFAULT_BROWSER_SETTINGS))
      .toBe('https://dark.com')
  })
})
