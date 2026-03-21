/**
 * Google Fonts composable for the UI designer
 * Uses bundled font catalog for instant access to 1700+ Google Fonts
 */

// Import bundled font catalog (no API calls needed)
import googleFontsData from '~/data/google-fonts.json'

export interface GoogleFont {
  family: string
  category: string
}

// Cache for loaded fonts
const loadedFonts = new Set<string>()
const loadingFonts = new Map<string, Promise<boolean>>()
const cachedFonts = new Set<string>()
const FONT_CACHE_STORAGE_KEY = 'ui.googleFonts.cachedFamilies'
const MAX_CACHED_FONTS = 120
let hasHydratedCache = false


// Font catalog from bundled JSON
const fontCatalog: GoogleFont[] = googleFontsData as GoogleFont[]
const fontCatalogFamilySet = new Set(fontCatalog.map(font => font.family))

// Popular fonts to show first (preloaded in nuxt.config.ts head)
export const POPULAR_FONTS = [
  'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins',
  'Source Sans 3', 'Nunito', 'Playfair Display', 'Merriweather',
  'PT Sans', 'Raleway', 'Ubuntu', 'Oswald', 'Fira Sans', 'Work Sans',
  'DM Sans', 'Space Grotesk', 'JetBrains Mono', 'Fira Code'
]

function sanitizeFontFamily(fontFamily: string): string {
  return fontFamily.trim()
}

