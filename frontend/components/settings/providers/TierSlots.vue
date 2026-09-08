<script setup lang="ts">
/**
 * TierSlots — shared L/M/S tier picker that drops into each provider
 * card. Three dropdowns mapping Large / Medium / Small to one of the
 * provider's models.
 *
 * Defaults are seeded from each model's tier_hint (set by Oracle on
 * provider_catalog_models) on first render. User overrides win and
 * stick across sessions via useTierConfig's localStorage.
 *
 * Usage:
 *   <TierSlots
 *     :provider-id="provider.id"
 *     :models="availableModels"
 *   />
 *
 * Where availableModels is the provider's `.models[]` (already filtered
 * for plan/availability where applicable).
 */
import { computed, onMounted, watch } from 'vue'
import type { ProviderModel } from '@/brain/types'
import { useTierConfig, type Tier } from '@/composables/useTierConfig'

const props = defineProps<{
  providerId: string
  models: ProviderModel[]
}>()

const tier = useTierConfig()
const map = computed(() => tier.mapFor(props.providerId))

const TIER_META: Record<Tier, { label: string; description: string }> = {
  large:  { label: 'Large',  description: 'Hard reasoning, frontier work. Opt-in.' },
  medium: { label: 'Default', description: 'User-visible chat. Standard tier.' },
  small:  { label: 'Small',  description: 'Cheap fast — summarisation, classification, internal calls.' },
}

// Seed on mount (and again when the provider's model list changes —
// e.g. after the user pastes an API key and the live list loads).
function seed() {
  if (props.models.length === 0) return
  tier.seedFromCatalog(props.providerId, props.models)
}
onMounted(seed)
watch(() => props.models.map((m) => m.id).join(','), seed)

function hintBadge(modelId: string, slot: Tier): boolean {
  const m = props.models.find((x) => x.id === modelId)
  return m?.tierHint === slot
}
</script>

<template>
  <div v-if="models.length > 0" class="grid gap-3 sm:grid-cols-3">
    <div
      v-for="t in (['large','medium','small'] as Tier[])"
      :key="t"
      class="flex flex-col gap-1"
    >
      <label class="text-[10px] tracking-[0.08em] uppercase font-medium text-[var(--app-muted)]">
        {{ TIER_META[t].label }}
      </label>
      <select
        :value="map[t]"
        class="rounded-md border border-[var(--app-border)] bg-[var(--app-background)] px-2 py-1.5 text-xs font-mono text-[var(--app-foreground)]"
        @change="map[t] = ($event.target as HTMLSelectElement).value"
      >
        <option value="">— pick a model —</option>
        <option v-for="m in models" :key="m.id" :value="m.id" :disabled="m.deprecated">
          {{ m.label }}{{ hintBadge(m.id, t) ? ' · suggested' : '' }}{{ m.deprecated ? ' (deprecated)' : '' }}
        </option>
      </select>
      <p class="text-[10px] text-[var(--app-muted)] leading-tight">{{ TIER_META[t].description }}</p>
    </div>
  </div>
</template>
