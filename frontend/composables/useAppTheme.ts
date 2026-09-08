/**
 * App-wide theme composable
 * Syncs Monaco editor themes with Nuxt UI colors
 */
import { computed, ref } from 'vue'
import { profileStorage } from '@/lib/profileStorage'

export interface AppTheme {
  id: string
  name: string
  mode: 'light' | 'dark'
  primary: string
  neutral: string
  // CSS variables for the theme. The first five are required — every
  // built-in ships them. The remaining four are optional overrides for
  // `applyThemeColors`'s auto-derived surfaces (canvas, border, panel
  // surface, input background). When a custom theme supplies them the
  // derived computation is skipped; when a built-in omits them the
  // lighten/darken heuristics keep working exactly as before.
  colors: {
    background: string
    foreground: string
    muted: string
    accent: string
    accentForeground: string // Text color to use on accent backgrounds

    // Optional advanced overrides — custom themes only.
    canvasBg?: string
    border?: string
    surface?: string
    inputBg?: string
  }
}

// Available app themes that sync with Monaco
export const appThemes: AppTheme[] = [
  {
    id: 'vs',
    name: 'Light',
    mode: 'light',
    primary: 'red',
    neutral: 'slate',
    colors: {
      background: '#f1f5f9',
      foreground: '#0f172a',
      muted: '#64748b',
      accent: '#E63946',
      accentForeground: '#ffffff',
    }
  },
  {
    id: 'vs-dark',
    name: 'Dark',
    mode: 'dark',
    primary: 'red',
    neutral: 'slate',
    colors: {
      background: '#0f172a',
      foreground: '#e2e8f0',
      muted: '#64748b',
      accent: '#E63946',
      accentForeground: '#ffffff',
    }
  },
  {
    id: 'synthwave-84',
    name: 'Synthwave \'84',
    mode: 'dark',
    primary: 'fuchsia',
    neutral: 'slate',
    colors: {
      background: '#262335',
      foreground: '#ffffff',
      muted: '#848bbd',
      accent: '#ff7edb',
      accentForeground: '#000000',
    }
  },
  {
    id: 'dracula',
    name: 'Dracula',
    mode: 'dark',
    primary: 'purple',
    neutral: 'slate',
    colors: {
      background: '#282a36',
      foreground: '#f8f8f2',
      muted: '#6272a4',
      accent: '#bd93f9',
      accentForeground: '#000000',
    }
  },
  {
    id: 'one-dark',
    name: 'One Dark',
    mode: 'dark',
    primary: 'blue',
    neutral: 'slate',
    colors: {
      background: '#282c34',
      foreground: '#abb2bf',
      muted: '#5c6370',
      accent: '#61afef',
      accentForeground: '#000000',
    }
  },
  {
    id: 'night-owl',
    name: 'Night Owl',
    mode: 'dark',
    primary: 'blue',
    neutral: 'slate',
    colors: {
      background: '#011627',
      foreground: '#d6deeb',
      muted: '#637777',
      accent: '#82aaff',
      accentForeground: '#000000',
    }
  },
  {
    id: 'github-dark',
    name: 'GitHub Dark',
    mode: 'dark',
    primary: 'blue',
    neutral: 'gray',
    colors: {
      background: '#0d1117',
      foreground: '#c9d1d9',
      muted: '#8b949e',
      accent: '#58a6ff',
      accentForeground: '#000000',
    }
  },
  {
    id: 'monokai',
    name: 'Monokai',
    mode: 'dark',
    primary: 'yellow',
    neutral: 'stone',
    colors: {
      background: '#272822',
      foreground: '#f8f8f2',
      muted: '#75715e',
      accent: '#f92672',
      accentForeground: '#ffffff',
    }
  },
  {
    id: 'nord',
    name: 'Nord',
    mode: 'dark',
    primary: 'cyan',
    neutral: 'slate',
    colors: {
      background: '#2e3440',
      foreground: '#d8dee9',
      muted: '#616e88',
      accent: '#88c0d0',
      accentForeground: '#000000',
    }
  },
  {
    id: 'cobalt2',
    name: 'Cobalt2',
    mode: 'dark',
    primary: 'yellow',
    neutral: 'slate',
    colors: {
      background: '#193549',
      foreground: '#ffffff',
      muted: '#0088ff',
      accent: '#ffc600',
      accentForeground: '#000000',
    }
  },
  {
    id: 'material',
    name: 'Material',
    mode: 'dark',
    primary: 'cyan',
    neutral: 'slate',
    colors: {
      background: '#263238',
      foreground: '#eeffff',
      muted: '#546e7a',
      accent: '#89ddff',
      accentForeground: '#000000',
    }
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    mode: 'dark',
    primary: 'indigo',
    neutral: 'slate',
    colors: {
      background: '#1a1b26',
      foreground: '#c0caf5',
      muted: '#565f89',
      accent: '#7aa2f7',
      accentForeground: '#ffffff',
    }
  },
  {
    id: 'hc-black',
    name: 'High Contrast Dark',

    mode: 'dark',
    primary: 'yellow',
    neutral: 'neutral',
    colors: {
      background: '#000000',
      foreground: '#ffffff',
      muted: '#808080',
      accent: '#ffff00',
      accentForeground: '#000000',
    }
  },
  {
    id: 'hc-light',
    name: 'High Contrast Light',
    mode: 'light',
    primary: 'blue',
    neutral: 'neutral',
    colors: {
      background: '#ffffff',
      foreground: '#000000',
      muted: '#808080',
      accent: '#0000ff',
      accentForeground: '#ffffff',
    }
  },
]

