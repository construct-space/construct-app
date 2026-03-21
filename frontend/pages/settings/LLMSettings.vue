<script setup lang="ts">
import { useProviderAuth } from '@/composables/useProviderAuth'
import { useAIModel } from '@/composables/useAIModel'
import { useOperator } from '@/operator'
import { useContextDB } from '@/composables/useContextDB'
import Input from '@/components/ui/Input.vue'
import Button from '@/components/ui/Button.vue'
import Accordion from '@/components/ui/Accordion.vue'
import { Eye, EyeOff, Check, Cpu, KeyRound, ShieldCheck } from 'lucide-vue-next'

const toast = useToast()
const route = useRoute()

const activeTab = ref<'models' | 'providers' | 'auth'>('models')

// AI Model selection
const { modelsByProvider, defaultModelId, setDefaultModel, allModels, resolveModelId, loadProviders } = useAIModel()

const PROVIDER_LABELS: Record<string, string> = {
  'anthropic': 'Anthropic',
  'claude-code': 'Claude Code',
  'codex': 'Codex',
  'deepseek': 'DeepSeek',
  'mimo': 'MiMo',
  'openai': 'OpenAI',
  'xai': 'xAI',
  'openrouter': 'OpenRouter',
  'zai': 'Z.AI',
}

const MODEL_LABELS: Record<string, string> = {
  'claude-opus-4-6': 'Claude Opus 4.6',
  'claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'claude-sonnet-4-5': 'Claude Sonnet 4.5',
  'claude-haiku-4-5': 'Claude Haiku 4.5',
  'claude-haiku-4-5-20251001': 'Claude Haiku 4.5',
  'deepseek-chat': 'DeepSeek V3',
  'deepseek-reasoner': 'DeepSeek R1',
  'glm-5': 'GLM-5',
  'gpt-5.4': 'GPT-5.4',
  'gpt-5.3-codex': 'GPT-5.3 Codex',
  'gpt-5.2-codex': 'GPT-5.2 Codex',
  'gpt-5.1-codex': 'GPT-5.1 Codex',
  'gpt-5.1-codex-mini': 'GPT-5.1 Codex Mini',
  'gpt-4.1': 'GPT-4.1',
  'gpt-4.1-mini': 'GPT-4.1 Mini',
  'gpt-4.1-nano': 'GPT-4.1 Nano',
  'gpt-4o': 'GPT-4o',
  'gpt-4o-mini': 'GPT-4o Mini',
  'grok-3': 'Grok 3',
  'grok-3-mini': 'Grok 3 Mini',
  'grok-4-1-fast-reasoning': 'Grok 4.1 Fast',
  'grok-code-fast-1': 'Grok Code',
  'MiMo-V2-Pro': 'MiMo V2 Pro',
  'MiMo-V2-Omni': 'MiMo V2 Omni',
  'MiMo-V2-TTS': 'MiMo V2 TTS',
  'MiMo-V2-Flash': 'MiMo V2 Flash',
  'o1': 'o1',
  'o3': 'o3',
  'o3-mini': 'o3 Mini',
  'o4-mini': 'o4 Mini',
  'anthropic/claude-sonnet-4': 'Claude Sonnet 4',
  'anthropic/claude-haiku-4': 'Claude Haiku 4',
  'openai/gpt-4.1': 'GPT-4.1',
  'openai/gpt-4.1-mini': 'GPT-4.1 Mini',
  'openai/o3': 'o3',
  'google/gemini-2.5-pro': 'Gemini 2.5 Pro',
  'google/gemini-2.5-flash': 'Gemini 2.5 Flash',
  'deepseek/deepseek-chat-v3': 'DeepSeek Chat v3',
  'deepseek/deepseek-reasoner': 'DeepSeek Reasoner',
  'meta-llama/llama-4-maverick': 'Llama 4 Maverick',
  'mistralai/mistral-medium-3': 'Mistral Medium 3',
}

