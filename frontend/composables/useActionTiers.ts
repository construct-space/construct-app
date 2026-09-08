/**
 * useActionTiers — tier lookup for space actions.
 *
 * When the agent calls `space_run_action`, the UI wants to render a chip
 * showing which tier the action runs at (small/medium/large). The space's
 * AutomationProvider already exposes `listActions()` which carries `tier`
 * since SDK 1.2 — this composable caches per-space lookups so the chip
 * doesn't fire a bridge call per render.
 *
 * Lazy: caches lookups on first ToolCard render. The host registers
 * providers eagerly at space load, so the lookup is in-process.
 */

import { ref } from 'vue'
import type { AutomationAction } from '@/types/automation'
// Tier is canonically defined in useTierConfig — import (don't re-export) so
// the auto-import dir-scan has a single source and doesn't warn about a
// "Duplicated imports 'Tier'" collision.
import type { Tier } from './useTierConfig'

const cache = ref<Record<string, Record<string, Tier | null>>>({})
const loading = new Set<string>()

async function loadSpaceActions(spaceId: string): Promise<void> {
  if (cache.value[spaceId] !== undefined || loading.has(spaceId)) return
  loading.add(spaceId)
  try {
    const { getAutomationProvider } = await import('@/lib/spaceContextBus')
    const provider = getAutomationProvider(spaceId)
    if (!provider) {
      cache.value[spaceId] = {}
      return
    }
    const actions = provider.listActions() as AutomationAction[]
    const map: Record<string, Tier | null> = {}
    for (const a of actions) {
      map[a.id] = (a.tier as Tier) ?? null
    }
    cache.value = { ...cache.value, [spaceId]: map }
  } catch {
    cache.value = { ...cache.value, [spaceId]: {} }
  } finally {
    loading.delete(spaceId)
  }
}

export function useActionTiers() {
  /** Lookup the tier for a given (spaceId, actionId). Triggers a lazy
   *  populate if not cached. Returns null when no tier is declared,
   *  undefined while still loading. */
  function getTier(spaceId: string, actionId: string): Tier | null | undefined {
    if (!spaceId || !actionId) return null
    const space = cache.value[spaceId]
    if (space === undefined) {
      // Fire-and-forget — Vue reactivity will re-render once the cache populates.
      void loadSpaceActions(spaceId)
      return undefined
    }
    return space[actionId] ?? null
  }

  return { getTier }
}