function getFontCssHref(fontFamily: string): string {
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontFamily)}:wght@100;200;300;400;500;600;700;800;900&display=swap`
}

function persistCachedFonts() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      FONT_CACHE_STORAGE_KEY,
      JSON.stringify(Array.from(cachedFonts).slice(0, MAX_CACHED_FONTS))
    )
  } catch {
    // Ignore storage failures.
  }
}

function hydrateCachedFonts() {
  if (hasHydratedCache || typeof window === 'undefined') return
  hasHydratedCache = true

  try {
    const raw = window.localStorage.getItem(FONT_CACHE_STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return

    for (const item of parsed) {
      if (typeof item !== 'string') continue
      const family = sanitizeFontFamily(item)
      if (!family) continue
      cachedFonts.add(family)
    }
  } catch {
    // Ignore invalid cache payloads.
  }
}

function rememberCachedFont(fontFamily: string) {
  cachedFonts.delete(fontFamily)
  cachedFonts.add(fontFamily)

  if (cachedFonts.size > MAX_CACHED_FONTS) {
    const oldest = cachedFonts.values().next().value
    if (oldest) cachedFonts.delete(oldest)
  }
  persistCachedFonts()
}

function getExistingFontLink(fontFamily: string): HTMLLinkElement | null {
  if (typeof document === 'undefined') return null
  const links = document.querySelectorAll<HTMLLinkElement>('link[data-google-font-family]')
  for (const link of links) {
    if (link.dataset.googleFontFamily === fontFamily) return link
  }
  return null
}

async function ensureFontStylesheet(fontFamily: string): Promise<void> {
  if (typeof document === 'undefined') return

  const existing = getExistingFontLink(fontFamily)
  if (existing) {
    // Already loaded or has a parsed stylesheet — no work needed.
    if (existing.dataset.loaded === 'true' || !!existing.sheet) {
      existing.dataset.loaded = 'true'
      return
    }
    // Link exists but hasn't loaded yet — wait with a timeout to avoid deadlock.
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        resolve()
      }, 8000)
      const onLoad = () => {
        clearTimeout(timer)
        existing.dataset.loaded = 'true'
        resolve()
      }
      const onError = () => {
        clearTimeout(timer)
        resolve() // resolve, not reject — let the caller try document.fonts.load
      }
      existing.addEventListener('load', onLoad, { once: true })
      existing.addEventListener('error', onError, { once: true })
    })
    return
  }

  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = getFontCssHref(fontFamily)
  link.dataset.googleFontFamily = fontFamily
  link.crossOrigin = 'anonymous'
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      resolve()
    }, 8000)
    link.onload = () => {
      clearTimeout(timer)
      link.dataset.loaded = 'true'
      resolve()
    }
    link.onerror = () => {
      clearTimeout(timer)
      resolve() // resolve — let the caller try document.fonts.load as fallback
    }
    document.head.appendChild(link)
  })
}

/**
 * Load a Google Font on-demand
 */
export async function loadGoogleFont(fontFamily: string): Promise<boolean> {
  if (typeof document === 'undefined') return false
  const family = sanitizeFontFamily(fontFamily)
  if (!family) return false
  hydrateCachedFonts()

  // System/custom fonts don't need Google Fonts loading.
  if (!fontCatalogFamilySet.has(family)) {
    loadedFonts.add(family)
    return true
  }

  // If we already loaded this font in this session, trust the cache.
  // Don't use document.fonts.check() to evict — it's unreliable in WebKit.
  if (loadedFonts.has(family)) {
    return true
  }

  // Check if already loading
  const existingLoad = loadingFonts.get(family)
  if (existingLoad) {
    return existingLoad
  }

  const loadPromise = (async () => {
    try {
      // Inject the Google Fonts stylesheet <link> (deduplicated).
      await ensureFontStylesheet(family)

      // Ask the browser to load the font face from the stylesheet.
      await document.fonts.load(`16px "${family}"`)

      // Mark as loaded — trust the load() call like the original working version.
      // Note: document.fonts.check() can return false in WebKit even after a
      // successful load, so we don't gate on it.
      loadedFonts.add(family)
      rememberCachedFont(family)
      return true
    } catch (error) {
      console.warn(`[useGoogleFonts] Failed to load font "${family}":`, error)
      return false
    } finally {
      loadingFonts.delete(family)
    }
  })()

  loadingFonts.set(family, loadPromise)
  return loadPromise
}

/**
 * Check if a font is loaded
 */
export function isFontLoaded(fontFamily: string): boolean {
  if (typeof document === 'undefined') return false
  const family = sanitizeFontFamily(fontFamily)
  if (!family) return false
  hydrateCachedFonts()
  return loadedFonts.has(family) || document.fonts.check(`16px "${family}"`)
}

/**
 * Preload recently cached fonts so selected fonts are available instantly.
 * Browser HTTP cache stores the actual files; this restores the font-face links.
 */
export async function preloadCachedFonts(limit = 8): Promise<void> {
  if (typeof document === 'undefined') return
  hydrateCachedFonts()
  const candidates = Array.from(cachedFonts).reverse().slice(0, Math.max(0, limit))
  await Promise.all(candidates.map(family => loadGoogleFont(family)))
}

/**
 * Search fonts by name
 */
export function searchFonts(query: string, fonts: GoogleFont[]): GoogleFont[] {
  if (!query.trim()) return fonts
  const lowerQuery = query.toLowerCase()
  return fonts.filter(font =>
    font.family.toLowerCase().includes(lowerQuery)
  )
}

/**
 * Composable for Google Fonts with on-demand loading
 */
export const useGoogleFonts = () => {
  // Sort fonts: popular first, then alphabetically
  const sortedFonts = computed(() => {
    const popular = fontCatalog.filter(f => POPULAR_FONTS.includes(f.family))
    const others = fontCatalog.filter(f => !POPULAR_FONTS.includes(f.family))
    return [...popular, ...others]
  })

  // Font options for USelectMenu (ready immediately, no loading)
  const fontOptions = computed(() =>
    sortedFonts.value.map(font => ({
      label: font.family,
      value: font.family,
      category: font.category
    }))
  )

  return {
    // All fonts (1700+)
    fonts: fontCatalog,
    // Font options for USelectMenu
    fontOptions,
    // Loading state (always false - bundled data)
    isLoading: ref(false),
    // Popular fonts (preloaded)
    popularFonts: POPULAR_FONTS,
    // Load a specific font on-demand
    loadFont: loadGoogleFont,
    // Check if font is loaded
    isFontLoaded
  }
}