function isAnthropicCodeAuth(providerId: string, providerLabel: string, authType: 'oauth' | 'api' | 'local') {
  const haystack = `${providerId} ${providerLabel} ${authType}`.toLowerCase()
  return (
    haystack.includes('claude-code') ||
    ((haystack.includes('anthropic') || providerId.toLowerCase().includes('anthropic')) && (haystack.includes('oauth') || authType === 'oauth'))
  )
}

function isOpenAICliAuth(providerId: string, providerLabel: string, authType: 'oauth' | 'api' | 'local') {
  const haystack = `${providerId} ${providerLabel} ${authType}`.toLowerCase()
  return (
    haystack.includes('openai')
    && (haystack.includes('oauth') || haystack.includes('codex') || haystack.includes('openai-cli') || authType === 'oauth')
  )
}

function displayAuthType(providerId: string, providerLabel: string, authType: 'oauth' | 'api' | 'local') {
  return isAnthropicCodeAuth(providerId, providerLabel, authType) || isOpenAICliAuth(providerId, providerLabel, authType)
    ? 'oauth'
    : authType
}

function formatProviderLabel(raw: string, providerLabel: string, authType?: 'oauth' | 'api' | 'local') {
  const normalized = raw.trim()
  if (!normalized) return 'Provider'

  const computedAuthType = authType ? displayAuthType(raw, providerLabel, authType) : authType
  const normalizedLower = normalized.toLowerCase()
  if (isAnthropicCodeAuth(raw, providerLabel, authType || 'api')) {
    return 'Anthropic (Claude Code)'
  }
  if (isOpenAICliAuth(raw, providerLabel, computedAuthType as 'oauth' | 'api' | 'local')) {
    return 'OpenAI (Codex)'
  }
  if (normalizedLower === 'claude-code') return 'Claude Code'
  return PROVIDER_LABELS[normalizedLower] || PROVIDER_LABELS[normalized] || normalized
    .split(/[-_]/g)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function formatModelLabel(raw: string) {
  const normalized = raw.trim()
  if (!normalized) return 'Unknown model'
  return MODEL_LABELS[normalized] || normalized
}

function authLabel(providerId: string, providerLabel: string, authType: 'oauth' | 'api' | 'local') {
  if (isAnthropicCodeAuth(providerId, providerLabel, authType)) return 'Claude Code'
  if (isOpenAICliAuth(providerId, providerLabel, authType)) return 'Codex'
  if (displayAuthType(providerId, providerLabel, authType) === 'oauth') return 'OAuth'
  const normalizedProviderId = providerId.trim().toLowerCase()
  const hasAnthropic = normalizedProviderId.includes('anthropic')
  if (hasAnthropic && authType === 'oauth') return 'OAuth'
  if (authType === 'oauth') return 'OAuth'
  if (authType === 'local') return 'Local'
  return 'API key'
}

function providerMonogram(raw: string, providerLabel: string, authType?: 'oauth' | 'api' | 'local') {
  const letters = formatProviderLabel(raw, providerLabel, authType)
    .replace(/[^A-Za-z0-9 ]/g, '')
    .split(/\s+/g)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() || '')
    .join('')
  return letters || 'AI'
}

function providerDescription(providerId: string, providerLabel: string, authType: 'oauth' | 'api' | 'local') {
  if (isAnthropicCodeAuth(providerId, providerLabel, authType)) return 'Uses your Claude Code session for Anthropic models.'
  if (isOpenAICliAuth(providerId, providerLabel, authType)) return 'Uses your Codex CLI session for OpenAI models.'
  const normalizedProviderId = providerId.trim().toLowerCase()
  if (providerId === 'codex') return 'Uses your Codex CLI session for GPT and Codex models.'
  if (authType === 'local') return 'Runs against locally available models.'
  if (authType === 'oauth') return 'Available after connecting the matching account.'
  return 'Enabled by the provider credentials saved in Construct.'
}

function providerTag(providerId: string, providerLabel: string, authType: 'oauth' | 'api' | 'local') {
  if (isAnthropicCodeAuth(providerId, providerLabel, authType)) return 'anthropic'
  if (isOpenAICliAuth(providerId, providerLabel, authType)) return 'openai'
  return providerId || 'provider'
}

