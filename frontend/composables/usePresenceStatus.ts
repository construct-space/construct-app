/**
 * usePresenceStatus - the user's self-announced availability (Online / Away /
 * Offline), surfaced as a picker in the title bar (like the now-playing
 * player). Host-owned + persisted, so the choice survives space navigation and
 * is the single source of truth any space can read.
 *
 * The host does NOT broadcast it - that's a space concern. Chat reads this via
 * the SDK and writes it into its presence heartbeat, so teammates see the
 * status. "Offline" means "appear offline to others even while active."
 */
import { ref } from 'vue'

export type PresenceStatus = 'online' | 'away' | 'offline'

const KEY = 'construct.presence-status.v1'

function load(): PresenceStatus {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'away' || v === 'offline') return v
  } catch { /* ignore */ }
  return 'online'
}

// Module-level singleton — one status for the whole app window.
const status = ref<PresenceStatus>(load())

export function usePresenceStatus() {
  function setStatus(s: PresenceStatus) {
    status.value = s
    try { localStorage.setItem(KEY, s) } catch { /* quota */ }
  }
  return { status, setStatus }
}

export const PRESENCE_STATUS_META: Record<PresenceStatus, { label: string; color: string }> = {
  online: { label: 'Online', color: '#10b981' },
  away: { label: 'Away', color: '#f59e0b' },
  offline: { label: 'Offline', color: '#9ca3af' },
}
