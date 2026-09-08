/**
 * Assistant handoff contract.
 *
 * Registers the 'assistant' space in the handoff registry.
 * Imported as a side effect from bootstrapMain and bootstrapDetach.
 *
 * Design constraint: useAgentSession is a per-call factory with no
 * module-level registry. The handoff therefore round-trips through the
 * operator persistence layer (sessions.save / sessions.load).
 *
 * stopAndFinalize: cancels in-flight streaming and drops the trailing
 * incomplete Turn, using the Pinia assistantSession store as the bridge
 * to the live session instance.
 */

import { registerHandoff } from '@/lib/crossWindow/handoffRegistry'
import type { SpaceHandoffContract, HandoffSnapshot } from '@/lib/crossWindow/handoffRegistry'
import { useAgentSessionStore } from '@/stores/agentSession'

/** The session id key we store in the snapshot payload */
const PERSISTED_ID_KEY = 'operatorSessionId'

const contract: SpaceHandoffContract = {
  /**
   * canDetach — only allow if there is at least one turn to preserve.
   */
  canDetach(_sessionId: string): boolean {
    try {
      const store = useAgentSessionStore()
      return (store.activeSession?.turns.value.length ?? 0) > 0
    } catch {
      return true
    }
  },

  /**
   * stopAndFinalize — stop in-flight streaming, drop incomplete trailing turn.
   */
  async stopAndFinalize(_sessionId: string): Promise<void> {
    try {
      const store = useAgentSessionStore()
      const session = store.activeSession
      if (!session) return

      const turnsBefore = session.turns.value
      const streamingTurn = turnsBefore.at(-1)
      const wasStreaming = streamingTurn?.status === 'streaming'

      if (session.isLoading.value) await session.stop()

      if (wasStreaming && streamingTurn) {
        // Drop the trailing cancelled turn. stop() may have mutated the turn's
        // status or appended "Stopped." to the response; we always discard it
        // regardless of its current status, so the save path doesn't persist a
        // partial assistant reply.
        const turns = session.turns.value
        const idx = turns.indexOf(streamingTurn)
        if (idx >= 0) {
          turns.splice(idx, 1)
        } else if (turns.at(-1)?.id === streamingTurn.id) {
          turns.pop()
        }
      }
    } catch (err) {
      console.warn('[assistant/handoff] stopAndFinalize failed:', err)
    }
  },

  /**
   * save — persist session to operator and return a snapshot with the
   * persisted session id so the receiving window can reload it.
   */
  async save(sessionId: string): Promise<HandoffSnapshot> {
    try {
      const store = useAgentSessionStore()
      const session = store.activeSession
      if (session) {
        const persistedId = await session.saveSession()
        if (persistedId) {
          return {
            spaceId: 'assistant',
            sessionId,
            payload: { [PERSISTED_ID_KEY]: persistedId },
          }
        }
      }
    } catch (err) {
      console.warn('[assistant/handoff] save failed:', err)
    }

    return { spaceId: 'assistant', sessionId, payload: {} }
  },

  /**
   * load — restore a previously saved session in the current window.
   */
  async load(snapshot: HandoffSnapshot): Promise<void> {
    const persistedId = snapshot.payload[PERSISTED_ID_KEY] as string | undefined
    if (!persistedId) return

    try {
      const store = useAgentSessionStore()
      const session = store.activeSession
      if (session) {
        await session.loadSession(persistedId)
      }
    } catch (err) {
      console.warn('[assistant/handoff] load failed:', err)
    }
  },
}

registerHandoff('assistant', contract)

export { contract as assistantHandoffContract }
