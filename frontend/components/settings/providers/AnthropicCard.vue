<script setup lang="ts">
/**
 * AnthropicCard — Claude via API key or Pro/Max OAuth.
 */

import { computed, onMounted, ref, watch } from 'vue'
import { Badge, Button, Card, Input } from '@construct-space/ui'
import { Check, ChevronDown, Eye, EyeOff, Key, Radio } from 'lucide-vue-next'
import type { AIProvider } from '@/brain/types'
import { providerLogoSvg } from '@/lib/providerLogo'
import ProviderLogo from '@/components/common/ProviderLogo.vue'
import { useProviderCard, type ModeKey } from '@/composables/useProviderCard'
import { useProviderOAuth } from '@/composables/useProviderOAuth'
import { useAIModel } from '@/composables/useAIModel'
import { useLiveModels } from '@/composables/useLiveModels'
import { useDisplayModels } from '@/composables/useDisplayModels'
import TierSlots from '@/components/settings/providers/TierSlots.vue'

const props = defineProps<{ provider: AIProvider }>()
const providerId = computed(() => props.provider.id)

const card = useProviderCard()
const oauth = useProviderOAuth()
const { defaultModelId, setDefaultModel } = useAIModel()

const OAUTH_PROVIDER_ID = 'claude'

const oauthState = ref<{ connected: boolean; email?: string; name?: string }>({ connected: false })
const oauthError = ref('')
const refreshing = ref(false)

async function refreshStatus() {
  refreshing.value = true
  try {
    oauthState.value = await oauth.getStatus(OAUTH_PROVIDER_ID)
  } finally {
    refreshing.value = false
  }
}

onMounted(async () => {
  void card.loadConfigured(providerId.value)
  oauthState.value = await oauth.getStatus(OAUTH_PROVIDER_ID)
})

const draft = card.draftRef(providerId.value)
const visible = card.visibilityRef(providerId.value)
const editing = ref(false)

const active = computed<ModeKey>({
  get: () => card.activeMode(providerId.value),
  set: (m) => card.setActiveMode(providerId.value, m),
})

async function save() {
  const ok = await card.saveKey(providerId.value, draft.value)
  if (ok) {
    draft.value = ''
    editing.value = false
    if (active.value === 'api_key') void live.load(true)
  }
}

async function signIn() {
  oauthError.value = ''
  try {
    const res = await oauth.start(OAUTH_PROVIDER_ID)
    if (res?.success) {
      oauthState.value = await oauth.getStatus(OAUTH_PROVIDER_ID)
      if (active.value === 'monthly') void live.load(true)
      return
    }
    if (res?.pending) {
      const ok = await oauth.pollPending(OAUTH_PROVIDER_ID)
      if (!ok) return // user cancelled — leave state untouched, no error
      oauthState.value = await oauth.getStatus(OAUTH_PROVIDER_ID)
      if (active.value === 'monthly') void live.load(true)
    }
  } catch (e) {
    oauthError.value = e instanceof Error ? e.message : String(e)
  }
}

async function cancelSignIn() {
  oauthError.value = ''
  await oauth.cancel(OAUTH_PROVIDER_ID)
}

async function signOut() {
  await oauth.disconnect(OAUTH_PROVIDER_ID)
  oauthState.value = { connected: false }
}

function connectorId(): string {
  return active.value === 'monthly' ? 'claude-oauth' : 'anthropic'
}

const isAuthed = computed(
  () =>
    (active.value === 'api_key' && card.isConfigured(providerId.value)) ||
    (active.value === 'monthly' && oauthState.value.connected),
)
const live = useLiveModels(() => (isAuthed.value ? connectorId() : null))

watch([() => active.value, isAuthed], () => {
  if (isAuthed.value) void live.load()
}, { immediate: true })

const { displayModels, availableCount } = useDisplayModels(
  () => props.provider.models,
  () => live.models.value,
)

