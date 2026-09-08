<script setup lang="ts">
/**
 * GenericCard — fallback provider card for catalog-driven API key modes.
 */

import { computed, onMounted, ref, watch } from 'vue'
import { Badge, Button, Card, Input } from '@construct-space/ui'
import { Check, ChevronDown, Eye, EyeOff, Key, Radio } from 'lucide-vue-next'
import type { AIProvider } from '@/brain/types'
import { providerLogoSvg, providerDescription } from '@/lib/providerLogo'
import ProviderLogo from '@/components/common/ProviderLogo.vue'
import { apiKeySlot, useProviderCard, type ModeKey } from '@/composables/useProviderCard'
import { useAIModel } from '@/composables/useAIModel'
import { useLiveModels } from '@/composables/useLiveModels'
import { useDisplayModels } from '@/composables/useDisplayModels'

const props = defineProps<{ provider: AIProvider }>()
const providerId = computed(() => props.provider.id)

const card = useProviderCard()
const { defaultModelId, setDefaultModel } = useAIModel()

const hasApiKeyPlan = computed(() => !!props.provider.apiKey?.enabled)
const hasCodingPlan = computed(
  () => !!props.provider.monthly?.enabled && props.provider.monthly.authType === 'api_key',
)
const apiSlot = computed(() => apiKeySlot(providerId.value, 'api_key'))
const codingSlot = computed(() => apiKeySlot(providerId.value, 'monthly'))

onMounted(() => {
  void card.loadConfigured(providerId.value, apiSlot.value)
  if (hasCodingPlan.value) void card.loadConfigured(providerId.value, codingSlot.value)
})

const active = computed<ModeKey>({
  get: () => {
    if (
      props.provider.orgManaged &&
      hasCodingPlan.value &&
      !card.isConfigured(providerId.value, apiSlot.value) &&
      !card.isConfigured(providerId.value, codingSlot.value)
    ) {
      return 'monthly'
    }
    return card.activeMode(providerId.value)
  },
  set: (m) => card.setActiveMode(providerId.value, m),
})

const apiDraft = card.draftRef(providerId.value, apiSlot.value)
const apiVisible = card.visibilityRef(providerId.value, apiSlot.value)
const apiEditing = ref(false)
const codingDraft = card.draftRef(providerId.value, codingSlot.value)
const codingVisible = card.visibilityRef(providerId.value, codingSlot.value)
const codingEditing = ref(false)

async function saveApiKey() {
  const ok = await card.saveKey(providerId.value, apiDraft.value, apiSlot.value)
  if (ok) {
    apiDraft.value = ''
    apiEditing.value = false
    void live.load(true)
  }
}

async function saveCodingKey() {
  const ok = await card.saveKey(providerId.value, codingDraft.value, codingSlot.value)
  if (ok) {
    codingDraft.value = ''
    codingEditing.value = false
    active.value = 'monthly'
    void live.load(true)
  }
}

const hasPersonalApiKey = computed(() => card.isConfigured(providerId.value, apiSlot.value))
const hasPersonalCodingKey = computed(() => card.isConfigured(providerId.value, codingSlot.value))
const hasPersonalKey = computed(() => hasPersonalApiKey.value || hasPersonalCodingKey.value)
const isOrgManaged = computed(() => !!props.provider.orgManaged)
const isAuthed = computed(() => hasPersonalKey.value || isOrgManaged.value)
const live = useLiveModels(() => (isAuthed.value ? providerId.value : null))
watch(isAuthed, () => { if (isAuthed.value) void live.load() }, { immediate: true })

const { displayModels, availableCount } = useDisplayModels(
  () => props.provider.models,
  () => live.models.value,
)

function compositeModelId(modelId: string) {
  return `${providerId.value}:${modelId}`
}
function selectModel(modelId: string, available: boolean) {
  if (!available) return
  setDefaultModel(compositeModelId(modelId))
}
function isSelected(modelId: string) {
  return defaultModelId.value === compositeModelId(modelId)
}

const collapsed = computed(() => card.isCollapsed(providerId.value))
function toggleCollapsed() {
  card.toggleCollapsed(providerId.value)
}