const resolvedDefaultModelId = computed(() =>
  resolveModelId(defaultModelId.value, { allowAuto: false }),
)

const currentModelOption = computed(() =>
  allModels.value.find(model => model.id === resolvedDefaultModelId.value) ?? null,
)

const hasExplicitDefaultModel = computed(() => Boolean(defaultModelId.value?.trim()))

const defaultModelLabel = computed(() => {
  const model = currentModelOption.value
  if (model) return formatModelLabel(model.label)
  if (hasExplicitDefaultModel.value) return 'Stored model unavailable'
  return 'No default model selected'
})

const defaultModelSubtext = computed(() => {
  const model = currentModelOption.value
  if (model) return formatProviderLabel(model.providerLabel || model.providerId, model.providerLabel, model.authType)
  if (hasExplicitDefaultModel.value) {
    return 'This saved default requires an active provider connection. Connect the provider, then choose a new default.'
  }
  return 'Pick one model to make it the default for Vibe, Architect, and Assistant.'
})

const availableModelGroups = computed(() =>
  modelsByProvider.value
    .filter(group => group.models.length > 0)
    .map(group => ({
      ...group,
      displayLabel: formatProviderLabel(group.provider.label || group.provider.id, group.provider.label, group.authType),
      authDisplayLabel: authLabel(group.provider.id, group.provider.label, group.authType),
      displayAuthType: displayAuthType(group.provider.id, group.provider.label, group.authType),
      description: providerDescription(group.provider.id, group.provider.label, group.authType),
      providerTag: providerTag(group.provider.id, group.provider.label, group.authType),
      models: group.models.map(model => ({
        ...model,
        displayLabel: formatModelLabel(model.label),
      })),
    })),
)

const accordionItems = computed(() =>
  availableModelGroups.value.map(group => ({
    label: `${group.displayLabel}  ·  ${group.models.length} models`,
    value: group.provider.id,
    slot: group.provider.id,
  })),
)

// Default-open the group that contains the selected model
const accordionDefaultValue = computed(() =>
  availableModelGroups.value
    .filter(g => g.models.some(m => m.compositeId === resolvedDefaultModelId.value))
    .map(g => g.provider.id),
)

const availableProviderCount = computed(() => availableModelGroups.value.length)
const availableModelCount = computed(() =>
  availableModelGroups.value.reduce((total, group) => total + group.models.length, 0),
)

// Provider auth (Claude Code keychain, Codex)
const providerAuth = useProviderAuth()

// OpenAI / Codex
const operator = useOperator()

// Fetch provider catalog from admin (via operator)
const catalogProviders = ref<Record<string, { name: string; models: Array<{ model_id: string; display_name: string }> }>>({})

async function loadCatalog() {
  try {
    const result = await operator.send('providers.catalog', {}) as { providers?: Array<{ id: string; name: string; type: string; models: Array<{ model_id: string; display_name: string }> }> }
    if (result?.providers) {
      for (const p of result.providers) {
        catalogProviders.value[p.type] = { name: p.name, models: p.models || [] }
        // Merge provider labels
        if (p.name && !PROVIDER_LABELS[p.type]) {
          PROVIDER_LABELS[p.type] = p.name
        }
        // Merge model labels
        for (const m of p.models || []) {
          if (m.display_name && !MODEL_LABELS[m.model_id]) {
            MODEL_LABELS[m.model_id] = m.display_name
          }
        }
      }
    }
  } catch {
    // Catalog not available, use hardcoded defaults
  }
}

const openAIAuthenticated = ref(false)
const openAIAuthLoading = ref(false)

// Provider API Keys
const db = useContextDB()

interface ProviderKeyConfig {
  id: string
  name: string
  description: string
  placeholder: string
  kvKey: string
  isUrl?: boolean
}

