<script setup lang="ts">
/**
 * LLMProvidersPanel — dispatch-only shell. Renders one card per catalog
 * provider by resolving the provider id to a specialised component in
 * components/settings/providers/. All per-provider UI lives in the
 * individual cards (AnthropicCard, OpenAICard, MiMoCard, GoogleCard,
 * LocalCard, GenericCard fallback).
 *
 * Filter + search come from the parent page (LLMProviders.vue).
 */

import { computed, onMounted, ref, watch } from 'vue'
import { useProviderCatalog } from '@/composables/useProviderCatalog'
import { useContextDB } from '@/composables/useContextDB'
import { useBrain } from '@/brain'
import type { AIProvider } from '@/brain/types'
import { resolveProviderCard } from '@/components/settings/providers'
import { configuredVersion } from '@/composables/useProviderCard'
import { useOrgStore } from '@/stores/org'

// Maps a catalog provider id to the oauth flow id(s) its cards use to
// sign in. "Configured" for these providers means either an API key is
// saved OR any of these oauth flows is connected — otherwise a user
// signed into Claude Pro/Max without an API key shows up as Not set up.
// Keep in sync with each card's OAUTH_PROVIDER_ID constant.
const OAUTH_FLOW_IDS: Record<string, string[]> = {
  anthropic: ['claude'],
  openai: ['openai-codex'],
  google: ['google-gemini-cli'],
}

const props = withDefaults(
  defineProps<{
    filter?: 'all' | 'configured' | 'not_configured'
    search?: string
  }>(),
  { filter: 'all', search: '' },
)

const catalog = useProviderCatalog()
const db = useContextDB()
const brain = useBrain()
const orgStore = useOrgStore()

const configured = ref<Record<string, boolean>>({})
const loading = ref(false)
const refreshing = ref(false)

// Construct synthetic provider — fetched from provider-api's picker
// entries via /api/construct/models (legacy alias) on my.construct.space.
// Lives outside the BYOK catalog (different backend, different auth
// model), so we prepend it to the panel manually rather than mixing it
// into provider_catalog.
const constructProvider = ref<AIProvider | null>(null)

async function loadConstruct() {
  try {
    // Provider-api's picker entries. Returns the user-facing chat
    // models the gateway exposes; brain hits the same gateway via
    // /api/inference/v1/chat/completions using the session token, and
    // Source Family routing picks the upstream server-side.
    const res = await fetch('https://my.construct.space/api/construct/models')
    if (!res.ok) return
    const data = await res.json() as {
      enabled?: boolean
      daily_allowance?: number
      models: Array<{
        id: string
        label: string
        description?: string
        icon?: string
        capabilities?: string[]
      }>
    }
    if (!data.models?.length) return

    constructProvider.value = {
      id: 'construct',
      label: 'Construct',
      authType: 'local', // no API key required; the gateway routes by identity
      description: 'Auto-routed across the Source family.',
      models: data.models.map(m => ({
        id: m.id,
        label: m.label,
        capabilities: m.capabilities ?? [],
      })),
    }
  } catch (e) {
    console.warn('[LLMProvidersPanel] construct models fetch failed:', e)
  }
}

type LegacyProvider = AIProvider & { auth_type?: string }
interface OAuthProviderEntry {
  id?: string
  connected?: boolean
}
interface OAuthProvidersResponse {
  data?: { providers?: OAuthProviderEntry[] }
  providers?: OAuthProviderEntry[]
}
interface SettingResponse {
  value?: string
}

