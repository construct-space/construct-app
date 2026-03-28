<script setup lang="ts">
import { useAIModel } from '@/composables/useAIModel'
import { useOperator } from '@/operator'
import { useContextDB } from '@/composables/useContextDB'
import { Input, Button, Accordion } from '@construct-space/ui'
import { Eye, EyeOff, Check, Cpu, ClipboardCopy } from 'lucide-vue-next'

const toast = useNotification()
const route = useRoute()

const activeTab = ref<'models' | 'providers' | 'auth'>('models')

// AI Model selection
const { modelsByProvider, defaultModelId, setDefaultModel, allModels, resolveModelId, loadProviders } = useAIModel()

const PROVIDER_LABELS: Record<string, string> = {
  'anthropic': 'Anthropic',
  'anthropic-oauth': 'Anthropic',
  'deepseek': 'DeepSeek',
  'mimo': 'MiMo',
  'openai': 'OpenAI',
  'openai-oauth': 'OpenAI',
  'xai': 'xAI',
  'openrouter': 'OpenRouter',
  'zai': 'Z.AI',
  'github-copilot': 'GitHub Copilot',
  'google-gemini-cli': 'Google Gemini',
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
  'gpt-5-mini': 'GPT-5 Mini',
  'gpt-5.4': 'GPT-5.4',
  'gpt-5.4-mini': 'GPT-5.4 Mini',
  'gpt-5.3-codex': 'GPT-5.3 Codex',
  'gpt-5.3-codex-spark': 'GPT-5.3 Codex Spark',
  'gpt-5.2-codex': 'GPT-5.2 Codex',
  'gpt-5.2': 'GPT-5.2',
  'gpt-5.1-codex': 'GPT-5.1 Codex',
  'gpt-5.1-codex-max': 'GPT-5.1 Codex Max',
  'gpt-5.1-codex-mini': 'GPT-5.1 Codex Mini',
  'gpt-4.1': 'GPT-4.1',
  'gpt-4.1-mini': 'GPT-4.1 Mini',
  'gpt-4.1-nano': 'GPT-4.1 Nano',
  'gpt-4o': 'GPT-4o',
  'gpt-4o-mini': 'GPT-4o Mini',
  'claude-haiku-4.5': 'Claude Haiku 4.5',
  'claude-sonnet-4.6': 'Claude Sonnet 4.6',
  'claude-opus-4.6': 'Claude Opus 4.6',
  'claude-opus-4.6-fast': 'Claude Opus 4.6 Fast',
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

function formatProviderLabel(raw: string) {
  const normalized = raw.trim()
  if (!normalized) return 'Provider'
  const normalizedLower = normalized.toLowerCase()
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

function authLabel(authType: 'oauth' | 'api' | 'local') {
  if (authType === 'oauth') return 'OAuth'
  if (authType === 'local') return 'Local'
  return 'API key'
}

function providerDescription(authType: 'oauth' | 'api' | 'local') {
  if (authType === 'local') return 'Runs against locally available models.'
  if (authType === 'oauth') return 'Available after connecting the matching account.'
  return 'Enabled by the provider credentials saved in Construct.'
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
  if (model) return formatProviderLabel(model.providerLabel || model.providerId)
  if (hasExplicitDefaultModel.value) {
    return 'This saved default requires an active provider connection. Connect the provider, then choose a new default.'
  }
  return 'Pick one model to make it the default for Coder, Architect, and Assistant.'
})

const capabilityFilter = ref<string | null>(null)

const availableModelGroups = computed(() =>
  modelsByProvider.value
    .filter(group => group.provider.active !== false && group.models.length > 0)
    .map(group => {
      const models = group.models.map(model => ({
        ...model,
        displayLabel: formatModelLabel(model.label),
        capabilities: (model as any).capabilities as string[] | undefined,
      }))
      return {
        ...group,
        active: true,
        displayLabel: formatProviderLabel(group.provider.label || group.provider.id),
        authDisplayLabel: authLabel(group.authType),
        description: providerDescription(group.authType),
        models: capabilityFilter.value
          ? models.filter(m => m.capabilities?.includes(capabilityFilter.value!))
          : models,
      }
    })
    .filter(group => group.models.length > 0),
)

const accordionItems = computed(() =>
  availableModelGroups.value.map(group => ({
    label: `${group.displayLabel}  ·  ${group.models.length} model${group.models.length === 1 ? '' : 's'}`,
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

const operator = useOperator()

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
  { id: 'google', name: 'Google AI', description: 'Gemini 2.5 Pro/Flash models', placeholder: 'AIza...', kvKey: 'provider_key:google' },
  { id: 'freepik', name: 'Freepik', description: 'Image gen, video, editing, audio (Mystic, Flux, Kling)', placeholder: 'fpk-...', kvKey: 'provider_key:freepik' },
  { id: 'deepseek', name: 'DeepSeek', description: 'DeepSeek V3/R1 models', placeholder: 'sk-...', kvKey: 'provider_key:deepseek' },
  { id: 'xai', name: 'xAI (Grok)', description: 'Grok models', placeholder: 'xai-...', kvKey: 'provider_key:xai' },
  { id: 'openrouter', name: 'OpenRouter', description: 'Access 600+ models from multiple providers', placeholder: 'sk-or-...', kvKey: 'provider_key:openrouter' },
  { id: 'mistral', name: 'Mistral', description: 'Mistral Large, Medium, Small models', placeholder: 'API key', kvKey: 'provider_key:mistral' },
  { id: 'zai', name: 'Z.AI', description: 'GLM / CogView models', placeholder: 'API key', kvKey: 'provider_key:zai' },
  { id: 'mimo', name: 'Xiaomi MiMo', description: 'MiMo reasoning model', placeholder: 'API key', kvKey: 'provider_key:mimo' },
  { id: 'kimi', name: 'Kimi (Moonshot)', description: 'Moonshot AI models', placeholder: 'API key', kvKey: 'provider_key:kimi' },
]

type OAuthProviderCard = {
  id: string
  name: string
  description: string
  connected: boolean
  models: string[]
  runtime: boolean
  email?: string
}

const oauthProviders = reactive<OAuthProviderCard[]>([
  { id: 'anthropic', name: 'Claude Pro/Max', description: 'Direct login with your Anthropic account', connected: false, models: [], runtime: true },
  { id: 'openai-codex', name: 'ChatGPT Plus/Pro', description: 'Direct login with your OpenAI account', connected: false, models: [], runtime: true },
  { id: 'github-copilot', name: 'GitHub Copilot', description: 'Claude, GPT, Gemini via GitHub Copilot subscription', connected: false, models: [], runtime: false },
  { id: 'google-gemini-cli', name: 'Google Gemini', description: 'Gemini models via Google Cloud Code Assist', connected: false, models: [], runtime: false },
])

const oauthLoading = ref<Record<string, boolean>>({})
const deviceCode = ref<{ provider: string; code: string; url: string } | null>(null)
const ghCheck = ref<{ username: string; token: string } | null>(null)
let devicePollTimer: ReturnType<typeof setTimeout> | null = null

async function ensureOperatorConnected() {
  if (!operator.isTauri.value || operator.connected.value) return
  await operator.connect()
}

async function refreshOAuthProviders() {
  try {
    const result = await operator.send('oauth.providers', {}) as {
      providers?: Array<{
        id?: string
        name?: string
        connected?: boolean
        models?: string[]
        runtime?: boolean
        email?: string
      }>
    }
    const byId = new Map((result.providers || [])
      .filter(provider => provider.id)
      .map(provider => [provider.id as string, provider]))

    for (const provider of oauthProviders) {
      const next = byId.get(provider.id)
      provider.connected = !!next?.connected
      provider.models = Array.isArray(next?.models) ? next.models : []
      provider.runtime = typeof next?.runtime === 'boolean' ? next.runtime : provider.runtime
      provider.email = typeof next?.email === 'string' ? next.email : undefined
      if (typeof next?.name === 'string' && next.name.trim()) {
        provider.name = next.name
      }
    }
  } catch {
    for (const provider of oauthProviders) {
      provider.connected = false
      provider.email = undefined
    }
  }
}

async function startOAuthLogin(providerId: string) {
  oauthLoading.value[providerId] = true
  let keepLoading = false
  try {
    await ensureOperatorConnected()

    // GitHub Copilot: check for existing gh CLI auth first
    if (providerId === 'github-copilot') {
      try {
        const check = await operator.send('oauth.gh-check', {}) as { logged_in?: boolean; username?: string; token?: string }
        if (check?.logged_in && check?.username && check?.token) {
          ghCheck.value = { username: check.username, token: check.token }
          oauthLoading.value[providerId] = false
          return // Wait for user to accept/decline via UI
        }
      } catch { /* gh not available, proceed with device flow */ }
      // No gh auth — start device code flow
      await startDeviceCodeFlow(providerId)
      return
    }

    // Standard OAuth flow (Anthropic, OpenAI, Gemini) — non-blocking
    toast.add({ title: 'Opening browser for login...', color: 'info' })
    const result = await operator.send('oauth.login', { provider: providerId })

    if (result?.pending) {
      // Flow started in background — poll for completion
      keepLoading = true
      pollOAuthFlow(providerId)
      return
    }

    if (result?.success) {
      const provider = oauthProviders.find(entry => entry.id === providerId)
      await refreshOAuthProviders()
      toast.add({ title: `${provider?.name || providerId} connected`, color: 'success' })
      await loadProviders(5, providerId)
    }
  } catch (e) {
    deviceCode.value = null
    ghCheck.value = null
    const msg = e instanceof Error ? e.message : String(e)
    toast.add({ title: `Login failed: ${msg}`, color: 'error' })
  } finally {
    if (!keepLoading) oauthLoading.value[providerId] = false
  }
}

async function acceptGhAuth() {
  if (!ghCheck.value) return
  oauthLoading.value['github-copilot'] = true
  try {
    await ensureOperatorConnected()
    const result = await operator.send('oauth.gh-use-token', { token: ghCheck.value.token })
    if (result?.success) {
      await refreshOAuthProviders()
      await loadProviders(5, 'github-copilot')
      toast.add({ title: 'GitHub Copilot connected', color: 'success' })
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    toast.add({ title: `Failed: ${msg}`, color: 'error' })
  } finally {
    ghCheck.value = null
    oauthLoading.value['github-copilot'] = false
  }
}

async function declineGhAuth() {
  ghCheck.value = null
  oauthLoading.value['github-copilot'] = true
  await startDeviceCodeFlow('github-copilot')
}

async function startDeviceCodeFlow(providerId: string) {
  try {
    await ensureOperatorConnected()
    toast.add({ title: 'Starting device code flow...', color: 'info' })
    const result = await operator.send('oauth.login', { provider: providerId })

    if (result?.device_code && result?.user_code) {
      deviceCode.value = { provider: providerId, code: String(result.user_code), url: String(result.url || '') }
      // Start non-blocking polling
      pollDeviceCode(providerId)
    }
  } catch (e) {
    deviceCode.value = null
    const msg = e instanceof Error ? e.message : String(e)
    toast.add({ title: `Login failed: ${msg}`, color: 'error' })
    oauthLoading.value[providerId] = false
  }
}

async function pollDeviceCode(providerId: string) {
  try {
    const result = await operator.send('oauth.device-poll', { provider: providerId })
    if (result?.status === 'pending') {
      // Poll again in 5 seconds
      devicePollTimer = setTimeout(() => pollDeviceCode(providerId), 5000)
      return
    }
    if (result?.success) {
      const provider = oauthProviders.find(entry => entry.id === providerId)
      await refreshOAuthProviders()
      await loadProviders(5, providerId)
      toast.add({ title: `${provider?.name || providerId} connected`, color: 'success' })
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    toast.add({ title: `Login failed: ${msg}`, color: 'error' })
  } finally {
    deviceCode.value = null
    oauthLoading.value[providerId] = false
    if (devicePollTimer) {
      clearTimeout(devicePollTimer)
      devicePollTimer = null
    }
  }
}

let oauthPollTimer: ReturnType<typeof setTimeout> | null = null

async function pollOAuthFlow(providerId: string) {
  try {
    const result = await operator.send('oauth.poll', { provider: providerId })
    if (result?.status === 'pending') {
      oauthPollTimer = setTimeout(() => pollOAuthFlow(providerId), 2000)
      return
    }
    // Flow completed (success or error from operator)
    oauthPollTimer = null
    oauthLoading.value[providerId] = false
    if (result?.success) {
      const provider = oauthProviders.find(entry => entry.id === providerId)
      await refreshOAuthProviders()
      await loadProviders(5, providerId)
      toast.add({ title: `${provider?.name || providerId} connected`, color: 'success' })
    }
  } catch (e) {
    oauthPollTimer = null
    oauthLoading.value[providerId] = false
    // Poll may fail if operator restarted — check if login completed anyway
    await refreshOAuthProviders()
    const provider = oauthProviders.find(entry => entry.id === providerId)
    if (provider?.connected) {
      await loadProviders(5, providerId)
      toast.add({ title: `${provider.name} connected`, color: 'success' })
    } else {
      const msg = e instanceof Error ? e.message : String(e)
      toast.add({ title: `Login failed: ${msg}`, color: 'error' })
    }
  }
}

async function copyDeviceCode() {
  if (!deviceCode.value) return
  try {
    const { writeText } = await import('@tauri-apps/plugin-clipboard-manager')
    await writeText(deviceCode.value.code)
  } catch {
    try { await navigator.clipboard.writeText(deviceCode.value.code) } catch { /* ignore */ }
  }
  toast.add({ title: 'Code copied to clipboard', color: 'success' })
}

function cancelDeviceCode() {
  if (devicePollTimer) {
    clearTimeout(devicePollTimer)
    devicePollTimer = null
  }
  const providerId = deviceCode.value?.provider
  deviceCode.value = null
  if (providerId) oauthLoading.value[providerId] = false
}

async function disconnectOAuthProvider(providerId: string) {
  oauthLoading.value[providerId] = true
  try {
    await operator.send('oauth.logout', { provider: providerId })
    await refreshOAuthProviders()
    await loadProviders(5, providerId)
    const provider = oauthProviders.find(entry => entry.id === providerId)
    toast.add({ title: `${provider?.name || providerId} disconnected`, color: 'info' })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    toast.add({ title: `Disconnect failed: ${msg}`, color: 'error' })
  } finally {
    oauthLoading.value[providerId] = false
  }
}

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
    await loadProviders(5, provider.id)
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
    await loadProviders(5, provider.id)
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

onMounted(async () => {
  try {
    if (route.query.connect === 'oauth' || route.query.connect === 'openai') {
      activeTab.value = 'auth'
    }
    await ensureOperatorConnected()
    await loadProviders()
    await refreshOAuthProviders()
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
      <button class="px-4 py-1.5 text-sm rounded-md transition-colors cursor-pointer"
        :class="activeTab === 'models' ? 'bg-app-accent text-white' : 'text-[var(--app-muted)] hover:text-[var(--app-foreground)]'"
        @click="activeTab = 'models'">
        Models
      </button>
      <button class="px-4 py-1.5 text-sm rounded-md transition-colors cursor-pointer"
        :class="activeTab === 'providers' ? 'bg-app-accent text-white' : 'text-[var(--app-muted)] hover:text-[var(--app-foreground)]'"
        @click="activeTab = 'providers'">
        Providers
      </button>
      <button class="px-4 py-1.5 text-sm rounded-md transition-colors cursor-pointer"
        :class="activeTab === 'auth' ? 'bg-app-accent text-white' : 'text-[var(--app-muted)] hover:text-[var(--app-foreground)]'"
        @click="activeTab = 'auth'">
        Auth
      </button>
    </div>

    <!-- Models Tab -->
    <template v-if="activeTab === 'models'">
      <div class="space-y-4">
        <!-- Current default -->
        <div
          class="flex items-center justify-between rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] px-4 py-3">
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

        <!-- Filter pills -->
        <div class="flex gap-1.5 flex-wrap">
          <button
            class="px-2.5 py-1 text-[11px] rounded-full border transition-colors"
            :class="!capabilityFilter
              ? 'bg-[var(--app-accent)]/10 border-[var(--app-accent)]/30 text-[var(--app-accent)]'
              : 'border-[var(--app-border)] text-[var(--app-muted)] hover:text-[var(--app-foreground)]'"
            @click="capabilityFilter = null">
            All
          </button>
          <button v-for="cap in ['tools', 'vision', 'reasoning', 'structured']" :key="cap"
            class="px-2.5 py-1 text-[11px] rounded-full border transition-colors inline-flex items-center gap-1"
            :class="capabilityFilter === cap
              ? 'bg-[var(--app-accent)]/10 border-[var(--app-accent)]/30 text-[var(--app-accent)]'
              : 'border-[var(--app-border)] text-[var(--app-muted)] hover:text-[var(--app-foreground)]'"
            @click="capabilityFilter = capabilityFilter === cap ? null : cap">
            <span v-if="cap === 'tools'">&#9881;</span>
            <span v-else-if="cap === 'vision'">&#128065;</span>
            <span v-else-if="cap === 'reasoning'">&#129504;</span>
            <span v-else-if="cap === 'structured'">&#123;&#125;</span>
            {{ cap }}
          </button>
        </div>

        <!-- Grouped model list (collapsible) -->
        <div v-if="availableModelGroups.length > 0"
          class="rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] overflow-hidden">
          <Accordion :items="accordionItems" type="multiple" :default-value="accordionDefaultValue"
            :ui="{ trigger: 'flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-[var(--app-foreground)] hover:bg-[var(--app-background)] transition-colors [&[data-state=open]>svg]:rotate-180' }">
            <template #body="{ item }">
              <div class="px-4 pb-2">
                <template v-for="group in [availableModelGroups.find(g => g.provider.id === item.value)]" :key="item.value">
                  <button v-for="model in group?.models || []"
                    :key="model.compositeId"
                    class="flex items-center justify-between w-full px-2 py-1.5 rounded-md text-left transition-colors"
                    :class="[
                      resolvedDefaultModelId === model.compositeId
                        ? 'bg-[var(--app-accent)]/10 text-[var(--app-foreground)] cursor-pointer'
                        : 'text-[var(--app-muted)] hover:bg-[var(--app-background)] hover:text-[var(--app-foreground)] cursor-pointer'
                    ]"
                    @click="setDefaultModel(model.compositeId)">
                    <div class="flex items-center gap-2 min-w-0">
                      <span class="text-sm truncate">{{ model.displayLabel }}</span>
                      <span v-if="model.capabilities?.length" class="flex gap-0.5 shrink-0">
                        <span v-if="model.capabilities.includes('tools')" title="Tool calling" class="text-[10px] opacity-50">&#9881;</span>
                        <span v-if="model.capabilities.includes('vision')" title="Vision" class="text-[10px] opacity-50">&#128065;</span>
                        <span v-if="model.capabilities.includes('reasoning')" title="Reasoning" class="text-[10px] opacity-50">&#129504;</span>
                        <span v-if="model.capabilities.includes('structured')" title="Structured output" class="text-[10px] opacity-50">&#123;&#125;</span>
                      </span>
                    </div>
                    <Check v-if="resolvedDefaultModelId === model.compositeId"
                      class="size-3.5 text-[var(--app-accent)] shrink-0" />
                  </button>
                </template>
              </div>
            </template>
          </Accordion>
        </div>

        <!-- Empty state -->
        <div v-else
          class="rounded-lg border border-dashed border-[var(--app-border)] bg-[var(--app-surface)] px-6 py-8 text-center">
          <p class="text-sm font-medium text-[var(--app-foreground)]">No models available</p>
          <p class="mt-1 text-xs text-[var(--app-muted)]">
Add an API key or connect a provider to get started.
          </p>
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
        <p class="text-xs text-[var(--app-muted)] mb-2">
{{ providers.filter(p => configuredProviders[p.id]).length }} of
          {{ providers.length }} providers configured
</p>
        <p class="text-xs text-[var(--app-muted)] mb-4">
Add API keys to enable additional providers. Keys are stored
          locally in the operator service.
</p>

        <div class="space-y-3">
          <div v-for="provider in providers" :key="provider.id"
            class="p-4 rounded-lg border border-[var(--app-border)]">
            <div class="flex items-center justify-between mb-2">
              <div>
                <p class="text-sm font-medium text-[var(--app-foreground)]">{{ provider.name }}</p>
                <p class="text-xs text-[var(--app-muted)]">{{ provider.description }}</p>
              </div>
              <span v-if="configuredProviders[provider.id]"
                class="px-2 py-0.5 text-[10px] rounded-full bg-green-500/10 text-green-500">
                Configured
              </span>
            </div>

            <div class="flex gap-2">
              <div class="flex-1 relative">
                <Input v-model="apiKeys[provider.id]" :type="visibleKeys[provider.id] ? 'text' : 'password'"
                  :placeholder="provider.placeholder" size="sm" />
                <button v-if="apiKeys[provider.id]"
                  class="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--app-muted)] hover:text-[var(--app-foreground)] transition-colors"
                  @click="toggleVisibility(provider.id)">
                  <component :is="visibleKeys[provider.id] ? EyeOff : Eye" class="size-3.5" />
                </button>
              </div>

              <Button v-if="savedKeys[provider.id]" size="sm" variant="ghost" disabled>
                <Check class="size-3.5 text-green-500" />
              </Button>
              <Button v-else size="sm" :loading="savingKeys[provider.id]" :disabled="!apiKeys[provider.id]?.trim()"
                label="Save" @click="saveKey(provider)" />
              <Button v-if="apiKeys[provider.id] || configuredProviders[provider.id]" size="sm" variant="ghost" color="error" label="Clear"
                @click="clearKey(provider)" />
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- Auth Tab -->
    <template v-else-if="activeTab === 'auth'">
      <div class="space-y-6">
        <!-- OAuth Providers -->
        <div>
          <h3 class="text-xs text-[var(--app-muted)] uppercase tracking-widest font-medium mb-4">OAuth Login</h3>
          <p class="text-xs text-[var(--app-muted)] mb-4">
Login directly with your subscription. Opens browser to authenticate.
</p>

          <!-- GitHub CLI detected prompt -->
          <div v-if="ghCheck" class="mb-4 p-4 rounded-lg border border-green-500/30 bg-green-500/5">
            <p class="text-sm font-medium text-[var(--app-foreground)] mb-2">
              You are logged in to GitHub as <span class="font-bold text-green-400">{{ ghCheck.username }}</span>. Use
              this account?
            </p>
            <div class="flex gap-2 mt-3">
              <button
                class="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-500 transition-colors"
                @click="acceptGhAuth">
                Yes, connect
              </button>
              <button
                class="px-4 py-2 rounded-lg border border-[var(--app-border)] text-sm text-[var(--app-foreground)] hover:bg-[color-mix(in_srgb,var(--app-foreground)_5%,transparent)] transition-colors"
                @click="declineGhAuth">
                No, use device code
              </button>
            </div>
          </div>

          <!-- Device code prompt (GitHub Copilot) -->
          <div v-if="deviceCode" class="mb-4 p-4 rounded-lg border border-yellow-500/30 bg-yellow-500/5">
            <p class="text-sm font-medium text-[var(--app-foreground)] mb-2">Enter this code on GitHub:</p>
            <div class="flex items-center justify-center gap-3 py-3">
              <p class="text-2xl font-mono font-bold tracking-[0.3em] text-yellow-400">{{ deviceCode.code }}</p>
              <button
                class="p-2 rounded-lg border border-[var(--app-border)] hover:bg-[color-mix(in_srgb,var(--app-foreground)_5%,transparent)] transition-colors"
                title="Copy code" @click="copyDeviceCode">
                <ClipboardCopy class="size-4 text-[var(--app-muted)]" />
              </button>
            </div>
            <p class="text-xs text-[var(--app-muted)] text-center mb-3">Waiting for authorization...</p>
            <div class="flex justify-center">
              <button class="text-xs text-[var(--app-muted)] hover:text-[var(--app-foreground)] transition-colors"
                @click="cancelDeviceCode">
                Cancel
              </button>
            </div>
          </div>

          <div class="space-y-3">
            <div v-for="oauthProvider in oauthProviders" :key="oauthProvider.id"
              class="p-4 rounded-lg border transition-colors"
              :class="oauthProvider.connected ? 'bg-green-500/5 border-green-500/20' : 'border-[var(--app-border)]'">
              <!-- Connected state -->
              <div v-if="oauthProvider.connected && !oauthLoading[oauthProvider.id]"
                class="flex items-center justify-between">
                <div class="flex items-center gap-3 min-w-0">
                  <svg class="w-5 h-5 text-green-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    stroke-width="2">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                  <div class="min-w-0">
                    <p class="text-sm font-medium text-[var(--app-foreground)]">{{ oauthProvider.name }}</p>
                    <p v-if="oauthProvider.email" class="text-xs text-[var(--app-muted)]">{{ oauthProvider.email }}</p>
                    <p v-else class="text-xs text-[var(--app-muted)]">Connected</p>
                  </div>
                </div>
                <Button variant="ghost" color="error" size="sm" label="Disconnect"
                  @click="disconnectOAuthProvider(oauthProvider.id)" />
              </div>

              <!-- Disconnected / loading state -->
              <div v-else class="flex items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium text-[var(--app-foreground)]">{{ oauthProvider.name }}</p>
                  <p class="text-xs text-[var(--app-muted)] mt-0.5">{{ oauthProvider.description }}</p>
                </div>
                <Button class="shrink-0 self-start" size="sm" label="Login" :loading="oauthLoading[oauthProvider.id]"
                  :disabled="oauthLoading[oauthProvider.id]" @click="startOAuthLogin(oauthProvider.id)" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