const providers: ProviderKeyConfig[] = [
  { id: 'anthropic', name: 'Anthropic', description: 'Claude models (Opus, Sonnet, Haiku)', placeholder: 'sk-ant-...', kvKey: 'provider_key:anthropic' },
  { id: 'openai', name: 'OpenAI', description: 'GPT-4o, o1, o3 models', placeholder: 'sk-...', kvKey: 'provider_key:openai' },
  { id: 'freepik', name: 'Freepik', description: 'Image gen, video, editing, audio (Mystic, Flux, Kling)', placeholder: 'fpk-...', kvKey: 'provider_key:freepik' },
  { id: 'deepseek', name: 'DeepSeek', description: 'DeepSeek V3/R1 models', placeholder: 'sk-...', kvKey: 'provider_key:deepseek' },
  { id: 'xai', name: 'xAI (Grok)', description: 'Grok models', placeholder: 'xai-...', kvKey: 'provider_key:xai' },
  { id: 'openrouter', name: 'OpenRouter', description: 'Access 600+ models from multiple providers', placeholder: 'sk-or-...', kvKey: 'provider_key:openrouter' },
  { id: 'zai', name: 'Z.AI', description: 'GLM / CogView models', placeholder: 'API key', kvKey: 'provider_key:zai' },
  { id: 'mimo', name: 'Xiaomi MiMo', description: 'MiMo reasoning model', placeholder: 'API key', kvKey: 'provider_key:mimo' },
  { id: 'kimi', name: 'Kimi (Moonshot)', description: 'Moonshot AI models', placeholder: 'API key', kvKey: 'provider_key:kimi' },
]

const apiKeys = ref<Record<string, string>>({})
const visibleKeys = ref<Record<string, boolean>>({})
const savedKeys = ref<Record<string, boolean>>({})
const savingKeys = ref<Record<string, boolean>>({})
const configuredProviders = ref<Record<string, boolean>>({})

function toggleVisibility(id: string) {
  visibleKeys.value[id] = !visibleKeys.value[id]
}

async function saveKey(provider: ProviderKeyConfig) {
  const value = apiKeys.value[provider.id]?.trim()
  if (!value) return

  savingKeys.value[provider.id] = true
  try {
    // Save to operator SQLite (primary store) and hot-reload provider
    await operator.send('settings.set', {
      key: provider.kvKey,
      value,
    })

    // Also cache in Tauri KV for faster UI loading
    try { await db.kvSet(provider.kvKey, value, 'provider_keys') } catch { /* ignore */ }

    configuredProviders.value[provider.id] = true
    savedKeys.value[provider.id] = true
    setTimeout(() => { savedKeys.value[provider.id] = false }, 2000)
    toast.add({ title: `${provider.name} API key saved`, color: 'success' })

    // Refresh models list so new provider's models appear immediately
    await loadProviders()
  } catch {
    toast.add({ title: `Failed to save ${provider.name} key`, color: 'error' })
  } finally {
    savingKeys.value[provider.id] = false
  }
}

async function clearKey(provider: ProviderKeyConfig) {
  try {
    await operator.send('settings.set', { key: provider.kvKey, value: '' })
    apiKeys.value[provider.id] = ''
    configuredProviders.value[provider.id] = false
    try { await db.kvSet(provider.kvKey, '', 'provider_keys') } catch { /* ignore */ }
    toast.add({ title: `${provider.name} key cleared`, color: 'info' })

    // Refresh models list so removed provider's models disappear
    await loadProviders()
  } catch {
    toast.add({ title: `Failed to clear ${provider.name} key`, color: 'error' })
  }
}

async function loadKeys() {
  // Load cached key values from Tauri KV (for input fields)
  for (const p of providers) {
    try {
      const val = await db.kvGet(p.kvKey)
      if (val) apiKeys.value[p.id] = val
    } catch { /* ignore */ }
  }

  // Check which providers actually have keys configured in the operator
  try {
    const result = await operator.send('settings.provider_status', {}) as { providers?: Record<string, boolean> }
    if (result?.providers) {
      configuredProviders.value = result.providers
    }
  } catch { /* ignore */ }
}

async function useClaudeCodeTokens() {
  const success = await providerAuth.loginFromKeychain()
  if (success) {
    await loadProviders()
    toast.add({ title: 'Authenticated via Claude Code', color: 'success' })
  } else {
    toast.add({ title: providerAuth.error.value || 'Claude Code not found or tokens expired', color: 'error' })
  }
}

