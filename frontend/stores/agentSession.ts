/**
 * agentSession store — bridges useAgentSession factory instances to the
 * handoff registry.
 *
 * useAgentSession is a factory (per-call) with no module-level registry.
 * This store lets components register their live session instance so the
 * assistant handoff contract can access it for save/stop/load operations.
 *
 * Usage (in components that own an assistant session):
 *   const store = useAgentSessionStore()
 *   store.register(session)
 *   onUnmounted(() => store.unregister())
 */

import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import type { Ref } from 'vue'
import type { Turn } from '@/assistant'

export interface AgentSessionHandle {
  turns: Ref<Turn[]>
  isLoading: Ref<boolean>
  saveSession(agentId?: string): Promise<string | null>
  loadSession(id: string): Promise<boolean>
  stop(): Promise<void>
}

// Re-export for convenience
export type { Turn }

export const useAgentSessionStore = defineStore('agentSession', () => {
  const activeSession = shallowRef<AgentSessionHandle | null>(null)

  /** Register the live session instance (call from component onMounted / setup) */
  function register(session: AgentSessionHandle): void {
    activeSession.value = session
  }

  /** Unregister when the component that owns the session unmounts */
  function unregister(): void {
    activeSession.value = null
  }

  return {
    activeSession,
    register,
    unregister,
  }
})
