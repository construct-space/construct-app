/**
 * sessionHandoff — Cross-window session transfer utilities.
 *
 * Provides the three-phase handoff protocol:
 *  1. initiateDetach       — main saves session, stashes snapshot, opens detach window
 *  2. installDetachResponder — main listens for claim requests and sends targeted snapshots
 *  3. claim                — detach window installs listener first, then requests snapshot
 *  4. listenForRelease     — main re-hydrates when detach window closes
 */

import { channels, listen, type Unlisten } from './sync'
import { getHandoff } from './handoffRegistry'
import { openWindow } from '@/lib/window/openWindow'
import type { HandoffSnapshot } from './handoffRegistry'

const CLAIM_TIMEOUT_MS = 5000

// ─── pending detach map ───────────────────────────────────────────────────────

/**
 * Module-local pending-detach snapshots keyed by `<spaceId>:<sessionId>`.
 * Populated by initiateDetach on main; consumed when the detach window
 * emits sessionDetachRequest.
 */
const pendingDetaches = new Map<string, HandoffSnapshot>()

function key(spaceId: string, sessionId: string): string {
  return `${spaceId}:${sessionId}`
}

// ─── installDetachResponder ───────────────────────────────────────────────────

/**
 * Install once on main-window startup. Listens for claim requests from
 * detach windows and responds with the stashed snapshot, targeted at the
 * requesting window label. Returns unlisten.
 */
export async function installDetachResponder(): Promise<Unlisten> {
  const { emitTo } = await import('./sync')
  return listen<{ spaceId: string; sessionId: string; targetLabel: string }>(
    channels.sessionDetachRequest,
    async (req) => {
      const snap = pendingDetaches.get(key(req.spaceId, req.sessionId))
      if (!snap) {
        console.warn('[sessionHandoff] no pending detach for', req)
        return
      }
      pendingDetaches.delete(key(req.spaceId, req.sessionId))
      await emitTo(req.targetLabel, channels.sessionDetachReady, snap)
    },
  )
}

// ─── initiateDetach ───────────────────────────────────────────────────────────

/**
 * Main: save session, stash, open detach window. Responder (installed at
 * bootstrap) hands the snapshot to the new window when it requests.
 */
export async function initiateDetach(
  spaceId: string,
  sessionId: string,
): Promise<void> {
  const handoff = getHandoff(spaceId)
  if (!handoff) {
    throw new Error(`[sessionHandoff] No handoff registered for '${spaceId}'`)
  }

  const snap = await handoff.save(sessionId)
  pendingDetaches.set(key(spaceId, sessionId), snap)

  if (spaceId === 'assistant') {
    await openWindow({ type: 'detach-assistant', sessionId })
  } else {
    await openWindow({ type: 'detach-space', spaceId, sessionId })
  }
}

// ─── claim ────────────────────────────────────────────────────────────────────

/**
 * Detach window: install listener first, then emit request. Main's responder
 * sends the snapshot targeted at this window's label.
 */
export async function claim(spaceId: string, sessionId: string): Promise<void> {
  const handoff = getHandoff(spaceId)
  if (!handoff) {
    throw new Error(`[sessionHandoff] No handoff registered for '${spaceId}'`)
  }

  const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow')
  const targetLabel = getCurrentWebviewWindow().label
  const { emitTo } = await import('./sync')

  return new Promise<void>((resolve, reject) => {
    let unlisten: Unlisten | null = null
    let settled = false

    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      unlisten?.()
      reject(
        new Error(
          `[sessionHandoff] Timed out waiting for sessionDetachReady` +
          ` (spaceId=${spaceId}, sessionId=${sessionId}, timeout=${CLAIM_TIMEOUT_MS}ms)`,
        ),
      )
    }, CLAIM_TIMEOUT_MS)

    listen<HandoffSnapshot>(channels.sessionDetachReady, async (snap) => {
      if (snap.spaceId !== spaceId || snap.sessionId !== sessionId) return
      if (settled) return
      settled = true
      clearTimeout(timeout)
      unlisten?.()
      try {
        await handoff.load(snap)
        resolve()
      } catch (err) {
        reject(err)
      }
    })
      .then(async (fn) => {
        unlisten = fn
        if (settled) { unlisten(); return }
        // Listener is live — now ask main for the snapshot.
        await emitTo('main', channels.sessionDetachRequest, {
          spaceId,
          sessionId,
          targetLabel,
        })
      })
      .catch((err) => {
        if (!settled) {
          settled = true
          clearTimeout(timeout)
          reject(err)
        }
      })
  })
}

// ─── listenForRelease ─────────────────────────────────────────────────────────

/**
 * Called by main to re-hydrate when a detach window closes.
 * The detach window emits sessionReleased before destroying itself.
 */
export function listenForRelease(
  onRelease: (snap: HandoffSnapshot) => Promise<void>,
): Promise<Unlisten> {
  return listen<HandoffSnapshot>(channels.sessionReleased, (snap) => {
    const handoff = getHandoff(snap.spaceId)
    if (!handoff) {
      console.warn(`[sessionHandoff] No handoff for '${snap.spaceId}' on release`)
      return
    }
    void handoff.load(snap).catch((err) => {
      console.error('[sessionHandoff] Failed to re-hydrate on release:', err)
    })
    void onRelease(snap).catch((err) => {
      console.error('[sessionHandoff] onRelease callback failed:', err)
    })
  })
}