async function useCodexTokens() {
  const success = await providerAuth.loginFromCodex()
  if (success) {
    openAIAuthenticated.value = true
    await checkOpenAIStatus()
    await loadProviders()
    toast.add({ title: 'Authenticated via Codex', color: 'success' })
  } else {
    toast.add({ title: providerAuth.error.value || 'Codex not found. Install: npm i -g @openai/codex', color: 'error' })
  }
}

async function logoutAnthropic() {
  providerAuth.logout()
  await loadProviders()
  toast.add({ title: 'Claude Max authentication cleared', color: 'info' })
}

async function checkOpenAIStatus() {
	if (!operator.isTauri.value) return
	try {
		const result = await operator.send('auth.openai.status', {}) as { authenticated?: boolean }
		openAIAuthenticated.value = !!result?.authenticated
	} catch {
		openAIAuthenticated.value = false
	}
}

async function logoutOpenAI() {
	if (!operator.isTauri.value) return
	openAIAuthLoading.value = true
  try {
    await operator.send('auth.openai.clear', {})
    openAIAuthenticated.value = false
    await loadProviders()
    toast.add({ title: 'OpenAI authentication cleared', color: 'info' })
  } catch {
    toast.add({ title: 'Failed to disconnect OpenAI', color: 'error' })
  } finally {
    openAIAuthLoading.value = false
	}
}

onMounted(async () => {
	try {
    await loadCatalog()
    if (route.query.connect === 'oauth' || route.query.connect === 'openai') {
      activeTab.value = 'auth'
    }
		await providerAuth.checkStatus()
		await checkOpenAIStatus()
		await loadKeys()
	} catch {
		// silent
	}
})
</script>

