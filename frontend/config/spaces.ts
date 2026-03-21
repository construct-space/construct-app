/**
 * Space theme definitions — dynamic registry populated from loaded manifests.
 *
 * getSpace() returns theme info (icon, label, color, bg) for a given space ID.
 * Themes are registered at runtime when spaces are loaded from disk.
 * Falls back to generic defaults for unknown spaces.
 */
export interface SpaceConfig {
  icon: string
  label: string
  description: string
  color: string   // Tailwind text color class
  bg: string      // Tailwind bg color class (low opacity, for chips/badges)
}

/** Runtime cache of space themes — populated from manifests */
const spaceThemes = new Map<string, SpaceConfig>()

/**
 * Register a space theme from a loaded manifest.
 * Called when spaces are loaded from disk.
 */
export function registerSpaceTheme(id: string, config: Partial<SpaceConfig>): void {
  spaceThemes.set(id, {
    icon: config.icon || 'i-lucide-box',
    label: config.label || id.charAt(0).toUpperCase() + id.slice(1),
    description: config.description || '',
    color: config.color || 'text-[var(--app-muted)]',
    bg: config.bg || 'bg-[var(--app-muted)]/10',
  })
}

/**
 * Get theme info for a space. Checks runtime registry first, falls back to generic defaults.
 */
export function getSpace(name: string): SpaceConfig {
  return spaceThemes.get(name) ?? {
    icon: 'i-lucide-box',
    label: name.charAt(0).toUpperCase() + name.slice(1),
    description: '',
    color: 'text-[var(--app-muted)]',
    bg: 'bg-[var(--app-muted)]/10',
  }
}

/**
 * Get all registered space IDs.
 */
export function getRegisteredSpaceIds(): string[] {
  return Array.from(spaceThemes.keys())
}
