<script setup lang="ts">
/**
 * LocalCard — Ollama, LM Studio, or any local OpenAI-compat runtime.
 */

import { computed, onMounted, watch } from 'vue'
import { Badge, Button, Card, Input } from '@construct-space/ui'
import { Check, ChevronDown, Monitor } from 'lucide-vue-next'
import type { AIProvider } from '@/brain/types'
import { providerLogoSvg } from '@/lib/providerLogo'
import ProviderLogo from '@/components/common/ProviderLogo.vue'
import { useProviderCard } from '@/composables/useProviderCard'
import { useAIModel } from '@/composables/useAIModel'
import { useLiveModels } from '@/composables/useLiveModels'

const props = defineProps<{ provider: AIProvider }>()
const providerId = computed(() => props.provider.id)

const URL_SLOT = `provider_url:${providerId.value}`
const card = useProviderCard()
const { defaultModelId, setDefaultModel } = useAIModel()

onMounted(() => { void card.loadConfigured(providerId.value, URL_SLOT) })

const draft = card.draftRef(providerId.value, URL_SLOT)

// `configured` gates every network probe: we only list models once the
// user has explicitly saved a Base URL. Previously we fired `live.load`
// on mount using the default URL (11434 for Ollama, 1234 for LM
// Studio), which produced the alarming "Couldn't list models — is X
// running?" banner on a fresh install for every user who hadn't set
// either up yet. The banner implied a *failure* where in reality the
// user simply hadn't configured the provider. Gate it properly: no
// URL → no probe → no error.
const configured = computed(() => card.isConfigured(providerId.value, URL_SLOT))

async function save() {
  const ok = await card.saveKey(providerId.value, draft.value, URL_SLOT)
  if (ok) void live.load(true)
}

const live = useLiveModels(() => (configured.value ? providerId.value : null))
onMounted(() => { if (configured.value) void live.load() })
watch(configured, (isConfigured) => {
  // Kick a fresh load the moment a URL is saved, and silently clear
  // the error state when the user resets back to unconfigured.
  if (isConfigured) void live.load(true)
})

const placeholder = computed(() => props.provider.apiKey?.baseUrl || 'http://localhost:11434/v1')

function selectModel(modelId: string) {
  setDefaultModel(`${providerId.value}:${modelId}`)
}
function isSelected(modelId: string) {
  return defaultModelId.value === `${providerId.value}:${modelId}`
}

const collapsed = computed(() => card.isCollapsed(providerId.value))
function toggleCollapsed() {
  card.toggleCollapsed(providerId.value)
}

const headerStatus = computed(() => card.isConfigured(providerId.value, URL_SLOT) ? 'Base URL configured' : 'Using default')
</script>

<template>
  <Card class="mb-4">
    <template #header>
      <div class="flex w-full items-start justify-between gap-3">
        <div class="flex min-w-0 items-start gap-3">
          <ProviderLogo v-if="providerLogoSvg(provider.id)" :id="provider.id" class="h-10 shrink-0 text-[var(--app-foreground)]" />
          <Monitor v-else class="size-10 text-[var(--app-muted)] shrink-0" />
          <div class="min-w-0 flex-1">
            <h3 class="text-sm tracking-[0.08em] uppercase font-normal text-[var(--app-foreground)] leading-tight after:content-['.'] after:text-[var(--app-accent)]">{{ provider.label }}</h3>
            <p class="text-sm text-[var(--app-muted)] mt-0.5">
              Local runtime · no API key needed · point Construct at your running server
            </p>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-2" @click.stop>
        <span class="text-[10px] tracking-[0.08em] uppercase text-[var(--app-muted)]">
          <strong>{{ headerStatus }}</strong>
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

    <div v-if="!collapsed" class="flex items-center justify-between mb-2">
      <div class="flex items-center gap-2">
        <span class="text-xs font-normal text-[var(--app-foreground)]">Base URL</span>
        <Badge v-if="card.isConfigured(provider.id, URL_SLOT)" color="success" size="xs">Configured</Badge>
        <Badge v-else color="neutral" size="xs">Using default</Badge>
      </div>
      <span class="text-[10px] font-mono text-[var(--app-muted)]">default: {{ placeholder }}</span>
    </div>

    <div v-if="!collapsed" class="flex gap-2 items-center">
      <Input
        v-model="draft"
        :placeholder="placeholder"
        size="sm"
        class="flex-1 font-mono"
      />
      <Button v-if="card.justSaved(provider.id, URL_SLOT)" size="sm" variant="ghost" disabled>
        <Check class="size-3.5 text-emerald-500" />
      </Button>
      <Button
        v-else
        size="sm"
        :loading="card.isSaving(provider.id, URL_SLOT)"
        :disabled="!draft?.trim()"
        label="Save"
        @click="save"
      />
      <Button
        v-if="card.isConfigured(provider.id, URL_SLOT)"
        size="sm"
        variant="ghost"
        color="error"
        label="Reset"
        @click="card.removeKey(provider.id, URL_SLOT)"
      />
    </div>

    <p v-if="!collapsed && provider.apiKey?.docsUrl" class="text-xs text-[var(--app-muted)] mt-2">
      <a :href="provider.apiKey.docsUrl" target="_blank" rel="noopener" class="text-[var(--app-accent)] hover:underline">{{ provider.apiKey.docsUrl }}</a>
    </p>

    <template v-if="!collapsed" #footer>
      <!-- No URL saved: don't probe, don't complain. A gentle hint is
           more honest than an amber "Couldn't list models" banner when
           the user hasn't even told us where to look yet. -->
      <div v-if="!configured" class="text-xs text-[var(--app-muted)]">
        Save a Base URL to list the models your {{ provider.label }} server is serving.
      </div>
      <div v-else-if="live.isLoading.value" class="text-xs text-[var(--app-muted)]">Loading models…</div>
      <div v-else-if="live.error.value" class="text-xs text-amber-500 flex items-center justify-between">
        <span>Couldn't list models — is {{ provider.label }} running?</span>
        <button class="underline" @click="live.load(true)">Retry</button>
      </div>
      <details v-else-if="live.models.value.length" open>
        <summary class="cursor-pointer text-[11px] tracking-[0.08em] uppercase text-[var(--app-muted)] hover:text-[var(--app-foreground)] flex items-center justify-between py-1">
          <span><strong class="text-[var(--app-foreground)]">{{ live.models.value.length }} models</strong> loaded</span>
          <span>▾</span>
        </summary>
        <ul class="mt-2 space-y-0.5">
          <li
            v-for="m in live.models.value"
            :key="m.id"
            class="text-xs flex items-center gap-2 px-2 py-1.5 rounded-sm cursor-pointer transition-colors"
            :class="isSelected(m.id) ? 'bg-[color-mix(in_srgb,var(--app-accent)_10%,transparent)]' : 'hover:bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)]'"
            @click="selectModel(m.id)"
          >
            <span class="text-[var(--app-foreground)]">{{ m.label }}</span>
            <span class="text-[var(--app-muted)] font-mono">· {{ m.id }}</span>
            <span v-if="isSelected(m.id)" class="ml-auto text-[10px] text-[var(--app-accent)]">✓ selected</span>
          </li>
        </ul>
      </details>
    </template>
  </Card>
</template>
