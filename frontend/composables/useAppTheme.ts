/**
 * App-wide theme composable
 * Syncs Monaco editor themes with Nuxt UI colors
 */

export interface AppTheme {
  id: string
  name: string
  mode: 'light' | 'dark'
  primary: string
  neutral: string
  // CSS variables for the theme
  colors: {
    background: string
    foreground: string
    muted: string
    accent: string
    accentForeground: string // Text color to use on accent backgrounds
  }
}

// Available app themes that sync with Monaco
export const appThemes: AppTheme[] = [
  {
    id: 'auto',
    name: 'Auto (System)',
    mode: 'dark',
    primary: 'green',
    neutral: 'slate',
    colors: {
      background: '#0f172a',
      foreground: '#f8fafc',
      muted: '#64748b',
      accent: '#34C759',
      accentForeground: '#ffffff',
    }
  },
  {
    id: 'vs',
    name: 'Light',
    mode: 'light',
    primary: 'green',
    neutral: 'slate',
    colors: {
      background: '#ffffff',
      foreground: '#1e293b',
      muted: '#64748b',
      accent: '#34C759',
      accentForeground: '#ffffff',
    }
  },
  {
    id: 'vs-dark',
    name: 'Dark',
    mode: 'dark',
    primary: 'green',
    neutral: 'slate',
    colors: {
      background: '#1e1e1e',
      foreground: '#d4d4d4',
      muted: '#6b7280',
      accent: '#34C759',
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

export const useAppTheme = () => {
  const colorMode = useColorMode()
  const preferencesStore = usePreferencesStore()

  // Current theme ID from preferences (with localStorage fallback)
  const currentThemeId = computed(() => {
    // Fast path: check localStorage first (set before API round-trip)
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored && stored !== 'auto') return stored
    // Then check preferences store (from API)
    const fromPrefs = preferencesStore.editorSettings.theme
    if (fromPrefs && fromPrefs !== 'auto') return fromPrefs
    return 'auto'
  })

  // Get the actual theme object
  const currentTheme = computed(() => {
    const id = currentThemeId.value
    if (id === 'auto') {
      // Return theme based on system preference
      return colorMode.value === 'dark'
        ? appThemes.find(t => t.id === 'vs-dark')!
        : appThemes.find(t => t.id === 'vs')!
    }
    return appThemes.find(t => t.id === id) || appThemes[0]
  })

  // Set theme by ID
  const setTheme = async (themeId: string) => {
    const theme = appThemes.find(t => t.id === themeId)
    if (!theme) return

    // Update color mode
    if (themeId === 'auto') {
      colorMode.value = 'auto'
    } else {
      colorMode.value = theme.mode
    }

    // Save to localStorage for fast initial load
    localStorage.setItem(THEME_STORAGE_KEY, themeId)

    // Save to preferences (API)
    await preferencesStore.setEditorSettings({ theme: themeId })

    // Apply CSS variables
    applyThemeColors(theme)
  }

  // Apply theme CSS variables to document
  const applyThemeColors = (theme: AppTheme) => {
    const root = document.documentElement
    root.style.setProperty('--app-background', theme.colors.background)
    root.style.setProperty('--app-foreground', theme.colors.foreground)
    root.style.setProperty('--app-muted', theme.colors.muted)
    root.style.setProperty('--app-accent', theme.colors.accent)
    root.style.setProperty('--app-accent-foreground', theme.colors.accentForeground)

    // Derive canvas colors from theme
    // Canvas is slightly darker/lighter than background
    const bg = theme.colors.background
    if (theme.mode === 'dark') {
      // Darken background for canvas
      root.style.setProperty('--app-canvas-bg', darkenColor(bg, 0.3))
      root.style.setProperty('--app-status-bg', bg)
      root.style.setProperty('--app-border', lightenColor(bg, 0.15))
    } else {
      // Lighten background for canvas (but still slightly gray)
      root.style.setProperty('--app-canvas-bg', darkenColor(bg, 0.05))
      root.style.setProperty('--app-status-bg', bg)
      root.style.setProperty('--app-border', darkenColor(bg, 0.1))
    }
  }

  // Helper to darken a hex color
  function darkenColor(hex: string, amount: number): string {
    const rgb = hexToRgb(hex)
    if (!rgb) return hex
    return rgbToHex(
      Math.max(0, Math.round(rgb.r * (1 - amount))),
      Math.max(0, Math.round(rgb.g * (1 - amount))),
      Math.max(0, Math.round(rgb.b * (1 - amount)))
    )
  }

  // Helper to lighten a hex color
  function lightenColor(hex: string, amount: number): string {
    const rgb = hexToRgb(hex)
    if (!rgb) return hex
    return rgbToHex(
      Math.min(255, Math.round(rgb.r + (255 - rgb.r) * amount)),
      Math.min(255, Math.round(rgb.g + (255 - rgb.g) * amount)),
      Math.min(255, Math.round(rgb.b + (255 - rgb.b) * amount))
    )
  }

  function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
    if (!result || !result[1] || !result[2] || !result[3]) return null
    return {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    }
  }

  function rgbToHex(r: number, g: number, b: number): string {
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')
  }

  // Initialize theme on mount
  const initTheme = () => {
    const theme = currentTheme.value
    if (!theme) return

    if (theme.id !== 'auto') {
      colorMode.value = theme.mode
    }
    applyThemeColors(theme)
  }

  return {
    themes: appThemes,
    currentThemeId,
    currentTheme,
    setTheme,
    initTheme,
  }
}