<template>
  <div>
    <!-- Tabs -->
    <div class="flex gap-1 p-1 bg-[color-mix(in_srgb,var(--app-muted)_8%,transparent)] rounded-lg w-fit mb-6">
      <button
        class="px-4 py-1.5 text-sm rounded-md transition-colors cursor-pointer"
        :class="activeTab === 'models' ? 'bg-app-accent text-white' : 'text-[var(--app-muted)] hover:text-[var(--app-foreground)]'"
        @click="activeTab = 'models'"
      >
        Models
      </button>
      <button
        class="px-4 py-1.5 text-sm rounded-md transition-colors cursor-pointer"
        :class="activeTab === 'providers' ? 'bg-app-accent text-white' : 'text-[var(--app-muted)] hover:text-[var(--app-foreground)]'"
        @click="activeTab = 'providers'"
      >
        Providers
      </button>
      <button
        class="px-4 py-1.5 text-sm rounded-md transition-colors cursor-pointer"
        :class="activeTab === 'auth' ? 'bg-app-accent text-white' : 'text-[var(--app-muted)] hover:text-[var(--app-foreground)]'"
        @click="activeTab = 'auth'"
      >
        Auth
      </button>
    </div>

    <!-- Models Tab -->
    <template v-if="activeTab === 'models'">
    <div class="space-y-4">
      <!-- Current default -->
      <div class="flex items-center justify-between rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] px-4 py-3">
        <div class="flex items-center gap-3 min-w-0">
          <Cpu class="size-4 shrink-0 text-[var(--app-muted)]" />
          <div class="min-w-0">
            <p class="text-sm font-medium text-[var(--app-foreground)] truncate">{{ defaultModelLabel }}</p>
            <p class="text-xs text-[var(--app-muted)]">{{ defaultModelSubtext }}</p>
          </div>
        </div>
        <div class="flex gap-3 text-xs text-[var(--app-muted)] shrink-0">
          <span>{{ availableProviderCount }} providers</span>
          <span>{{ availableModelCount }} models</span>
        </div>
      </div>

      <!-- Grouped model list (collapsible) -->
      <div v-if="availableModelGroups.length > 0" class="rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] overflow-hidden">
        <Accordion
          :items="accordionItems"
          type="multiple"
          :default-value="accordionDefaultValue"
          :ui="{ trigger: 'flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-[var(--app-foreground)] hover:bg-[var(--app-background)] transition-colors [&[data-state=open]>svg]:rotate-180' }"
        >
          <template #body="{ item }">
            <div class="px-4 pb-2">
              <button
                v-for="model in availableModelGroups.find(g => g.provider.id === item.value)?.models || []"
                :key="model.compositeId"
                class="flex items-center justify-between w-full px-2 py-1.5 rounded-md text-left transition-colors cursor-pointer"
                :class="resolvedDefaultModelId === model.compositeId
                  ? 'bg-[var(--app-accent)]/10 text-[var(--app-foreground)]'
                  : 'text-[var(--app-muted)] hover:bg-[var(--app-background)] hover:text-[var(--app-foreground)]'"
                @click="setDefaultModel(model.compositeId)"
              >
                <span class="text-sm">{{ model.displayLabel }}</span>
                <Check
                  v-if="resolvedDefaultModelId === model.compositeId"
                  class="size-3.5 text-[var(--app-accent)] shrink-0"
                />
              </button>
            </div>
          </template>
        </Accordion>
      </div>

      <!-- Empty state -->
      <div v-else class="rounded-lg border border-dashed border-[var(--app-border)] bg-[var(--app-surface)] px-6 py-8 text-center">
        <p class="text-sm font-medium text-[var(--app-foreground)]">No providers connected</p>
        <p class="mt-1 text-xs text-[var(--app-muted)]">Add an API key or connect Claude Code / Codex to get started.</p>
        <div class="mt-3 flex justify-center gap-2">
          <Button size="sm" label="Providers" @click="activeTab = 'providers'" />
          <Button size="sm" label="Auth" variant="ghost" @click="activeTab = 'auth'" />
        </div>
      </div>
    </div>
    </template>

    <!-- Providers Tab -->
    <template v-else-if="activeTab === 'providers'">
    <div>
      <h3 class="text-sm font-semibold text-[var(--app-foreground)] mb-1">Provider API Keys</h3>
      <p class="text-xs text-[var(--app-muted)] mb-2">{{ providers.filter(p => configuredProviders[p.id]).length }} of {{ providers.length }} providers configured</p>
      <p class="text-xs text-[var(--app-muted)] mb-4">Add API keys to enable additional providers. Keys are stored locally in the operator service.</p>

      <div class="space-y-3">
        <div
          v-for="provider in providers"
          :key="provider.id"
          class="p-4 rounded-lg border border-[var(--app-border)]"
        >
          <div class="flex items-center justify-between mb-2">
            <div>
              <p class="text-sm font-medium text-[var(--app-foreground)]">{{ provider.name }}</p>
              <p class="text-xs text-[var(--app-muted)]">{{ provider.description }}</p>
            </div>
            <span
              v-if="configuredProviders[provider.id]"
              class="px-2 py-0.5 text-[10px] rounded-full bg-green-500/10 text-green-500"
            >
              Configured
            </span>
          </div>

          <div class="flex gap-2">
            <div class="flex-1 relative">
              <Input
                v-model="apiKeys[provider.id]"
                :type="visibleKeys[provider.id] ? 'text' : 'password'"
                :placeholder="provider.placeholder"
                size="sm"
              />
              <button
                v-if="apiKeys[provider.id]"
                class="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--app-muted)] hover:text-[var(--app-foreground)] transition-colors"
                @click="toggleVisibility(provider.id)"
              >
                <component :is="visibleKeys[provider.id] ? EyeOff : Eye" class="size-3.5" />
              </button>
            </div>

            <Button
              v-if="savedKeys[provider.id]"
              size="sm"
              variant="ghost"
              disabled
            >
              <Check class="size-3.5 text-green-500" />
            </Button>
            <Button
              v-else
              size="sm"
              :loading="savingKeys[provider.id]"
              :disabled="!apiKeys[provider.id]?.trim()"
              label="Save"
              @click="saveKey(provider)"
            />
            <Button
              v-if="apiKeys[provider.id]"
              size="sm"
              variant="ghost"
              color="error"
              label="Clear"
              @click="clearKey(provider)"
            />
          </div>
        </div>
      </div>
    </div>
    </template>

    <!-- Auth Tab -->
    <template v-else-if="activeTab === 'auth'">
    <div class="space-y-6">
