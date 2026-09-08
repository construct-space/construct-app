/**
 * Cross-platform path utilities.
 * Handles both Unix (/) and Windows (\) separators.
 */

/** Extract the last segment of a path (file or folder name). */
export function basenamePath(path: string): string {
  if (!path) return ''
  // Normalize separators, strip trailing
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const idx = normalized.lastIndexOf('/')
  return idx >= 0 ? normalized.slice(idx + 1) : normalized
}

/** Shorten a path by replacing the home directory with ~. */
export function shortenHomePath(path: string, homeDir?: string): string {
  if (!path) return ''
  const home = homeDir || guessHomeDir(path)
  if (!home) return path

  const normalPath = path.replace(/\\/g, '/')
  const normalHome = home.replace(/\\/g, '/').replace(/\/+$/, '')

  if (normalPath.startsWith(normalHome + '/')) {
    return '~' + normalPath.slice(normalHome.length)
  }
  if (normalPath === normalHome) {
    return '~'
  }
  return path
}

/** Normalize path separators to forward slashes. */
export function normalizeSeparators(path: string): string {
  return path.replace(/\\/g, '/')
}

/** Extract the parent directory of a path. */
export function dirnamePath(path: string): string {
  if (!path) return ''
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const idx = normalized.lastIndexOf('/')
  return idx > 0 ? normalized.slice(0, idx) : normalized.slice(0, 1)
}

/** Guess the home directory from a path (works for /Users/x, /home/x, C:\Users\x). */
function guessHomeDir(path: string): string | null {
  const normalized = path.replace(/\\/g, '/')
  // macOS: /Users/username
  const macMatch = normalized.match(/^(\/Users\/[^/]+)/)
  if (macMatch) return macMatch[1]
  // Linux: /home/username
  const linuxMatch = normalized.match(/^(\/home\/[^/]+)/)
  if (linuxMatch) return linuxMatch[1]
  // Windows: C:/Users/username
  const winMatch = normalized.match(/^([A-Z]:\/Users\/[^/]+)/i)
  if (winMatch) return winMatch[1]
  return null
}
