<script setup lang="ts">
/**
 * MiMoCard — Xiaomi MiMo. API key + Token plan, each backed by its own key.
 */

import { computed, onMounted, ref, watch } from 'vue'
import { Badge, Button, Card, Input } from '@construct-space/ui'
import { Check, ChevronDown, Eye, EyeOff, Key, Radio } from 'lucide-vue-next'
import type { AIProvider } from '@/brain/types'
import { providerLogoSvg } from '@/lib/providerLogo'
import ProviderLogo from '@/components/common/ProviderLogo.vue'
import { useProviderCard, apiKeySlot, type ModeKey } from '@/composables/useProviderCard'
import { useAIModel } from '@/composables/useAIModel'
import { useLiveModels } from '@/composables/useLiveModels'
import { useDisplayModels } from '@/composables/useDisplayModels'

const props = defineProps<{ provider: AIProvider }>()
const providerId = computed(() => props.provider.id)

const card = useProviderCard()
const { defaultModelId, setDefaultModel } = useAIModel()

onMounted(() => {
  void card.loadConfigured(providerId.value, apiKeySlot(providerId.value, 'api_key'))
  void card.loadConfigured(providerId.value, apiKeySlot(providerId.value, 'monthly'))
})

const apiDraft = card.draftRef(providerId.value, apiKeySlot(providerId.value, 'api_key'))
const apiVisible = card.visibilityRef(providerId.value, apiKeySlot(providerId.value, 'api_key'))
const apiEditing = ref(false)
const monthlyDraft = card.draftRef(providerId.value, apiKeySlot(providerId.value, 'monthly'))
const monthlyVisible = card.visibilityRef(providerId.value, apiKeySlot(providerId.value, 'monthly'))
const monthlyEditing = ref(false)

// Org-managed state. Convention (matches GenericCard): the org key targets
// the token-plan slot, never the per-user api_key slot — orgs share a
// subscription, not pay-per-token credentials. Without this MiMo's UI shows
// "Not set up" even when an admin has provisioned a managed key, because
// MiMoCard previously only inspected the personal key slots.
const isOrgManagedMonthly = computed(() => !!props.provider.orgManaged)
const hasPersonalApiKey = computed(() => card.isConfigured(providerId.value, apiKeySlot(providerId.value, 'api_key')))
const hasPersonalMonthlyKey = computed(() => card.isConfigured(providerId.value, apiKeySlot(providerId.value, 'monthly')))

const active = computed<ModeKey>({
  get: () => {
    // When the org provisioned a token-plan key and the user hasn't set
    // anything personal, default to 'monthly' so the badge + "in use"
    // state line up with what'll actually be called.
    if (isOrgManagedMonthly.value && !hasPersonalApiKey.value && !hasPersonalMonthlyKey.value) {
      return 'monthly'
    }
    return card.activeMode(providerId.value)
  },
  set: (m) => card.setActiveMode(providerId.value, m),
})

async function saveApiKey() {
  const ok = await card.saveKey(providerId.value, apiDraft.value, apiKeySlot(providerId.value, 'api_key'))
  if (ok) {
    apiDraft.value = ''
    apiEditing.value = false
  }
}
async function saveMonthlyKey() {
  const ok = await card.saveKey(providerId.value, monthlyDraft.value, apiKeySlot(providerId.value, 'monthly'))
  if (ok) {
    monthlyDraft.value = ''
    monthlyEditing.value = false
  }
}

function selectModel(modelId: string, available: boolean) {
  if (!available) return
  setDefaultModel(`${providerId.value}:${modelId}`)
}
function isSelected(modelId: string) {
  return defaultModelId.value === `${providerId.value}:${modelId}`
}

const isAuthed = computed(
  () => hasPersonalApiKey.value || hasPersonalMonthlyKey.value || isOrgManagedMonthly.value,
)
const live = useLiveModels(() => (isAuthed.value ? providerId.value : null))
watch(isAuthed, (v) => { if (v) void live.load() }, { immediate: true })

const { displayModels, availableCount } = useDisplayModels(
  () => props.provider.models,
  () => live.models.value,
)

function activeTileClass(isActive: boolean) {
  return isActive
    ? 'ring-1 ring-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent)_5%,transparent)]'
    : ''
}

const collapsed = computed(() => card.isCollapsed(providerId.value))
function toggleCollapsed() {
  card.toggleCollapsed(providerId.value)
}

const headerStatus = computed(() => {
  if (!isAuthed.value) return 'Not set up'
  if (isOrgManagedMonthly.value && !hasPersonalApiKey.value && !hasPersonalMonthlyKey.value) {
    return 'Org key'
  }
  return active.value === 'monthly' ? 'Token plan configured' : 'API key configured'
})
</script>