// Local storage key for theme (for fast initial load)
const THEME_STORAGE_KEY = 'app-theme-id'
const CUSTOM_THEME_STORAGE_KEY = 'app-custom-theme'

// Load custom theme from storage
function loadCustomTheme(): AppTheme | null {
  const raw = profileStorage.getItem(CUSTOM_THEME_STORAGE_KEY) || localStorage.getItem(CUSTOM_THEME_STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return {
      id: 'custom',
      name: 'Custom',
      mode: parsed.mode || 'dark',
      primary: 'slate',
      neutral: 'slate',
      colors: {
        background: parsed.colors?.background || '#1a1a2e',
        foreground: parsed.colors?.foreground || '#e0e0e0',
        muted: parsed.colors?.muted || '#888888',
        accent: parsed.colors?.accent || '#e94560',
        accentForeground: parsed.colors?.accentForeground || '#ffffff',
      },
    }
  } catch {
    return null
  }
}

// Module-level reactive custom theme
const _customTheme = ref<AppTheme | null>(loadCustomTheme())

// Module-level reactive ref for theme ID — survives across useAppTheme() calls
// Default to dark theme (vs-dark) — most users expect dark mode in a dev tool
//
// Initial value reads from profileStorage with `_activeProfileId = 'default'`
// (the active profile is set later, inside `bootstrapMain` → profile.init()).
// `reloadThemeFromStorage` rehydrates these refs once the real profile id is
// known so the persisted theme survives reload.
const _themeId = ref(profileStorage.getItem(THEME_STORAGE_KEY) || localStorage.getItem(THEME_STORAGE_KEY) || 'vs-dark')

// Hex helpers — module-scoped so `applyThemeToDocument` can run outside the
// composable closure (e.g. from `reloadThemeFromStorage` after profile init).
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!result || !result[1] || !result[2] || !result[3]) return null
  return { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')
}

function darkenColor(hex: string, amount: number): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  return rgbToHex(
    Math.max(0, Math.round(rgb.r * (1 - amount))),
    Math.max(0, Math.round(rgb.g * (1 - amount))),
    Math.max(0, Math.round(rgb.b * (1 - amount))),
  )
}

function lightenColor(hex: string, amount: number): string {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  return rgbToHex(
    Math.min(255, Math.round(rgb.r + (255 - rgb.r) * amount)),
    Math.min(255, Math.round(rgb.g + (255 - rgb.g) * amount)),
    Math.min(255, Math.round(rgb.b + (255 - rgb.b) * amount)),
  )
}

function applyThemeToDocument(theme: AppTheme) {
  const root = document.documentElement
  const c = theme.colors
  root.style.setProperty('--app-background', c.background)
  root.style.setProperty('--app-foreground', c.foreground)
  root.style.setProperty('--app-muted', c.muted)
  root.style.setProperty('--app-accent', c.accent)
  root.style.setProperty('--app-accent-foreground', c.accentForeground)

  const bg = c.background
  const derived = theme.mode === 'dark'
    ? {
        canvas: darkenColor(bg, 0.3),
        border: lightenColor(bg, 0.15),
        surface: lightenColor(bg, 0.08),
        input: lightenColor(bg, 0.05),
      }
    : {
        canvas: darkenColor(bg, 0.05),
        border: darkenColor(bg, 0.1),
        surface: darkenColor(bg, 0.02),
        input: darkenColor(bg, 0.04),
      }
  root.style.setProperty('--app-canvas-bg', c.canvasBg || derived.canvas)
  root.style.setProperty('--app-status-bg', bg)
  root.style.setProperty('--app-border', c.border || derived.border)
  const surface = c.surface || derived.surface
  const inputBg = c.inputBg || derived.input
  root.style.setProperty('--app-surface', surface)
  root.style.setProperty('--app-input-bg', inputBg)
  root.style.setProperty('--app-card-bg', surface)
  root.style.setProperty('--app-card-hover', inputBg)
  document.documentElement.classList.toggle('dark', theme.mode === 'dark')
}

function resolveTheme(id: string, osDark: boolean): AppTheme | null {
  if (id === 'auto') return osDark ? appThemes.find(t => t.id === 'vs-dark')! : appThemes.find(t => t.id === 'vs')!
  if (id === 'custom') return _customTheme.value
  return appThemes.find(t => t.id === id) || null
}