// Normalise legacy-shape responses. When source hasn't been redeployed
// with the api_key / monthly blocks yet, synthesize a block from the
// flat legacy fields so the cards still get non-null apiKey/monthly.
function normalizeProvider(p: AIProvider): AIProvider {
  if (p.apiKey || p.monthly) return p
  const legacy = p as LegacyProvider
  const isOauth =
    p.authType === 'oauth' ||
    (typeof legacy.auth_type === 'string' && legacy.auth_type.startsWith('oauth'))
  if (isOauth) {
    return {
      ...p,
      monthly: {
        enabled: true,
        authType: legacy.auth_type || 'oauth_pkce',
        baseUrl: p.baseUrl,
        oauthConfig: p.oauthConfig,
        docsUrl: p.docsUrl,
        signupUrl: p.signupUrl,
      },
    }
  }
  return {
    ...p,
    apiKey: {
      enabled: true,
      baseUrl: p.baseUrl,
      envKeys: p.envKeys,
      docsUrl: p.docsUrl,
      signupUrl: p.signupUrl,
      hasSharedKey: p.hasSharedKey,
    },
  }
}

// OpenRouter is a gateway aggregator — push it to the end so the first-
// party providers (Anthropic, OpenAI, Google, etc.) lead the list.
const SORT_LAST = new Set(['openrouter'])

// Local-runtime providers always appear in the list regardless of what
// the catalog returns. The catalog can be offline, stale, or simply
// missing these entries, but the user's locally-running Ollama / LM
// Studio doesn't care — they just need Construct pointed at the local
// URL. Synthesising a minimal AIProvider here lets LocalCard render
// (and save a `provider_url:<id>` setting) without any network trip.
// When the catalog *does* return one of these, the real entry wins via
// dedup below — users on a fresh catalog see no duplication.
const ALWAYS_INCLUDED_LOCAL: AIProvider[] = [
  {
    id: 'ollama',
    label: 'Ollama',
    authType: 'local',
    models: [],
    apiKey: { enabled: true, baseUrl: 'http://localhost:11434/v1' },
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    authType: 'local',
    models: [],
    apiKey: { enabled: true, baseUrl: 'http://localhost:1234/v1' },
  },
  {
    id: 'basemlx',
    label: 'BaseMLX',
    authType: 'local',
    models: [],
    apiKey: { enabled: true, baseUrl: 'http://localhost:11435/v1' },
  },
]

const providers = computed<AIProvider[]>(() => {
  const orgManagedProviderIds = new Set(
    (orgStore.managedProviders || []).map(entry => entry.provider),
  )
  const withOrgManagedState = (provider: AIProvider): AIProvider => (
    orgManagedProviderIds.has(provider.id)
      ? { ...provider, orgManaged: true }
      : provider
  )

  const fromCatalog = (catalog.catalog.value || [])
    .map(normalizeProvider)
    .map(withOrgManagedState)
  const seen = new Set(fromCatalog.map(p => p.id))
  // Append the always-included locals that the catalog didn't provide —
  // preserves catalog-supplied metadata (models, labels, icons) when
  // present, falls back to our defaults otherwise.
  const merged = [...fromCatalog]
  for (const local of ALWAYS_INCLUDED_LOCAL) {
    if (!seen.has(local.id)) merged.push(withOrgManagedState(local))
  }
  const sorted = merged.sort((a, b) => {
    const aLast = SORT_LAST.has(a.id) ? 1 : 0
    const bLast = SORT_LAST.has(b.id) ? 1 : 0
    return aLast - bLast
  })
  // Prepend Construct as the platform-managed provider — always first,
  // never duplicated even if a "construct" row leaks into the catalog.
  if (constructProvider.value) {
    return [constructProvider.value, ...sorted.filter(p => p.id !== 'construct')]
  }
  return sorted
})

const filteredProviders = computed<AIProvider[]>(() => {
  const q = (props.search || '').trim().toLowerCase()
  return providers.value.filter((p) => {
    if (props.filter === 'configured' && !configured.value[p.id]) return false
    if (props.filter === 'not_configured' && configured.value[p.id]) return false
    if (!q) return true
    if (p.label.toLowerCase().includes(q)) return true
    if (p.id.toLowerCase().includes(q)) return true
    return (p.models || []).some((m) =>
      m.label.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
    )
  })
})

