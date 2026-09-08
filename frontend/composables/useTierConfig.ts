/**
 * Per-provider L/M/S tier → model_id map.
 *
 * The desktop's intent-based routing (brain decides tier=small for
 * summarisation; tier=large for hard reasoning) needs to know which
 * model id to use *on whichever provider the user is currently on*.
 * That map is the responsibility of this composable.
 *
 * Persistence: localStorage today, keyed by profile. Will move to
 * auth.json (and eventually accounts-sync) when those are wired.
 *
 * Seeding: when a provider's models carry `tierHint` from the server
 * catalog, the first model matching each tier becomes the slot's
 * default. The user can override in Settings → LLM Providers; once
 * they do, their explicit choice wins forever — re-seeding doesn't
 * clobber.
 */
import { computed, ref, watch } from 'vue'
import type { ProviderModel } from '@/brain/types'

export type Tier = 'large' | 'medium' | 'small'

/** Per-provider map of tier → model id. Empty string ('') means
 *  "not set; fall back to whatever the provider's catalog default is". */
export interface ProviderTierMap {
  large: string
  medium: string
  small: string
}

type AllTiers = Record<string, ProviderTierMap>

const STORAGE_KEY = 'construct.tierConfig.v1'

function emptyMap(): ProviderTierMap {
  return { large: '', medium: '', small: '' }
}

function loadFromStorage(): AllTiers {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as AllTiers
  } catch {
    return {}
  }
}

function persist(all: AllTiers) {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(all)) } catch { /* quota */ }
}

const tiers = ref<AllTiers>(loadFromStorage())

watch(tiers, (v) => persist(v), { deep: true })

/** Returns the live ProviderTierMap for one provider id, creating an
 *  empty entry if missing. Reactive — components can v-model into
 *  individual fields. */
function mapFor(providerId: string): ProviderTierMap {
  if (!tiers.value[providerId]) {
    tiers.value[providerId] = emptyMap()
  }
  return tiers.value[providerId]!
}

/** Seed a provider's tier slots from the server-provided tier_hint on
 *  each model. Non-destructive: only fills slots that are still empty,
 *  so re-seeding never clobbers an explicit user choice. */
function seedFromCatalog(providerId: string, models: ProviderModel[]) {
  const map = mapFor(providerId)
  const firstWith = (tier: Tier) => models.find((m) => m.tierHint === tier && !m.deprecated)?.id
  if (!map.large)  { const id = firstWith('large');  if (id) map.large = id }
  if (!map.medium) { const id = firstWith('medium'); if (id) map.medium = id }
  if (!map.small)  { const id = firstWith('small');  if (id) map.small = id }
}

/** Resolve a tier to a model id for the given provider. Falls back to
 *  the model with `default: true` when the user hasn't set this tier
 *  yet, then to medium, then to the first model in the list. Returns
 *  '' only when the provider has no models at all. */
function resolveModel(providerId: string, tier: Tier, models: ProviderModel[]): string {
  const map = tiers.value[providerId]
  if (map) {
    const picked = map[tier]
    if (picked && models.some((m) => m.id === picked)) return picked
    if (tier !== 'medium' && map.medium && models.some((m) => m.id === map.medium)) {
      return map.medium
    }
  }
  // No explicit choice — fall back to catalog default, then first.
  const def = models.find((m) => m.default) || models[0]
  return def?.id ?? ''
}

export function useTierConfig() {
  return {
    tiers: computed(() => tiers.value),
    mapFor,
    seedFromCatalog,
    resolveModel,
  }
}