/**
 * Re-read theme + custom theme from profileStorage and re-apply to the DOM.
 * Called from `profileStore.init()` / `switchProfile()` after `setActiveProfileId`
 * runs — the initial module-level refs were populated against the `default`
 * profile namespace before the real profile id was known.
 */
export function reloadThemeFromStorage() {
  const stored = profileStorage.getItem(THEME_STORAGE_KEY)
  if (stored) _themeId.value = stored
  _customTheme.value = loadCustomTheme()

  const osDark = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-color-scheme: dark)').matches !== false : true
  const resolved = resolveTheme(_themeId.value, osDark)
  if (resolved) applyThemeToDocument(resolved)
}

export const useAppTheme = () => {
  const preferencesStore = usePreferencesStore()

  // Reactive theme ID
  const currentThemeId = computed(() => _themeId.value)

  // Reactive OS dark mode preference — detect via media query, sync via Tauri
  const osDark = ref(typeof window !== 'undefined' ? window.matchMedia?.('(prefers-color-scheme: dark)').matches !== false : true)

  // All themes including custom
  const allThemes = computed(() => {
    const list = [...appThemes]
    if (_customTheme.value) list.push(_customTheme.value)
    return list
  })

  // Get the actual theme object (auto resolves to vs/vs-dark based on OS)
  const currentTheme = computed(() => {
    const id = currentThemeId.value
    if (id === 'auto') {
      return osDark.value
        ? appThemes.find(t => t.id === 'vs-dark')!
        : appThemes.find(t => t.id === 'vs')!
    }
    if (id === 'custom' && _customTheme.value) return _customTheme.value
    return appThemes.find(t => t.id === id) || appThemes[0]
  })

  // Set theme by ID (supports 'auto' which resolves to vs/vs-dark)
  const setTheme = async (themeId: string) => {
    // Update reactive ref + profile-scoped localStorage
    _themeId.value = themeId
    profileStorage.setItem(THEME_STORAGE_KEY, themeId)

    // Resolve the actual theme to apply
    const resolved = themeId === 'auto'
      ? (osDark.value ? appThemes.find(t => t.id === 'vs-dark')! : appThemes.find(t => t.id === 'vs')!)
      : themeId === 'custom' ? _customTheme.value
      : appThemes.find(t => t.id === themeId)

    if (!resolved) return

    // Set dark/light class on html
    document.documentElement.classList.toggle('dark', resolved.mode === 'dark')
    applyThemeColors(resolved)


    // Save to preferences (API)
    await preferencesStore.setEditorSettings({ theme: themeId })
  }

  // Apply theme CSS variables to document — delegates to the module-level
  // helper so `reloadThemeFromStorage` can re-apply without instantiating
  // the composable.
  const applyThemeColors = applyThemeToDocument

  // Initialize theme on mount + watch OS changes for auto mode
  const initTheme = () => {
    const theme = currentTheme.value
    if (!theme) return

    // Set dark/light class on html
    document.documentElement.classList.toggle('dark', theme.mode === 'dark')
    applyThemeColors(theme)

    // Listen for OS dark/light changes
    const applyAutoIfNeeded = () => {
      if (currentThemeId.value === 'auto') {
        const resolved = currentTheme.value
        document.documentElement.classList.toggle('dark', resolved.mode === 'dark')
        applyThemeColors(resolved)
      }
    }

    // Web: media query listener
    if (typeof window !== 'undefined') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      mq.addEventListener('change', (e) => {
        osDark.value = e.matches
        applyAutoIfNeeded()
      })
    }

    // Tauri: native theme change listener
    ;(async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        const win = getCurrentWindow()
        const theme = await win.theme()
        if (theme) {
          osDark.value = theme === 'dark'
          applyAutoIfNeeded()
        }
        await win.onThemeChanged(({ payload }) => {
          osDark.value = payload === 'dark'
          applyAutoIfNeeded()
        })
      } catch { /* not in Tauri */ }
    })()
  }

  // Save a custom theme and optionally activate it
  const saveCustomTheme = async (mode: 'light' | 'dark', colors: AppTheme['colors']) => {
    const theme: AppTheme = {
      id: 'custom',
      name: 'Custom',
      mode,
      primary: 'slate',
      neutral: 'slate',
      colors,
    }
    _customTheme.value = theme
    profileStorage.setItem(CUSTOM_THEME_STORAGE_KEY, JSON.stringify({ mode, colors }))
    // Apply immediately if custom is active
    if (_themeId.value === 'custom') {
      document.documentElement.classList.toggle('dark', mode === 'dark')
      applyThemeColors(theme)
    }
  }

  // Delete custom theme, fall back to default dark
  const deleteCustomTheme = async () => {
    _customTheme.value = null
    profileStorage.removeItem(CUSTOM_THEME_STORAGE_KEY)
    if (_themeId.value === 'custom') {
      await setTheme('vs-dark')
    }
  }

  return {
    themes: appThemes,
    allThemes,
    customTheme: _customTheme,
    currentThemeId,
    currentTheme,
    setTheme,
    initTheme,
    saveCustomTheme,
    deleteCustomTheme,
  }
}
