import { profileStorage } from '@/lib/profileStorage'

export type BrowserSearchEngine = 'google' | 'duckduckgo' | 'kagi'
export type BrowserTheme = 'dark' | 'light'

export interface BrowserSettings {
  homeUrl: string
  searchEngine: BrowserSearchEngine
  openExternalLinksInNewTab: boolean
  zoomByOrigin: Record<string, number>
  pinnedTabUrls: string[]
  theme: BrowserTheme
  defaultZoom: number
  openDownloadsInFolder: boolean
}

export const DEFAULT_BROWSER_URL = 'https://construct.space'
export const INTERNAL_BROWSER_SETTINGS_URL = 'about:browser'
export const INTERNAL_BLANK_URL = 'about:blank'
export const INTERNAL_BOOKMARKS_URL = 'about:bookmarks'
export const INTERNAL_DOWNLOADS_URL = 'about:downloads'
const BROWSER_SETTINGS_STORAGE_KEY = 'construct:browser:settings:v1'

export const DEFAULT_BROWSER_SETTINGS: BrowserSettings = {
  homeUrl: DEFAULT_BROWSER_URL,
  searchEngine: 'google',
  openExternalLinksInNewTab: true,
  zoomByOrigin: {},
  pinnedTabUrls: [],
  theme: 'dark',
  defaultZoom: 1,
  openDownloadsInFolder: false,
}

export function isInternalBrowserUrl(url: string): boolean {
  return (
    url === INTERNAL_BROWSER_SETTINGS_URL
    || url === INTERNAL_BLANK_URL
    || url === INTERNAL_BOOKMARKS_URL
    || url === INTERNAL_DOWNLOADS_URL
  )
}

export function searchUrlForQuery(query: string, engine: BrowserSearchEngine): string {
  const encoded = encodeURIComponent(query.trim())
  switch (engine) {
    case 'duckduckgo':
      return `https://duckduckgo.com/?q=${encoded}`
    case 'kagi':
      return `https://kagi.com/search?q=${encoded}`
    case 'google':
    default:
      return `https://www.google.com/search?q=${encoded}`
  }
}

export function normalizeHomeUrl(raw: string | null | undefined): string {
  const value = `${raw || ''}`.trim()
  if (!value) return DEFAULT_BROWSER_SETTINGS.homeUrl
  if (
    value === INTERNAL_BROWSER_SETTINGS_URL
    || value === INTERNAL_BLANK_URL
    || value === INTERNAL_BOOKMARKS_URL
    || value === INTERNAL_DOWNLOADS_URL
  ) {
    return value
  }
  if (/^https?:\/\//i.test(value)) return value
  if (value.includes('.') && !value.includes(' ')) return `https://${value}`
  return DEFAULT_BROWSER_SETTINGS.homeUrl
}

export function sanitizeBrowserSettings(raw: unknown): BrowserSettings {
  const value = raw && typeof raw === 'object'
    ? raw as Partial<BrowserSettings>
    : {}

  const searchEngine: BrowserSearchEngine = value.searchEngine === 'duckduckgo'
    || value.searchEngine === 'kagi'
    || value.searchEngine === 'google'
    ? value.searchEngine
    : DEFAULT_BROWSER_SETTINGS.searchEngine

  const theme: BrowserTheme = value.theme === 'light' ? 'light' : 'dark'

  const zoomByOrigin = value.zoomByOrigin && typeof value.zoomByOrigin === 'object'
    ? value.zoomByOrigin as Record<string, number>
    : {}

  const pinnedTabUrls = Array.isArray(value.pinnedTabUrls)
    ? value.pinnedTabUrls.filter((url): url is string => typeof url === 'string')
    : []

  const defaultZoom = typeof value.defaultZoom === 'number' && value.defaultZoom > 0.5 && value.defaultZoom < 2
    ? value.defaultZoom
    : DEFAULT_BROWSER_SETTINGS.defaultZoom

  return {
    homeUrl: normalizeHomeUrl(value.homeUrl),
    searchEngine,
    openExternalLinksInNewTab: value.openExternalLinksInNewTab ?? DEFAULT_BROWSER_SETTINGS.openExternalLinksInNewTab,
    zoomByOrigin,
    pinnedTabUrls,
    theme,
    defaultZoom,
    openDownloadsInFolder: value.openDownloadsInFolder ?? DEFAULT_BROWSER_SETTINGS.openDownloadsInFolder,
  }
}

export function loadBrowserSettings(): BrowserSettings {
  const raw = profileStorage.getItem(BROWSER_SETTINGS_STORAGE_KEY)
  if (!raw) return { ...DEFAULT_BROWSER_SETTINGS }

  try {
    return sanitizeBrowserSettings(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_BROWSER_SETTINGS }
  }
}

export function saveBrowserSettings(next: BrowserSettings): BrowserSettings {
  const normalized = sanitizeBrowserSettings(next)
  profileStorage.setItem(BROWSER_SETTINGS_STORAGE_KEY, JSON.stringify(normalized))
  return normalized
}

export function normalizeBrowserTarget(
  raw: string,
  settings: BrowserSettings,
  fallbackUrl = settings.homeUrl || DEFAULT_BROWSER_SETTINGS.homeUrl,
): string {
  const value = raw.trim()
  if (!value) return fallbackUrl
  if (
    value === INTERNAL_BROWSER_SETTINGS_URL
    || value === INTERNAL_BLANK_URL
    || value === INTERNAL_BOOKMARKS_URL
    || value === INTERNAL_DOWNLOADS_URL
  ) {
    return value
  }
  if (/^(https?:|about:)/i.test(value)) return value
  if (value.includes('.') && !value.includes(' ')) return `https://${value}`
  return searchUrlForQuery(value, settings.searchEngine)
}

function extractOrigin(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export function getZoomForOrigin(url: string, settings: BrowserSettings): number {
  const origin = extractOrigin(url)
  if (!origin) return 1.0
  return settings.zoomByOrigin[origin] ?? 1.0
}

export function setZoomForOrigin(url: string, factor: number, settings: BrowserSettings): void {
  const origin = extractOrigin(url)
  if (!origin) return
  if (factor === 1.0) {
    delete settings.zoomByOrigin[origin]
  } else {
    settings.zoomByOrigin[origin] = factor
  }
}