function selectModel(modelId: string, available: boolean) {
  if (!available) return
  setDefaultModel(`${connectorId()}:${modelId}`)
}
function isSelected(modelId: string) {
  return defaultModelId.value === `${connectorId()}:${modelId}`
}

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
  return active.value === 'monthly' ? 'Pro/Max signed in' : 'API key configured'
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
            <p class="text-sm text-[var(--app-muted)] mt-0.5">Claude Opus, Sonnet, Haiku · vision · tools</p>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-2" @click.stop>
        <span
          class="text-[10px] tracking-[0.08em] uppercase"
          :class="isAuthed ? 'text-[var(--app-muted)]' : 'text-[color-mix(in_srgb,var(--app-muted)_75%,transparent)]'"
        >
          <strong :class="isAuthed ? 'text-[var(--app-accent)]' : 'text-[var(--app-muted)]'">{{ headerStatus }}</strong>
        </span>
        <Button
          v-if="oauthState.connected"
          size="xs"
          variant="ghost"
          :loading="refreshing"
          label="Refresh"
          title="Re-check sign-in status"
          @click="refreshStatus"
        />
        <Button
          v-if="oauthState.connected"
          size="xs"
          color="error"
          variant="ghost"
          label="Sign out"
          @click="signOut"
        />
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
      <!-- API key tile -->
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
              <div v-if="card.isConfigured(provider.id) || active === 'api_key'" class="flex items-center gap-1">
                <Badge v-if="card.isConfigured(provider.id)" color="success" size="xs">Configured</Badge>
                <Badge v-if="active === 'api_key'" color="primary" size="xs">In use</Badge>
              </div>
            </div>
          </div>
        </template>
        <template v-if="card.isConfigured(provider.id) && !editing" #accessory>
          <div class="flex gap-1" @click.stop>
            <Button size="xs" variant="ghost" label="Change" @click="editing = true" />
            <Button size="xs" variant="ghost" color="error" label="Remove" @click="card.removeKey(provider.id)" />
          </div>
        </template>

        <div v-if="!card.isConfigured(provider.id) || editing" class="flex gap-2 items-center" @click.stop>
          <div class="flex-1 relative">
            <Input v-model="draft" :type="visible ? 'text' : 'password'" placeholder="sk-ant-…" size="sm" />
            <button v-if="draft" class="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--app-muted)] z-10" @click="visible = !visible">
              <component :is="visible ? EyeOff : Eye" class="size-3.5" />
            </button>
          </div>
          <Button v-if="card.justSaved(provider.id)" size="sm" variant="ghost" disabled>
            <Check class="size-3.5 text-emerald-500" />
          </Button>
          <Button v-else size="sm" :loading="card.isSaving(provider.id)" :disabled="!draft?.trim()" label="Save" @click="save" />
          <Button v-if="card.isConfigured(provider.id)" size="sm" variant="ghost" label="Cancel" @click="editing = false; draft = ''" />
        </div>
        <p v-if="!card.isConfigured(provider.id)" class="text-[10px] text-[var(--app-muted)] mt-2">
          Get a key at <a href="https://console.anthropic.com" target="_blank" rel="noopener" class="text-[var(--app-accent)] hover:underline" @click.stop>console.anthropic.com</a>
        </p>
      </Card>

      <!-- Monthly plan (OAuth) tile -->
      <Card
        variant="muted"
        interactive
        :class="activeTileClass(active === 'monthly')"
        @click="active = 'monthly'"
      >
        <template #header>
          <div class="flex w-full items-start justify-between gap-3">
            <div class="flex items-start gap-2 min-w-0">
              <Radio class="size-3.5 text-[var(--app-muted)] shrink-0 mt-0.5" />
              <div class="flex flex-col gap-1 min-w-0">
                <h4 class="text-xs tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">Claude Pro/Max</h4>
                <div v-if="oauthState.connected || active === 'monthly'" class="flex items-center gap-1">
                  <Badge v-if="oauthState.connected" color="success" size="xs">Signed in</Badge>
                  <Badge v-if="active === 'monthly' && oauthState.connected" color="primary" size="xs">In use</Badge>
                </div>
              </div>
            </div>
            <Button v-if="oauthState.connected" size="xs" color="error" label="Sign out" @click.stop="signOut" />
          </div>
        </template>

        <div v-if="oauthState.connected && oauthState.email" @click.stop>
          <p class="text-xs text-[var(--app-muted)]">
            Signed in as <strong class="text-[var(--app-foreground)]">{{ oauthState.email }}</strong>
          </p>
        </div>
        <div v-else-if="!oauthState.connected" @click.stop>
          <p class="text-xs text-[var(--app-muted)] mb-2">
            Use your Claude Pro or Max subscription. Opens a browser window; no API billing.
          </p>
          <div class="flex items-center gap-2">
            <Button size="sm" :loading="oauth.loading.value[OAUTH_PROVIDER_ID]" label="Sign in with Claude" @click="signIn" />
            <Button
              v-if="oauth.loading.value[OAUTH_PROVIDER_ID]"
              size="sm"
              variant="ghost"
              color="error"
              label="Cancel"
              @click="cancelSignIn"
            />
          </div>
          <p v-if="oauthError" class="text-xs text-red-500 mt-2">{{ oauthError }}</p>
        </div>
      </Card>
    </div>

    <!-- Models -->
    <template v-if="!collapsed" #footer>
      <div v-if="!isAuthed" class="text-xs text-[var(--app-muted)]">
        {{ active === 'monthly' ? 'Sign in with Claude to see available models.' : 'Add an API key to see available models.' }}
      </div>

      <div v-else-if="live.isLoading.value && !displayModels.length" class="text-xs text-[var(--app-muted)]">
        Loading models…
      </div>

      <div v-else-if="live.error.value && !displayModels.length" class="text-xs text-amber-500 flex items-center justify-between">
        <span>Couldn't list models — {{ live.error.value }}</span>
        <button class="underline" @click="live.load(true)">Retry</button>
      </div>

      <template v-else-if="displayModels.length">
        <TierSlots
          :provider-id="provider.id"
          :models="displayModels.filter((m) => m.available)"
          class="mb-3"
        />

      <details open>
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
    </template>
  </Card>
</template>
