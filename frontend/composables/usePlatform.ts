/**
 * usePlatform — cached OS detection for chrome that differs per platform.
 *
 * macOS uses native traffic lights (overlay title bar); Windows/Linux are
 * frameless and draw their own min/max/close controls in the TitleBar. We need
 * the OS synchronously-ish in the title bar, so the result is resolved once and
 * cached. Falls back to userAgent when the Tauri OS plugin isn't available.
 */
import { ref } from 'vue'

export type OS = 'macos' | 'windows' | 'linux' | 'other'

const os = ref<OS>('other')
const resolved = ref(false)

function uaGuess(): OS {
  try {
    const ua = navigator.userAgent
    if (/Mac OS X|Macintosh/i.test(ua)) return 'macos'
    if (/Windows/i.test(ua)) return 'windows'
    if (/Linux|X11/i.test(ua)) return 'linux'
  } catch { /* ignore */ }
  return 'other'
}

// Optimistic synchronous guess so the first paint is right; the Tauri plugin
// (authoritative) confirms it just after.
if (!resolved.value) os.value = uaGuess()

let initStarted = false
async function init(): Promise<void> {
  if (initStarted) return
  initStarted = true
  try {
    const { platform } = await import('@tauri-apps/plugin-os')
    const p = platform() // Tauri 2: sync, returns 'macos' | 'windows' | 'linux' | …
    os.value = p === 'macos' || p === 'windows' || p === 'linux' ? p : 'other'
  } catch { /* not Tauri — keep the UA guess */ }
  resolved.value = true
}

export function usePlatform() {
  void init()
  return {
    os,
    isMac: () => os.value === 'macos',
    isWindows: () => os.value === 'windows',
    isLinux: () => os.value === 'linux',
    // Custom window controls live on the frameless platforms.
    usesCustomChrome: () => os.value === 'windows' || os.value === 'linux',
  }
}
