/**
 * Provider catalog — frontend's view of available AI providers + models.
 *
 * Source of truth: `my.construct.space/api/source/providers`. Brain
 * (the sidecar) owns fetching, caching with ETag, and 5-minute refresh.
 * The frontend just asks brain via `models.list`; nothing here talks to
 * the gateway directly or to the operator's modelspec module anymore.
 *
 * If brain is down, this composable yields an empty catalog and callers
 * fall back to whatever defaults they already had — same as before.
 */

import { ref } from 'vue'
import type { AIProvider, ProviderModel } from '@/brain/types'
import { useBrain } from '@/brain'

const brain = useBrain()

// Wire shape brain returns from `models.list`. Mirrors the public
// `/api/source/providers` response.
interface RemoteModel {
  id: string
  name: string
  capabilities?: string[]
  context_window?: number
  max_output_tokens?: number
  input_cost_per_1m?: number
  output_cost_per_1m?: number
  default?: boolean
  deprecated?: boolean
  replaced_by?: string
  min_app_version?: string
  tier_hint?: 'large' | 'medium' | 'small' | ''
}

interface RemoteApiKeyMode {
  enabled: boolean
  base_url?: string
  env_keys?: string[]
  docs_url?: string
  signup_url?: string
  has_shared_key?: boolean
}

interface RemoteMonthlyMode {
  enabled: boolean
  auth_type?: string
  base_url?: string
  oauth_config?: Record<string, unknown>
  docs_url?: string
  signup_url?: string
}

interface RemoteProvider {
  id: string
  slug: string
  name: string
  description?: string
  auth_type?: string
  base_url?: string
  oauth_config?: Record<string, unknown>
  env_keys?: string[]
  capabilities?: string[]
  docs_url?: string
  signup_url?: string
  icon?: string
  has_shared_key?: boolean
  min_app_version?: string
  api_key?: RemoteApiKeyMode
  monthly?: RemoteMonthlyMode
  models: RemoteModel[]
}

interface BrainCatalog {
  data?: RemoteProvider[]
  providers?: RemoteProvider[] // brain's Go struct uses "data"; tolerate either
  version?: string
  Version?: string
}

const catalog = ref<AIProvider[]>([])
const catalogVersion = ref<string>('')
const loading = ref(false)
const lastFetchedAt = ref(0)

function normalizeAuthType(raw?: string): AIProvider['authType'] {
  if (!raw) return 'api'
  if (raw === 'local') return 'local'
  if (raw.startsWith('oauth')) return 'oauth'
  return 'api'
}

function mapRemoteModel(m: RemoteModel): ProviderModel {
  const hint = m.tier_hint
  return {
    id: m.id,
    label: m.name,
    capabilities: m.capabilities,
    contextWindow: m.context_window,
    maxOutputTokens: m.max_output_tokens,
    inputCostPer1M: m.input_cost_per_1m,
    outputCostPer1M: m.output_cost_per_1m,
    default: m.default,
    deprecated: m.deprecated,
    replacedBy: m.replaced_by,
    minAppVersion: m.min_app_version,
    ...(hint === 'large' || hint === 'medium' || hint === 'small' ? { tierHint: hint } : {}),
  }
}

function mapRemoteProvider(p: RemoteProvider): AIProvider {
  return {
    id: p.id,
    slug: p.slug,
    label: p.name,
    description: p.description,
    authType: normalizeAuthType(p.auth_type),
    baseUrl: p.base_url,
    oauthConfig: p.oauth_config,
    envKeys: p.env_keys,
    capabilities: p.capabilities,
    docsUrl: p.docs_url,
    signupUrl: p.signup_url,
    icon: p.icon,
    hasSharedKey: !!p.has_shared_key,
    minAppVersion: p.min_app_version,
    apiKey: p.api_key
      ? {
          enabled: p.api_key.enabled,
          baseUrl: p.api_key.base_url,
          envKeys: p.api_key.env_keys,
          docsUrl: p.api_key.docs_url,
          signupUrl: p.api_key.signup_url,
          hasSharedKey: !!p.api_key.has_shared_key,
        }
      : undefined,
    monthly: p.monthly
      ? {
          enabled: p.monthly.enabled,
          authType: p.monthly.auth_type,
          baseUrl: p.monthly.base_url,
          oauthConfig: p.monthly.oauth_config,
          docsUrl: p.monthly.docs_url,
          signupUrl: p.monthly.signup_url,
        }
      : undefined,
    models: (p.models || []).map(mapRemoteModel),
    active: false,
  }
}

function providersFromCatalogBody(body: BrainCatalog): RemoteProvider[] {
  if (Array.isArray(body.data)) return body.data
  if (Array.isArray(body.providers)) return body.providers
  return []
}

function versionFromCatalogBody(body: BrainCatalog): string {
  return body.version || body.Version || ''
}

export function useProviderCatalog() {
  async function load(force = false) {
    if (loading.value) return
    if (!force && catalog.value.length > 0 && Date.now() - lastFetchedAt.value < 60_000) return
    loading.value = true
    try {
      const body = (await brain.listModels()) as BrainCatalog
      const providers = providersFromCatalogBody(body).map(mapRemoteProvider)
      catalog.value = providers
      catalogVersion.value = versionFromCatalogBody(body)
      lastFetchedAt.value = Date.now()
    } catch (err) {
      // Brain unreachable: keep whatever's in cache; callers fall back.
      console.warn('[providerCatalog] brain.models.list failed:', err)
    } finally {
      loading.value = false
    }
  }

  // Brain refreshes from the gateway every 5 min on its own, so the
  // frontend doesn't need its own version-poller. We keep the same
  // surface for callers that already call these and let them be no-ops.
  async function checkForUpdates() {
    await load(true)
  }
  function startVersionPolling() {
    /* brain handles refresh */
  }
  function stopVersionPolling() {
    /* brain handles refresh */
  }

  return {
    catalog,
    catalogVersion,
    loading,
    load,
    checkForUpdates,
    startVersionPolling,
    stopVersionPolling,
  }
}
