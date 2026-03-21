import { ref, watch, onMounted, onUnmounted } from 'vue'
import { SHORTCUT_REGISTRY, getKey } from './useShortcutStore'

const isTauri = () => !!(window as unknown as { __TAURI__?: unknown }).__TAURI__

// Track whether global shortcuts are enabled (persisted in localStorage)
const ENABLED_KEY = 'construct_global_shortcuts_enabled'
const _enabled = ref<boolean>(false)
const _accessibilityGranted = ref<boolean | null>(null)

function _loadEnabled() {
  if (typeof localStorage === 'undefined') return
  _enabled.value = localStorage.getItem(ENABLED_KEY) === 'true'
}
_loadEnabled()

function _saveEnabled() {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(ENABLED_KEY, String(_enabled.value))
}

// Check macOS accessibility permission via our Rust command
async function _checkAccessibility(prompt: boolean): Promise<boolean> {
  if (!isTauri()) return true
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const granted = await invoke<boolean>('check_accessibility_permission', { prompt })
    _accessibilityGranted.value = granted
    return granted
  } catch {
    // Command not available — assume granted (non-macOS or older build)
    _accessibilityGranted.value = true
    return true
  }
}

// Convert our shortcut format (cmd+shift+space) to Tauri format (CommandOrControl+Shift+Space)
function toTauriAccelerator(keyStr: string): string {
  return keyStr
    .split('+')
    .map(part => {
      if (part === 'cmd' || part === 'ctrl') return 'CommandOrControl'
      if (part === 'shift') return 'Shift'
      if (part === 'alt') return 'Alt'
      if (part === 'space') return 'Space'
      if (part === 'Escape') return 'Escape'
      if (part === 'Delete') return 'Delete'
      if (part === 'Backspace') return 'Backspace'
      if (part === 'Enter') return 'Return'
      if (part === 'Tab') return 'Tab'
      if (part === '`') return '`'
      if (part === "'") return "'"
      if (part.length === 1) return part.toUpperCase()
      if (part === '[') return '['
      if (part === ']') return ']'
      return part
    })
    .join('+')
}

// Currently registered accelerator strings (for cleanup)
const _registeredAccelerators: string[] = []

async function _unregisterAll() {
  if (!isTauri() || _registeredAccelerators.length === 0) return
  try {
    const { unregisterAll } = await import('@tauri-apps/plugin-global-shortcut')
    await unregisterAll()
  } catch {
    // Plugin not available
  }
  _registeredAccelerators.length = 0
}

async function _registerAll(emit: (id: string) => void) {
  if (!isTauri()) return

  const globalDefs = SHORTCUT_REGISTRY.filter(s => s.space === 'global')
  if (globalDefs.length === 0) return

  try {
    const { register, unregisterAll } = await import('@tauri-apps/plugin-global-shortcut')

    // Unregister stale shortcuts from previous load/HMR cycle
    try { await unregisterAll() } catch { /* ignore */ }

    for (const def of globalDefs) {
      const effectiveKey = getKey(def.id)
      const accelerator = toTauriAccelerator(effectiveKey)

      try {
        await register(accelerator, (event) => {
          if (event.state === 'Pressed') {
            emit(def.id)
          }
        })
        _registeredAccelerators.push(accelerator)
      } catch (err) {
        console.warn(`[GlobalShortcut] Failed to register "${accelerator}" for ${def.id}:`, err)
      }
    }
  } catch {
    console.warn('[GlobalShortcut] Plugin not available')
  }
}

/**
 * Composable that manages system-wide global shortcuts via Tauri.
 * Call this once at the app root (e.g. App.vue).
 *
 * The `handler` callback receives the shortcut `id` (e.g. 'global.toggle-app')
 * whenever a global shortcut is triggered — even when the app is not focused.
 */
export function useGlobalShortcuts(handler: (id: string) => void) {
  const enabled = _enabled
  const accessibilityGranted = _accessibilityGranted

  async function refresh() {
    await _unregisterAll()
    if (_enabled.value) {
      await _registerAll(handler)
    }
  }

  async function setEnabled(value: boolean) {
    if (value) {
      // When enabling, check accessibility permission first (prompts on macOS)
      const granted = await _checkAccessibility(true)
      if (!granted) {
        // Permission not granted — don't enable, user needs to grant in System Settings
        // The macOS prompt has already been shown
        return
      }
    }
    _enabled.value = value
    _saveEnabled()
    refresh()
  }

  // Re-register when enabled state changes
  watch(_enabled, () => refresh())

  const onShortcutsChanged = () => refresh()

  onMounted(async () => {
    // On mount, silently check permission state (no prompt)
    if (_enabled.value) {
      await _checkAccessibility(false)
    }
    refresh()
    window.addEventListener('construct:global-shortcuts-changed', onShortcutsChanged)
  })

  onUnmounted(() => {
    _unregisterAll()
    window.removeEventListener('construct:global-shortcuts-changed', onShortcutsChanged)
  })

  return {
    enabled,
    accessibilityGranted,
    setEnabled,
    refresh,
  }
}
