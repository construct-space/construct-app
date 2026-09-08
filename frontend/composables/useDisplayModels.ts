/**
 * Merges a provider's source catalog (ProviderModel[]) with its live
 * model list from the authenticated /models endpoint.
 *
 * Rule of engagement:
 *   - Catalog from my.construct.space is authoritative for what Construct
 *     intentionally supports.
 *   - Live /models is advisory only. Some providers omit callable models
 *     from /models (Z.AI GLM-4.7-Flash is one), so live must not mark a
 *     catalog model "not on plan".
 *   - Models only in live are shown only when the managed catalog has no
 *     models for that provider, so stale connector metadata cannot surface
 *     deprecated choices after source removes them.
 */
import { computed, type ComputedRef } from 'vue'
import type { ProviderModel } from '@/brain/types'
import { isChatModelId, type LiveModel } from '@/composables/useLiveModels'

export interface DisplayModel extends ProviderModel {
  available: boolean
}

function canonicalModelId(id: string): string {
  const normalized = id.trim().toLowerCase()
  if (normalized === 'glm-5v-turbo') return 'glm-5-turbo'
  return normalized
}

export function useDisplayModels(
  sourceModels: () => ProviderModel[] | undefined,
  liveModels: () => LiveModel[],
): {
  displayModels: ComputedRef<DisplayModel[]>
  availableCount: ComputedRef<number>
} {
  const displayModels = computed<DisplayModel[]>(() => {
    // Drop non-chat models (tts, embeddings, video-gen, etc.) from
    // both catalog and live — the picker only surfaces chat-compatible
    // models, so picking one never produces "wrong endpoint" errors.
    const source = (sourceModels() || []).filter(m => isChatModelId(m.id))
    const live = liveModels().filter(m => isChatModelId(m.id))
    if (source.length === 0) {
      return live.map(m => ({
        id: m.id,
        label: m.label,
        capabilities: m.capabilities,
        available: true,
      }))
    }
    const liveById = new Map(live.map(m => [canonicalModelId(m.id), m]))

    const out: DisplayModel[] = source.map((m) => {
      const liveMatch = liveById.get(canonicalModelId(m.id))
      return {
        ...m,
        id: liveMatch?.id || m.id,
        label: liveMatch?.label || m.label,
        capabilities: liveMatch?.capabilities || m.capabilities,
        available: true,
      }
    })
    return out
  })

  const availableCount = computed(() => displayModels.value.filter(m => m.available).length)

  return { displayModels, availableCount }
}
