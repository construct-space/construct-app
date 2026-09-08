/**
 * bootstrapDetach — Lifecycle bootstrap for detach windows.
 *
 * Registers a close-requested listener that:
 *  1. Stops any in-flight operator work
 *  2. Persists session state
 *  3. Emits sessionReleased to main
 *  4. Destroys the window
 *
 * Also claims the session on mount via sessionHandoff.claim().
 */

import { isTauriEnv } from '@/utils/tauri'
import { channels, broadcast } from '@/lib/crossWindow/sync'
import { getHandoff } from '@/lib/crossWindow/handoffRegistry'
import { claim } from '@/lib/crossWindow/sessionHandoff'

export type DetachTarget =
  | { mode: 'assistant'; sessionId: string }
  | { mode: 'space'; spaceId: string; sessionId: string }

function resolveSpaceId(target: DetachTarget): string {
  return target.mode === 'assistant' ? 'assistant' : target.spaceId
}

/**
 * Call from DetachShell.onMounted. Sets up close-requested cleanup and
 * claims the session from the main window.
 *
 * Returns a cleanup function to call from onUnmounted.
 */
export async function bootstrapDetach(target: DetachTarget): Promise<() => void> {
  const spaceId = resolveSpaceId(target)
  const { sessionId } = target

  // Import assistant handoff registration as a side effect
  await import('@/spaces/assistant/handoff')

  // Claim the session (wait for main to emit the snapshot)
  try {
    await claim(spaceId, sessionId)
  } catch (err) {
    console.warn('[bootstrapDetach] claim() failed — window may have no prior state:', err)
  }

  if (!isTauriEnv()) {
    return () => {}
  }

  let cleanupClose: (() => void) | null = null

  try {
    const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow')
    const win = getCurrentWebviewWindow()

    // Re-entrancy guard: the first close request preventDefaults so we can
    // run cleanup, then destroys. If destroy ever fails/hangs, the window
    // would otherwise be trapped (preventDefault already cancelled the native
    // close). On any SECOND request we don't preventDefault — the OS closes
    // the window normally — so the worst case is "click red twice", never
    // "unclosable".
    let closing = false
    const unlisten = await win.onCloseRequested(async (event) => {
      if (closing) return // let the default close proceed — escape hatch
      closing = true
      event.preventDefault()

      // Cap cleanup at 1 second — a hung broadcast or save must not leave the
      // window open. Destroy always runs after.
      const cleanup = (async () => {
        const handoff = getHandoff(spaceId)
        if (!handoff) return
        await handoff.stopAndFinalize(sessionId)
        const snap = await handoff.save(sessionId)
        await broadcast(channels.sessionReleased, snap)
      })().catch(err => {
        console.error('[bootstrapDetach] Cleanup before close failed:', err)
      })
      const timeout = new Promise<void>(r => setTimeout(r, 1000))
      await Promise.race([cleanup, timeout])

      try {
        await win.destroy()
      } catch (err) {
        console.error('[bootstrapDetach] win.destroy() failed, falling back to close():', err)
        // destroy() failed — try a plain close(). closing=true means this
        // handler won't re-prevent it, so it actually goes through.
        try { await win.close() } catch (err2) {
          console.error('[bootstrapDetach] win.close() also failed:', err2)
        }
      }
    })

    cleanupClose = unlisten
  } catch (err) {
    console.warn('[bootstrapDetach] Could not register close-requested listener:', err)
  }

  return () => {
    cleanupClose?.()
  }
}
