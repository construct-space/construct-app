import { onMounted, onUnmounted } from 'vue'
import { getKey } from './useShortcutStore'

export interface SpaceShortcut {
  id?: string       // If set, effective key is looked up from the shortcut store (supports remapping)
  key: string       // Default key: 'r', 'cmd+z', 'shift+r', 'cmd+shift+z', 'Escape', "cmd+'"
  label: string     // 'Rectangle tool'
  group?: string    // 'Tools' | 'History' | 'View' | 'File'
  when?: () => boolean  // Shortcut fires only when this returns true
  onPress: () => void
}

interface ParsedKey {
  key: string
  cmd: boolean
  shift: boolean
  alt: boolean
}

const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC')

function parseKey(keyStr: string): ParsedKey {
  const parts = keyStr.split('+')
  let cmd = false
  let shift = false
  let alt = false
  const keyParts: string[] = []

  for (const part of parts) {
    if (part === 'cmd' || part === 'ctrl') {
      cmd = true
    } else if (part === 'shift') {
      shift = true
    } else if (part === 'alt') {
      alt = true
    } else {
      keyParts.push(part)
    }
  }

  return { key: keyParts.join('+'), cmd, shift, alt }
}

function matchesEvent(e: KeyboardEvent, parsed: ParsedKey): boolean {
  const cmdPressed = isMac ? e.metaKey : e.ctrlKey
  if (parsed.cmd !== cmdPressed) return false
  if (parsed.shift !== e.shiftKey) return false
  if (parsed.alt !== e.altKey) return false

  const target = parsed.key

  // Special keys — match case-sensitively
  if (target === 'Escape' || target === 'Delete' || target === 'Backspace' || target === 'Enter' || target === 'Tab') {
    return e.key === target
  }

  // Quote key
  if (target === "'") {
    return e.key === "'" || e.code === 'Quote'
  }

  // Backtick key
  if (target === '`') {
    return e.key === '`' || e.code === 'Backquote'
  }

  // Letter/digit/other keys — match case-insensitively
  return e.key.toLowerCase() === target.toLowerCase()
}

export function useSpaceShortcuts(shortcuts: SpaceShortcut[]): void {
  const handler = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return

    // Skip when focus is in a text input
    const target = e.target as Element
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target as HTMLElement).isContentEditable
    ) return

    for (const shortcut of shortcuts) {
      if (shortcut.when && !shortcut.when()) continue

      // When an id is provided, resolve effective key from store (may be user-remapped)
      const effectiveKey = shortcut.id ? getKey(shortcut.id) || shortcut.key : shortcut.key
      const parsed = parseKey(effectiveKey)
      if (matchesEvent(e, parsed)) {
        e.preventDefault()
        shortcut.onPress()
        return
      }
    }
  }

  onMounted(() => window.addEventListener('keydown', handler))
  onUnmounted(() => window.removeEventListener('keydown', handler))
}
