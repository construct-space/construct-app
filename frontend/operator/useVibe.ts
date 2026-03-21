/**
 * useVibe — Autonomous coding engine
 *
 * Dispatches coding tasks to the code agent via Operator.
 * Frontend shows progress and results. Operator does all the work.
 *
 * NOTE: Without streaming, Vibe runs synchronously — the UI shows a
 * loading state until the full result comes back. Streaming will be
 * added in Operator v0.2 for real-time progress.
 */

import { ref, computed } from 'vue'
import { useOperator } from './client'
import type { DispatchResult } from './types'

export interface VibeSession {
  id: string
  goal: string
  agentId: string
  status: 'running' | 'completed' | 'failed'
  result?: DispatchResult
  error?: string
  startedAt: number
  completedAt?: number
}

export function useVibe() {
  const operator = useOperator()

  const sessions = ref<VibeSession[]>([])
  const activeSession = ref<VibeSession | null>(null)
  const isRunning = computed(() => activeSession.value?.status === 'running')

  async function run(goal: string, agentId = 'general'): Promise<VibeSession> {
    // Create session
    const session: VibeSession = {
      id: `vibe-${Date.now()}`,
      goal,
      agentId,
      status: 'running',
      startedAt: Date.now(),
    }

    sessions.value.push(session)
    activeSession.value = session

    try {
      // Dispatch to operator — full agent loop runs there
      const result = await operator.dispatch(agentId, goal)

      session.result = result
      session.status = 'completed'
      session.completedAt = Date.now()
    } catch (e) {
      session.error = e instanceof Error ? e.message : 'Vibe session failed'
      session.status = 'failed'
      session.completedAt = Date.now()
    }

    // Clear active
    if (activeSession.value?.id === session.id) {
      activeSession.value = null
    }

    return session
  }

  function clear() {
    sessions.value = []
    activeSession.value = null
  }

  return {
    sessions,
    activeSession,
    isRunning,
    run,
    clear,
  }
}