function activeTileClass(isActive: boolean) {
  return isActive
    ? 'ring-1 ring-[var(--app-accent)] bg-[color-mix(in_srgb,var(--app-accent)_5%,transparent)]'
    : ''
}

const headerStatus = computed(() => {
  if (isOrgManaged.value && !hasPersonalKey.value) return 'Org key'
  if (hasPersonalKey.value) return active.value === 'monthly' ? 'Coding plan configured' : 'API key configured'
  return 'Not set up'
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
            <p v-if="provider.description || providerDescription(provider.id)" class="text-sm text-[var(--app-muted)] mt-0.5 line-clamp-2">
              {{ provider.description || providerDescription(provider.id) }}
            </p>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-2" @click.stop>
          <div class="flex flex-col items-end gap-1">
          <span
            class="text-[10px] tracking-[0.08em] uppercase"
            :class="isAuthed ? 'text-[var(--app-muted)]' : 'text-[color-mix(in_srgb,var(--app-muted)_75%,transparent)]'"
          >
            <strong :class="isAuthed ? 'text-[var(--app-accent)]' : 'text-[var(--app-muted)]'">{{ headerStatus }}</strong>
          </span>
          <div v-if="isAuthed && !apiEditing && !codingEditing && hasPersonalKey && !hasCodingPlan" class="flex gap-1">
            <Button size="xs" variant="ghost" label="Change" @click="apiEditing = true" />
            <Button size="xs" variant="ghost" color="error" label="Remove" @click="card.removeKey(provider.id, apiSlot)" />
          </div>
        </div>
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

    <div v-if="!collapsed">
      <div v-if="hasCodingPlan" class="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
        <Card
          v-if="hasApiKeyPlan"
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
                <div v-if="hasPersonalApiKey || active === 'api_key'" class="flex items-center gap-1">
                  <Badge v-if="hasPersonalApiKey" color="success" size="xs">Configured</Badge>
                  <Badge v-if="active === 'api_key'" color="primary" size="xs">In use</Badge>
                </div>
              </div>
            </div>
          </template>
          <template v-if="hasPersonalApiKey && !apiEditing" #accessory>
            <div class="flex gap-1" @click.stop>
              <Button size="xs" variant="ghost" label="Change" @click="apiEditing = true" />
              <Button size="xs" variant="ghost" color="error" label="Remove" @click="card.removeKey(provider.id, apiSlot)" />
            </div>
          </template>

          <div v-if="!hasPersonalApiKey || apiEditing" class="flex gap-2 items-center" @click.stop>
            <div class="flex-1 relative">
              <Input
                v-model="apiDraft"
                :type="apiVisible ? 'text' : 'password'"
                :placeholder="hasPersonalApiKey ? 'Replace key…' : `${provider.label} API key`"
                size="sm"
              />
              <button
                v-if="apiDraft"
                class="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--app-muted)] hover:text-[var(--app-foreground)] z-10"
                @click="apiVisible = !apiVisible"
              >
                <component :is="apiVisible ? EyeOff : Eye" class="size-3.5" />
              </button>
            </div>
            <Button v-if="card.justSaved(provider.id, apiSlot)" size="sm" variant="ghost" disabled>
              <Check class="size-3.5 text-emerald-500" />
            </Button>
            <Button v-else size="sm" :loading="card.isSaving(provider.id, apiSlot)" :disabled="!apiDraft?.trim()" label="Save" @click="saveApiKey" />
            <Button v-if="hasPersonalApiKey" size="sm" variant="ghost" label="Cancel" @click="apiEditing = false; apiDraft = ''" />
          </div>

          <p v-if="provider.apiKey?.baseUrl" class="text-[10px] font-mono text-[var(--app-muted)] mt-2">{{ provider.apiKey.baseUrl }}</p>
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
                <h4 class="text-xs tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Coding plan</h4>
                <div v-if="hasPersonalCodingKey || isOrgManaged || active === 'monthly'" class="flex items-center gap-1">
                  <Badge v-if="hasPersonalCodingKey || isOrgManaged" color="success" size="xs">{{ isOrgManaged && !hasPersonalCodingKey ? 'Org key' : 'Configured' }}</Badge>
                  <Badge v-if="active === 'monthly'" color="primary" size="xs">In use</Badge>
                </div>
              </div>
            </div>
          </template>
          <template v-if="hasPersonalCodingKey && !codingEditing" #accessory>
            <div class="flex gap-1" @click.stop>
              <Button size="xs" variant="ghost" label="Change" @click="codingEditing = true" />
              <Button size="xs" variant="ghost" color="error" label="Remove" @click="card.removeKey(provider.id, codingSlot)" />
            </div>
          </template>

          <div v-if="!hasPersonalCodingKey && !isOrgManaged || codingEditing" class="flex gap-2 items-center" @click.stop>
            <div class="flex-1 relative">
              <Input
                v-model="codingDraft"
                :type="codingVisible ? 'text' : 'password'"
                :placeholder="hasPersonalCodingKey ? 'Replace coding-plan key…' : `${provider.label} coding-plan key`"
                size="sm"
              />
              <button
                v-if="codingDraft"
                class="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--app-muted)] hover:text-[var(--app-foreground)] z-10"
                @click="codingVisible = !codingVisible"
              >
                <component :is="codingVisible ? EyeOff : Eye" class="size-3.5" />
              </button>
            </div>
            <Button v-if="card.justSaved(provider.id, codingSlot)" size="sm" variant="ghost" disabled>
              <Check class="size-3.5 text-emerald-500" />
            </Button>
            <Button v-else size="sm" :loading="card.isSaving(provider.id, codingSlot)" :disabled="!codingDraft?.trim()" label="Save" @click="saveCodingKey" />
            <Button v-if="hasPersonalCodingKey" size="sm" variant="ghost" label="Cancel" @click="codingEditing = false; codingDraft = ''" />
          </div>

          <p v-if="provider.monthly?.baseUrl" class="text-[10px] font-mono text-[var(--app-muted)] mt-2">{{ provider.monthly.baseUrl }}</p>
        </Card>
      </div>

      <div v-else-if="provider.apiKey?.enabled && (!isAuthed || apiEditing)">
        <div class="flex items-center justify-between mb-2">
          <span class="text-xs font-normal text-[var(--app-foreground)]">API key</span>
          <span v-if="provider.apiKey.baseUrl" class="text-[10px] font-mono text-[var(--app-muted)]">{{ provider.apiKey.baseUrl }}</span>
        </div>

        <div class="flex gap-2 items-center">
          <div class="flex-1 relative">
            <Input
              v-model="apiDraft"
              :type="apiVisible ? 'text' : 'password'"
              :placeholder="hasPersonalKey ? 'Replace key…' : `${provider.label} API key`"
              size="sm"
            />
            <button
              v-if="apiDraft"
              class="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--app-muted)] hover:text-[var(--app-foreground)] z-10"
              @click="apiVisible = !apiVisible"
            >
              <component :is="apiVisible ? EyeOff : Eye" class="size-3.5" />
            </button>
          </div>
          <Button v-if="card.justSaved(provider.id, apiSlot)" size="sm" variant="ghost" disabled>
            <Check class="size-3.5 text-emerald-500" />
          </Button>
          <Button v-else size="sm" :loading="card.isSaving(provider.id, apiSlot)" :disabled="!apiDraft?.trim()" label="Save" @click="saveApiKey" />
          <Button v-if="hasPersonalKey" size="sm" variant="ghost" label="Cancel" @click="apiEditing = false; apiDraft = ''" />
        </div>

        <p v-if="provider.apiKey.signupUrl && !isAuthed" class="text-xs text-[var(--app-muted)] mt-2">
          Get a key at
          <a :href="provider.apiKey.signupUrl" target="_blank" rel="noopener" class="text-[var(--app-accent)] hover:underline">{{ provider.apiKey.signupUrl }}</a>
        </p>
      </div>
    </div>

    <template v-if="!collapsed" #footer>
      <div v-if="!isAuthed" class="text-xs text-[var(--app-muted)]">Add an API key to see available models.</div>
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