async function loadConfigured() {
  const out: Record<string, boolean> = {}

  // Pull oauth state once so we don't hit brain per provider.
  // Shape mirrors the panel's prior usage — `providers[]` entries have
  // `{id, connected, ...}` where `id` is the oauth flow id.
  const connectedOAuth = new Set<string>()
  try {
    const resp = await brain.request('oauth.providers', {}) as OAuthProvidersResponse
    const list = resp?.data?.providers || resp?.providers || []
    for (const entry of list) {
      if (entry?.connected && typeof entry.id === 'string') {
        connectedOAuth.add(entry.id)
      }
    }
  } catch {
    // Brain not reachable or RPC absent — fall through, key checks
    // still work on their own.
  }

  async function getSetting(key: string): Promise<string> {
    try {
      const res = (await brain.request('settings.get', { key })) as SettingResponse
      return (res?.value as string) || ''
    } catch {
      return ''
    }
  }

  for (const p of providers.value) {
    // Construct is always-configured — it's session-authed, no key
    // anywhere in settings. Marking it true lets it pass the
    // "Configured" filter and shows up as ready-to-use.
    if (p.id === 'construct') {
      out[p.id] = true
      continue
    }
    // Keys are persisted via operator's settings.set (which triggers the
    // SettingsHook → connector registration). Read from the same store,
    // not from plain kv — those are different backends.
    const apiKey = await getSetting(`provider_key:${p.id}`)
    const monthlyKey = await getSetting(`provider_key_monthly:${p.id}`)
    const urlKey = await db.kvGet(`provider_url:${p.id}`).catch(() => null)
    const oauthIds = OAUTH_FLOW_IDS[p.id] || []
    const oauthConnected = oauthIds.some((id) => connectedOAuth.has(id))
    out[p.id] = !!apiKey || !!monthlyKey || !!urlKey || oauthConnected || !!p.orgManaged
  }
  configured.value = out
}

async function loadOrgManagedProviders() {
  await orgStore.fetchManagedSettings()
  try {
    await brain.request('providers.refresh', {})
  } catch {
    // Older brains do not expose runtime provider refresh; the UI can
    // still reflect org-managed settings and the next brain boot will
    // pick up the shared keys.
  }
}

async function refresh() {
  if (refreshing.value) return
  refreshing.value = true
  try {
    await Promise.all([catalog.load(true), loadConstruct()])
    await loadOrgManagedProviders()
    await loadConfigured()
  } finally {
    refreshing.value = false
  }
}

defineExpose({ refresh, refreshing })

onMounted(async () => {
  loading.value = true
  try {
    await Promise.all([catalog.load(), loadConstruct()])
    await loadOrgManagedProviders()
    await loadConfigured()
    if (import.meta.env.DEV) {
      console.log('[LLMProvidersPanel] catalog providers:', providers.value.map(p => p.id))
    }
  } finally {
    loading.value = false
  }
})

// A provider's config changed (API key saved/removed, or an OAuth card
// bumped this after sign-in/out). Refresh this panel's "configured" badges
// AND the global useAIModel catalog so the model switcher, titlebar, and
// agent sessions pick up the now-(in)active provider without a reload.
watch(configuredVersion, () => {
  void loadConfigured()
  // Dynamic import keeps useAIModel's module-eval side effects out of this
  // component's import graph (and out of node-env tests).
  void import('@/composables/useAIModel').then(m => m.useAIModel().loadProviders())
})
</script>

<template>
  <div>
    <p v-if="loading && !providers.length" class="text-sm text-[var(--app-muted)]">Loading providers…</p>

    <div
      v-if="!loading && filteredProviders.length === 0 && providers.length > 0"
      class="rounded-xl border border-dashed border-[var(--app-border)] p-8 text-center text-sm text-[var(--app-muted)]"
    >
      No providers match this filter.
    </div>

    <component
      :is="resolveProviderCard(p.id)"
      v-for="p in filteredProviders"
      :key="p.id"
      :provider="p"
    />
  </div>
</template>