<template>
  <Card class="mb-4">
    <template #header>
      <div class="flex w-full items-start justify-between gap-3">
        <div class="flex min-w-0 items-start gap-3">
          <ProviderLogo v-if="providerLogoSvg(provider.id)" :id="provider.id" class="h-10 shrink-0 text-[var(--app-foreground)]" />
          <Key v-else class="size-10 text-[var(--app-muted)] shrink-0" />
          <div class="min-w-0 flex-1">
            <h3 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">{{ provider.label }}</h3>
            <p class="text-sm text-[var(--app-muted)] mt-0.5">
              Xiaomi MiMo · API (pay-per-token) or Token Plan (flat monthly) — each needs its own key
            </p>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-2" @click.stop>
        <span
          class="text-[10px] tracking-[0.08em] uppercase"
          :class="isAuthed ? 'text-[var(--app-muted)]' : 'text-[color-mix(in_srgb,var(--app-muted)_75%,transparent)]'"
        >
          <strong :class="isAuthed ? 'text-[var(--app-accent)]' : 'text-[var(--app-muted)]'">{{ headerStatus }}</strong>
        </span>
        <button
          type="button"
          class="size-8 grid place-items-center rounded-sm border border-[var(--app-border)] bg-[color-mix(in_srgb,var(--app-background)_75%,var(--app-canvas-bg))] text-[var(--app-muted)] hover:text-[var(--app-foreground)] hover:border-[var(--app-accent)] transition-colors"
          :aria-label="collapsed ? `Expand ${provider.label}` : `Collapse ${provider.label}`"
          :title="collapsed ? `Expand ${provider.label}` : `Collapse ${provider.label}`"
          @click="toggleCollapsed"
        >
          <ChevronDown :class="['size-4 transition-transform', collapsed ? '' : 'rotate-180']" />
        </button>
        </div>
      </div>
    </template>

    <div v-if="!collapsed" class="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
      <Card
        variant="muted"
        interactive
        :class="activeTileClass(active === 'api_key')"
        @click="active = 'api_key'"
      >
        <template #header>
          <div class="flex items-start gap-2">
            <Key class="size-3.5 text-[var(--app-muted)] shrink-0 mt-0.5" />
            <div class="flex flex-col gap-1">
              <h4 class="text-xs tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">API key</h4>
              <div v-if="card.isConfigured(provider.id, apiKeySlot(provider.id, 'api_key')) || active === 'api_key'" class="flex items-center gap-1">
                <Badge v-if="card.isConfigured(provider.id, apiKeySlot(provider.id, 'api_key'))" color="success" size="xs">Configured</Badge>
                <Badge v-if="active === 'api_key'" color="primary" size="xs">In use</Badge>
              </div>
            </div>
          </div>
        </template>
        <template v-if="card.isConfigured(provider.id, apiKeySlot(provider.id, 'api_key')) && !apiEditing" #accessory>
          <div class="flex gap-1" @click.stop>
            <Button size="xs" variant="ghost" label="Change" @click="apiEditing = true" />
            <Button size="xs" variant="ghost" color="error" label="Remove" @click="card.removeKey(provider.id, apiKeySlot(provider.id, 'api_key'))" />
          </div>
        </template>

        <div v-if="!card.isConfigured(provider.id, apiKeySlot(provider.id, 'api_key')) || apiEditing" class="flex gap-2 items-center" @click.stop>
          <div class="flex-1 relative">
            <Input v-model="apiDraft" :type="apiVisible ? 'text' : 'password'" placeholder="sk-…" size="sm" />
            <button v-if="apiDraft" class="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--app-muted)] z-10" @click="apiVisible = !apiVisible">
              <component :is="apiVisible ? EyeOff : Eye" class="size-3.5" />
            </button>
          </div>
          <Button v-if="card.justSaved(provider.id, apiKeySlot(provider.id, 'api_key'))" size="sm" variant="ghost" disabled>
            <Check class="size-3.5 text-emerald-500" />
          </Button>
          <Button v-else size="sm" :loading="card.isSaving(provider.id, apiKeySlot(provider.id, 'api_key'))" :disabled="!apiDraft?.trim()" label="Save" @click="saveApiKey" />
          <Button v-if="card.isConfigured(provider.id, apiKeySlot(provider.id, 'api_key'))" size="sm" variant="ghost" label="Cancel" @click="apiEditing = false; apiDraft = ''" />
        </div>
        <p class="text-[10px] font-mono text-[var(--app-muted)] mt-2">api.xiaomimimo.com/v1 · pay-per-token</p>
      </Card>

      <Card
        variant="muted"
        interactive
        :class="activeTileClass(active === 'monthly')"
        @click="active = 'monthly'"
      >
        <template #header>
          <div class="flex items-start gap-2">
            <Radio class="size-3.5 text-[var(--app-muted)] shrink-0 mt-0.5" />
            <div class="flex flex-col gap-1">
              <h4 class="text-xs tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Token plan</h4>
              <div v-if="hasPersonalMonthlyKey || isOrgManagedMonthly || active === 'monthly'" class="flex items-center gap-1">
                <Badge v-if="hasPersonalMonthlyKey || isOrgManagedMonthly" color="success" size="xs">{{ isOrgManagedMonthly && !hasPersonalMonthlyKey ? 'Org key' : 'Configured' }}</Badge>
                <Badge v-if="active === 'monthly'" color="primary" size="xs">In use</Badge>
              </div>
            </div>
          </div>
        </template>
        <template v-if="hasPersonalMonthlyKey && !monthlyEditing" #accessory>
          <div class="flex gap-1" @click.stop>
            <Button size="xs" variant="ghost" label="Change" @click="monthlyEditing = true" />
            <Button size="xs" variant="ghost" color="error" label="Remove" @click="card.removeKey(provider.id, apiKeySlot(provider.id, 'monthly'))" />
          </div>
        </template>

        <div v-if="(!hasPersonalMonthlyKey && !isOrgManagedMonthly) || monthlyEditing" class="flex gap-2 items-center" @click.stop>
          <div class="flex-1 relative">
            <Input v-model="monthlyDraft" :type="monthlyVisible ? 'text' : 'password'" placeholder="token-plan key" size="sm" />
            <button v-if="monthlyDraft" class="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--app-muted)] z-10" @click="monthlyVisible = !monthlyVisible">
              <component :is="monthlyVisible ? EyeOff : Eye" class="size-3.5" />
            </button>
          </div>
          <Button v-if="card.justSaved(provider.id, apiKeySlot(provider.id, 'monthly'))" size="sm" variant="ghost" disabled>
            <Check class="size-3.5 text-emerald-500" />
          </Button>
          <Button v-else size="sm" :loading="card.isSaving(provider.id, apiKeySlot(provider.id, 'monthly'))" :disabled="!monthlyDraft?.trim()" label="Save" @click="saveMonthlyKey" />
          <Button v-if="card.isConfigured(provider.id, apiKeySlot(provider.id, 'monthly'))" size="sm" variant="ghost" label="Cancel" @click="monthlyEditing = false; monthlyDraft = ''" />
        </div>
        <p class="text-[10px] font-mono text-[var(--app-muted)] mt-2">token-plan-sgp.xiaomimimo.com/v1 · fixed monthly fee</p>
      </Card>
    </div>

    <template v-if="!collapsed" #footer>
      <div v-if="!isAuthed" class="text-xs text-[var(--app-muted)]">Add a key to see available models.</div>
      <div v-else-if="live.isLoading.value && !displayModels.length" class="text-xs text-[var(--app-muted)]">Loading models…</div>
      <div v-else-if="live.error.value && !displayModels.length" class="text-xs text-amber-500 flex items-center justify-between">
        <span>Couldn't list models — {{ live.error.value }}</span>
        <button class="underline" @click="live.load(true)">Retry</button>
      </div>
      <details v-else-if="displayModels.length" open>
        <summary class="cursor-pointer text-[11px] tracking-[0.08em] uppercase text-[var(--app-muted)] hover:text-[var(--app-foreground)] flex items-center justify-between py-1">
          <span><strong class="text-[var(--app-foreground)]">{{ availableCount }}</strong> / {{ displayModels.length }} models available</span>
          <span>▾</span>
        </summary>
        <div class="mt-2 grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]">
          <Card
            v-for="m in displayModels"
            :key="m.id"
            variant="muted"
            :interactive="m.available"
            :class="[
              isSelected(m.id) ? 'ring-1 ring-[var(--app-accent)]' : '',
              !m.available ? 'opacity-40 cursor-not-allowed' : '',
            ]"
            @click="selectModel(m.id, m.available)"
          >
            <template #header>
              <h4 class="text-[11px] tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)] break-words">{{ m.label }}</h4>
            </template>
            <template v-if="isSelected(m.id)" #accessory>
              <Check class="size-4 text-[var(--app-accent)]" />
            </template>
            <div v-if="m.capabilities?.length || !m.available" class="flex flex-wrap gap-1">
              <span v-if="!m.available" class="text-[9px] tracking-[0.06em] uppercase text-amber-500 px-1.5 py-0.5 rounded-sm bg-[color-mix(in_srgb,var(--app-muted)_10%,transparent)]">not on plan</span>
              <span v-for="cap in m.capabilities" :key="cap" class="text-[9px] tracking-[0.06em] uppercase text-[var(--app-muted)] px-1.5 py-0.5 rounded-sm bg-[color-mix(in_srgb,var(--app-muted)_10%,transparent)]">{{ cap }}</span>
            </div>
          </Card>
        </div>
      </details>
    </template>
  </Card>
</template>