<!-- Claude Max OAuth -->
    <div>
      <div class="flex items-center justify-between mb-4">
        <div>
          <h3 class="text-sm font-semibold text-[var(--app-foreground)]">Claude Code Authentication</h3>
          <p class="text-xs text-[var(--app-muted)]">Use Claude Code CLI tokens for Anthropic models</p>
        </div>
        <span
          class="px-2 py-0.5 text-xs rounded-full"
          :class="providerAuth.isAuthenticated.value ? 'bg-green-500/10 text-green-500' : 'bg-[color-mix(in_srgb,var(--app-muted)_15%,transparent)] text-[var(--app-muted)]'"
        >
          {{ providerAuth.isAuthenticated.value ? 'Connected' : 'Not Connected' }}
        </span>
      </div>

      <!-- Connected state -->
      <div v-if="providerAuth.isAuthenticated.value" class="p-4 rounded-lg bg-green-500/5 border border-green-500/20">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <svg class="w-5 h-5 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
            <div>
              <p class="text-sm font-medium text-[var(--app-foreground)]">Claude Code Connected</p>
              <p class="text-xs text-[var(--app-muted)]">Using tokens from Claude Code CLI</p>
            </div>
          </div>
          <Button variant="ghost" color="error" size="sm" label="Disconnect" @click="logoutAnthropic" />
        </div>
      </div>

      <!-- Login button -->
      <div v-else class="p-4 rounded-lg border border-[var(--app-border)]">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm text-[var(--app-foreground)]">Connect your Claude Pro or Max subscription</p>
            <p class="text-xs text-[var(--app-muted)] mt-1">Uses tokens from Claude Code (must be installed and authenticated)</p>
          </div>
          <Button :loading="providerAuth.isLoading.value" label="Use Claude Code" @click="useClaudeCodeTokens" />
        </div>
      </div>
    </div>

    <!-- OpenAI OAuth -->
    <div>
      <div class="flex items-center justify-between mb-4">
        <div>
          <h3 class="text-sm font-semibold text-[var(--app-foreground)]">Codex Authentication</h3>
          <p class="text-xs text-[var(--app-muted)]">Authenticate with Codex CLI for OpenAI model access</p>
        </div>
        <span
          class="px-2 py-0.5 text-xs rounded-full"
          :class="openAIAuthenticated ? 'bg-green-500/10 text-green-500' : 'bg-[color-mix(in_srgb,var(--app-muted)_15%,transparent)] text-[var(--app-muted)]'"
        >
          {{ openAIAuthenticated ? 'Connected' : 'Not Connected' }}
        </span>
      </div>

      <!-- Connected -->
      <div v-if="openAIAuthenticated" class="p-4 rounded-lg bg-green-500/5 border border-green-500/20">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <svg class="w-5 h-5 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
            <div>
              <p class="text-sm font-medium text-[var(--app-foreground)]">Codex Connected</p>
              <p class="text-xs text-[var(--app-muted)]">Using tokens from Codex CLI</p>
            </div>
          </div>
          <Button variant="ghost" color="error" size="sm" label="Disconnect" :loading="openAIAuthLoading" @click="logoutOpenAI" />
        </div>
      </div>

      <!-- Login button -->
      <div v-else class="p-4 rounded-lg border border-[var(--app-border)]">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm text-[var(--app-foreground)]">Connect via Codex CLI</p>
            <p class="text-xs text-[var(--app-muted)] mt-1">Uses tokens from Codex CLI (must be installed and authenticated)</p>
          </div>
          <Button :loading="openAIAuthLoading" label="Use Codex" @click="useCodexTokens" />
        </div>
      </div>
    </div>
</div>
    </template>
  </div>
</template>
