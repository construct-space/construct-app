/**
 * AI Model composable
 * Manages default AI model selection with persistence
 *
 * All providers and models come from the context service (Go backend).
 * To add a new provider, add it in context/providers/ - no frontend changes needed.
 */

import { ref, computed, getCurrentScope, watch } from 'vue'
import type { AIProvider } from '@/brain/types'
import { activeProfileIdRef, getActiveProfileId, profileStorage } from '@/lib/profileStorage'

// Storage key for default model (stores "providerId:modelId")
const MODEL_STORAGE_KEY = 'cp_default_ai_model'
const DEFAULT_MODEL = 'zai:GLM-4.7-Flash' // Free Z.AI default when available
const AUTO_MODEL_SENTINELS = new Set(['auto', 'conductor'])
const PROVIDER_FAMILY_DEFAULTS: Record<string, string[]> = {
  anthropic: [
    'claude-haiku-4-5',
    'claude-sonnet-4-6',
    'claude-opus-4-7',
    'claude-opus-4-6',
  ],
  openai: [
    'gpt-5.4-mini',
    'gpt-5.1-codex-mini',
    'gpt-5-mini',
    'gpt-4.1-mini',
    'gpt-4.1-nano',
    'gpt-5.4',
    'gpt-5.3-codex',
    'gpt-5.3-codex-spark',
    'gpt-5.2-codex',
    'gpt-5.2',
    'gpt-5.1-codex-max',
  ],
  deepseek: [
    'deepseek-v4-pro',
    'deepseek-v4-flash',
  ],
  xai: [
    'grok-code-fast-1',
    'grok-4-1-fast-reasoning',
  ],
  mimo: [
    'MiMo-V2-Flash',
    'MiMo-V2-Pro',
    'MiMo-V2-Omni',
  ],
  mistral: [
    'mistral-large-latest',
    'mistral-medium-latest',
    'mistral-small-latest',
    'codestral-latest',
    'pixtral-large-latest',
  ],
  openrouter: [
    'openrouter/free',
    'openai/gpt-oss-20b:free',
    'openai/gpt-oss-120b:free',
    'qwen/qwen3-coder:free',
    'qwen/qwen3-next-80b-a3b-instruct:free',
    'mistralai/mistral-small-3.1-24b-instruct:free',
  ],
  nvidia: [
    'z-ai/glm-5.2',
    'deepseek-ai/deepseek-v4-pro',
    'moonshotai/kimi-k2.6',
    'openai/gpt-oss-120b',
    'qwen/qwen3.5-397b-a17b',
  ],
  zai: [
    'GLM-4.7-Flash',
    'glm-5',
    'glm-5.1',
    'glm-5v-turbo',
    'glm-4.6',
    'glm-4.5',
  ],
}

export type AuthType = 'oauth' | 'api' | 'local'

export interface AIModelOption {
  id: string
  label: string
  providerId: string
  providerLabel: string
  authType: AuthType
  capabilities?: string[]
  tierHint?: 'large' | 'medium' | 'small'
  isDefault?: boolean
  active: boolean
}

// Hardcoded providers — always available regardless of operator connection
const DEFAULT_PROVIDERS: AIProvider[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    authType: 'api',
    active: false,
    models: [
      { id: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    authType: 'api',
    active: false,
    models: [
      { id: 'gpt-5.4', label: 'GPT-5.4' },
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
      { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
      { id: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark' },
      { id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex' },
      { id: 'gpt-5.2', label: 'GPT-5.2' },
      { id: 'gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max' },
      { id: 'gpt-5.1-codex-mini', label: 'GPT-5.1 Codex Mini' },
    ],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    authType: 'api',
    active: false,
    models: [
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
      { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
    ],
  },
  {
    id: 'xai',
    label: 'xAI',
    authType: 'api',
    active: false,
    models: [
      { id: 'grok-code-fast-1', label: 'Grok Code' },
      { id: 'grok-4-1-fast-reasoning', label: 'Grok 4.1 Fast' },
    ],
  },
  {
    id: 'mimo',
    label: 'MiMo',
    authType: 'api',
    active: false,
    models: [
      { id: 'MiMo-V2-Pro', label: 'MiMo V2 Pro' },
      { id: 'MiMo-V2-Omni', label: 'MiMo V2 Omni' },
      { id: 'MiMo-V2-Flash', label: 'MiMo V2 Flash' },
    ],
  },
  {
    id: 'mistral',
    label: 'Mistral',
    authType: 'api',
    active: false,
    models: [
      { id: 'mistral-large-latest', label: 'Mistral Large' },
      { id: 'mistral-medium-latest', label: 'Mistral Medium' },
      { id: 'mistral-small-latest', label: 'Mistral Small' },
      { id: 'codestral-latest', label: 'Codestral' },
      { id: 'pixtral-large-latest', label: 'Pixtral Large', capabilities: ['vision'] },
    ],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    authType: 'api',
    active: false,
    models: [],
  },
  {
    id: 'nvidia',
    label: 'NVIDIA',
    authType: 'api',
    active: false,
    models: [],
  },
]

function cloneProvider(provider: AIProvider): AIProvider {
  return {
    ...provider,
    models: provider.models.map(model => ({
      ...model,
      capabilities: Array.isArray(model.capabilities) ? [...model.capabilities] : model.capabilities,
    })),
  }
}

function createDefaultProviders(): AIProvider[] {
  return DEFAULT_PROVIDERS.map(cloneProvider)
}

function mergeCatalogAndRuntimeModels(
  catalogModels: AIProvider['models'] = [],
  runtimeModels: AIProvider['models'] = [],
): AIProvider['models'] {
  if (catalogModels.length === 0) return runtimeModels

  const runtimeById = new Map(runtimeModels.map(model => [model.id, model]))
  const merged = catalogModels.map((catalogModel) => {
    const runtimeModel = runtimeById.get(catalogModel.id)
    if (!runtimeModel) return catalogModel
    return {
      ...runtimeModel,
      ...catalogModel,
      capabilities: catalogModel.capabilities ?? runtimeModel.capabilities,
    }
  })

  return merged
}

// Shared state across all instances
const providers = ref<AIProvider[]>(createDefaultProviders())
const loading = ref(false)
const initialized = ref(false)
const defaultModelId = ref<string>('')
const providerDefaultModelId = ref<string>('')
let initPromise: Promise<void> | null = null
let activeProfileId = getActiveProfileId()

const isAutoModelId = (modelId?: string | null): boolean => {
  const normalized = (modelId || '').trim().toLowerCase()
  return AUTO_MODEL_SENTINELS.has(normalized)
}

const toCompositeModelId = (providerId: string, modelId: string): string => `${providerId}:${modelId}`
const splitCompositeModelId = (modelId: string): { providerId: string, modelId: string } => {
  const separatorIndex = modelId.indexOf(':')
  if (separatorIndex === -1) {
    return { providerId: '', modelId }
  }
  return {
    providerId: modelId.slice(0, separatorIndex),
    modelId: modelId.slice(separatorIndex + 1),
  }
}
const providerFamily = (providerId: string): string => {
  const normalized = providerId.trim().toLowerCase()
  if (normalized.includes('anthropic')) return 'anthropic'
  if (normalized.includes('openai') || normalized.includes('codex')) return 'openai'
  return normalized
}
const isNotConnectedError = (error: unknown): boolean =>
  String(error).toLowerCase().includes('not connected')

// Load from localStorage on init
const loadFromStorage = () => {
  if (typeof window !== 'undefined') {
    const stored = profileStorage.getItem(MODEL_STORAGE_KEY)?.trim() || ''
    // "Auto" was a short-lived UI mode. Treat it as unset so the app
    // resolves a real model instead of sending "auto" to the operator.
    defaultModelId.value = stored && !isAutoModelId(stored) ? stored : ''
  }
}

const resetForActiveProfile = (profileId = getActiveProfileId()) => {
  activeProfileId = profileId
  providers.value = createDefaultProviders()
  loading.value = false
  initialized.value = false
  defaultModelId.value = ''
  providerDefaultModelId.value = ''
  initPromise = null
  loadFromStorage()
}

const syncActiveProfileState = () => {
  const nextProfileId = getActiveProfileId()
  if (nextProfileId !== activeProfileId) {
    resetForActiveProfile(nextProfileId)
  }
}

// Check if model supports vision
// Handles both plain model IDs and composite IDs (provider:model)
export const isVisionModel = (modelId: string): boolean => {
  const { providerId, modelId: model } = splitCompositeModelId(modelId)

  // Catalog capabilities are authoritative when the model is known —
  // name heuristics can't keep up with org-prefixed ids like NVIDIA's
  // "meta/llama-4-maverick-17b-128e-instruct". Only trust a non-empty
  // list; runtime-only models carry [] and fall through to heuristics.
  for (const provider of providers.value) {
    if (providerId && provider.id !== providerId) continue
    const hit = provider.models.find(m => m.id === model)
    if (hit && Array.isArray(hit.capabilities) && hit.capabilities.length > 0) {
      return hit.capabilities.includes('vision')
    }
  }

  return model.includes('vision') ||
    model.includes('4.6v') ||
    model.startsWith('claude-') ||
    model.includes('claude') ||
    model.startsWith('gpt-5.4') || // GPT-5.4 has vision
    model.startsWith('grok-4') || // Grok 4+ has vision
    model.includes('kimi-k2') || // Kimi K2+ has vision (also org-prefixed ids)
    modelId.includes('anthropic') // Provider-based check for Claude
}

// Load on first import (client-side only)
if (typeof window !== 'undefined' && !initialized.value) {
  loadFromStorage()
}

export const useAIModel = () => {
  syncActiveProfileState()

  // All models flattened with provider info
  // id is "providerId:modelId" for uniqueness
  const allModels = computed<AIModelOption[]>(() => {
    const models: AIModelOption[] = []
    for (const provider of providers.value) {
      for (const model of provider.models) {
        models.push({
          id: `${provider.id}:${model.id}`,
          label: model.label,
          providerId: provider.id,
          providerLabel: provider.label,
          authType: (provider.authType || 'api') as AuthType,
          capabilities: model.capabilities,
          tierHint: model.tierHint,
          isDefault: model.default,
          active: provider.active !== false,
        })
      }
    }
    return models
  })
  const activeModels = computed(() => allModels.value.filter(model => model.active))

  // Models grouped by provider for UI (with composite IDs)
  const modelsByProvider = computed(() => {
    return providers.value.map(provider => ({
      provider,
      models: provider.models.map(m => ({ ...m, compositeId: `${provider.id}:${m.id}` })),
      icon: provider.icon || 'i-lucide-cpu',
      authType: (provider.authType || 'api') as AuthType,
    }))
  })

  // Get current default model details
  const currentModel = computed(() => {
    return allModels.value.find(m => m.id === defaultModelId.value)
  })

  // Get provider for current model
  const currentProvider = computed(() => {
    if (!currentModel.value) return null
    return providers.value.find(p => p.id === currentModel.value?.providerId)
  })

  // Get the raw model ID (without provider prefix) for API calls
  const getModelId = (compositeId: string): string => {
    const resolved = resolveModelId(compositeId, { allowAuto: false })
    return splitCompositeModelId(resolved).modelId
  }

  // Get the provider ID from composite ID
  const getProviderId = (compositeId: string): string => {
    const resolved = resolveModelId(compositeId, { allowAuto: false })
    return splitCompositeModelId(resolved).providerId
  }

  // Set default model (accepts composite ID "providerId:modelId")
  const setDefaultModel = (compositeId: string) => {
    const candidate = compositeId.trim()
    const normalized = isAutoModelId(candidate) ? '' : candidate
    defaultModelId.value = normalized
    if (typeof window !== 'undefined') {
      if (normalized) {
        profileStorage.setItem(MODEL_STORAGE_KEY, normalized)
      } else {
        profileStorage.removeItem(MODEL_STORAGE_KEY)
      }
    }
  }

  const pickActiveModelForFamily = (providerId?: string | null): string | null => {
    const family = providerFamily(providerId || '')
    if (!family) return null

    const matches = activeModels.value.filter(model => providerFamily(model.providerId) === family)
    if (matches.length === 0) return null

    const preferences = PROVIDER_FAMILY_DEFAULTS[family] || []
    for (const preferredModelId of preferences) {
      const preferred = matches.find(model => splitCompositeModelId(model.id).modelId === preferredModelId)
      if (preferred) return preferred.id
    }

    // Catalog-declared default (staff-tuned in oracle-web) — ranks after
    // the curated preference lists above but before positional fallback,
    // so providers without a hardcoded entry get a sane default without
    // a desktop release.
    const catalogDefault = matches.find(model => model.isDefault)
    if (catalogDefault) return catalogDefault.id

    if (family === 'openrouter') {
      const freeTier = matches.find(model => {
        const modelId = splitCompositeModelId(model.id).modelId.toLowerCase()
        return modelId.includes(':free') || modelId.includes('/free')
      })
      if (freeTier) return freeTier.id
    }

    return matches[0]?.id || null
  }

  const pickGlobalDefaultModel = (): string | null => {
    const seenFamilies = new Set<string>()

    for (const model of activeModels.value) {
      const family = providerFamily(model.providerId)
      if (!family || seenFamilies.has(family)) continue
      seenFamilies.add(family)
      const familyDefault = pickActiveModelForFamily(model.providerId)
      if (familyDefault) return familyDefault
    }

    return activeModels.value[0]?.id || null
  }

  const normalizeToAvailableModel = (candidate: string): string | null => {
    const trimmed = candidate.trim()
    if (!trimmed) return null
    if (isAutoModelId(trimmed)) return null
    // Construct is platform-managed — operator always wires it for the
    // signed-in user. Trust the prefix verbatim so a stale catalog or
    // late operator handshake can't drop the selection on the floor.
    if (trimmed.startsWith('construct:')) return trimmed
    const exactActive = activeModels.value.find(model => model.id === trimmed)
    if (exactActive) return exactActive.id

    if (trimmed.includes(':')) {
      const { providerId, modelId } = splitCompositeModelId(trimmed)

      // Provider is registered and active? Trust the user's model pick
      // as-is — the operator's static Models() list is no longer the
      // source of truth now that we fetch live model lists from each
      // provider's /models endpoint. Dated snapshots like
      // claude-sonnet-4-20250514 are legitimate ids returned by Anthropic
      // that just don't appear in our hand-written connector defaults.
      // Without this bypass, normalize would drop them on the next
      // loadProviders() pass and silently swap the user's selection for
      // a static fallback.
      const providerActive = activeModels.value.some(m => splitCompositeModelId(m.id).providerId === providerId)
      if (providerActive) {
        return trimmed
      }

      const preferredFamily = providerFamily(providerId)
      const sameModelMatches = activeModels.value.filter(m => splitCompositeModelId(m.id).modelId === modelId)
      if (sameModelMatches.length > 0) {
        return sameModelMatches.find(m => providerFamily(m.providerId) === preferredFamily)?.id
          || sameModelMatches[0]?.id
          || null
      }

      return pickActiveModelForFamily(providerId)
    }

    // Backward compatibility for old storage format that only kept raw model ID.
    if (!trimmed.includes(':')) {
      const legacyMatch = activeModels.value.find(m => splitCompositeModelId(m.id).modelId === trimmed)
      if (legacyMatch) return legacyMatch.id
    }
    return null
  }

  const resolveModelId = (
    preferredModelId?: string | null,
    options?: {
      allowAuto?: boolean
      fallbackModelId?: string
      persist?: boolean
    },
  ): string => {
    const fallbackModelId = options?.fallbackModelId ?? DEFAULT_MODEL
    const preferred = (preferredModelId ?? defaultModelId.value).trim()
    const normalizedPreferred = isAutoModelId(preferred) ? '' : preferred

    // If providers are not loaded yet, keep current selection as-is.
    // Do not eagerly persist raw legacy IDs before we can validate against provider catalog.
    if (allModels.value.length === 0) {
      const unresolved = normalizedPreferred || fallbackModelId
      const shouldPersist = options?.persist
        && unresolved !== defaultModelId.value
        && unresolved.includes(':')
      if (shouldPersist) {
        setDefaultModel(unresolved)
      }
      return unresolved
    }

    const exact = normalizeToAvailableModel(normalizedPreferred)
    if (exact) {
      if (options?.persist && exact !== defaultModelId.value) {
        setDefaultModel(exact)
      }
      return exact
    }

    const preferredProviderId = normalizedPreferred.includes(':')
      ? splitCompositeModelId(normalizedPreferred).providerId
      : ''
    const fromPreferredProvider = pickActiveModelForFamily(preferredProviderId)
    if (normalizedPreferred) {
      if (options?.persist && (fromPreferredProvider || '') !== defaultModelId.value) {
        setDefaultModel(fromPreferredProvider || '')
      }
      return fromPreferredProvider || ''
    }

    const fromServerDefault = normalizeToAvailableModel(providerDefaultModelId.value)
    const fromConfiguredFallback = normalizeToAvailableModel(fallbackModelId)
      || pickActiveModelForFamily(splitCompositeModelId(fallbackModelId).providerId)
    const firstAvailable = pickGlobalDefaultModel()
    const resolved = fromServerDefault || fromConfiguredFallback || firstAvailable || ''

    if (options?.persist && resolved !== defaultModelId.value) {
      setDefaultModel(resolved)
    }
    return resolved
  }

  // Ensure the Construct platform provider is present in providers.value.
  // Independent of the operator branch so it runs even when loadProviders
  // bails early (operator not connected on a cold open of the model
  // picker). Idempotent — short-circuits if already present.
  async function ensureConstructProvider() {
    if (providers.value.some(p => p.id === 'construct')) return
    try {
      const res = await fetch('https://my.construct.space/api/construct/models')
      if (!res.ok) return
      const data = await res.json() as {
        models: Array<{
          id: string
          label: string
          description?: string
          icon?: string
          capabilities?: string[] | null
        }>
        daily_allowance: number
        enabled: boolean
      }
      if (!data.enabled || !data.models?.length) return
      // Re-check after the await — a concurrent loadProviders() may have
      // inserted construct while we were awaiting the fetch.
      if (providers.value.some(p => p.id === 'construct')) return
      providers.value = [
        {
          id: 'construct',
          label: 'Construct',
          authType: 'local',
          description: `Free models — ${data.daily_allowance} credits / day`,
          active: true,
          models: data.models.map(m => ({
            id: m.id,
            // Picker entries no longer carry per-row credit cost — actual
            // cost depends on which routing target served (source-family
            // dispatch). Label is just the model name now; the daily-
            // allowance gauge under the picker carries the credits story.
            label: m.label,
            capabilities: m.capabilities ?? [],
          })),
        } as AIProvider,
        ...providers.value,
      ]
    } catch (e) {
      console.warn('[useAIModel] construct fetch failed:', e)
    }
  }

  // Load providers from context service (single source of truth)
  const loadProviders = async (
    retries = 5,
    preferredProviderId?: string | null,
    options?: { connect?: boolean },
  ) => {
    syncActiveProfileState()
    if (loading.value) return
    loading.value = true
    let shouldMarkInitialized = true
    try {
      const { useBrain } = await import('@/brain')
      const brain = useBrain()

      if (brain.isTauri.value && !brain.connected.value) {
        if (!options?.connect) {
          // Do not auto-start the operator just to populate background state.
          shouldMarkInitialized = false
          return
        }
        const didConnect = await brain.connect()
        if (!didConnect || !brain.connected.value) {
          shouldMarkInitialized = false
          return
        }
      }

      // Remote catalog defines the *universe* of available providers +
      // models. Operator list marks which of those are currently active
      // (have API keys / OAuth tokens on this machine). Hardcoded
      // DEFAULT_PROVIDERS is the last-resort offline fallback.
      const { useProviderCatalog } = await import('@/composables/useProviderCatalog')
      const catalog = useProviderCatalog()
      await catalog.load().catch(() => { /* offline — fall through to hardcoded */ })
      const universe: AIProvider[] = catalog.catalog.value.length > 0
        ? catalog.catalog.value.map(cloneProvider)
        : DEFAULT_PROVIDERS.map(cloneProvider)

      const response = await brain.listProviders()
      // Brain's `ai.providers` is intentionally narrower than the
      // catalog row — models carry just {id, label?}. Coerce into the
      // AIProvider shape the rest of the picker expects (label
      // defaults to id, capabilities to []) so the downstream merge
      // doesn't trip on missing fields.
      const activeById = new Map(
        (response.providers || []).map((p) => {
          // `ai.providers` lists EVERY catalog provider, each with a
          // `connected` flag (api_key_present || oauth_linked; local
          // runtimes are always connected). A provider is only "active"
          // — i.e. selectable in the picker and eligible as a resolved
          // default — when it actually has usable credentials. Without
          // this gate the picker showed e.g. Claude models while Anthropic
          // was "NOT SET UP", letting the user pick a model the operator
          // can't serve (which then silently falls back to Construct).
          const connected = Boolean(p.connected ?? (p.api_key_present || p.oauth_linked))
          const coerced: AIProvider = {
            id: p.id,
            label: p.name ?? p.id,
            models: (p.models ?? []).map(m => ({
              id: m.id,
              label: m.label ?? m.id,
              capabilities: m.capabilities ?? [],
            })),
            active: connected,
          }
          return [p.id, coerced] as const
        }),
      )

      providers.value = universe.map(u => {
        const active = activeById.get(u.id)
        if (!active) return { ...u, active: false }

        // Source/Oracle is the model universe. The operator list only
        // proves this provider is configured and may contribute runtime-
        // only IDs, so never let stale connector metadata hide catalog
        // additions such as a newly published OpenAI model. Carry the
        // connected-derived `active` through — a catalog provider with no
        // credentials stays inactive.
        return {
          ...active,
          ...u,
          active: active.active,
          models: mergeCatalogAndRuntimeModels(u.models, active.models),
          capabilities: u.capabilities ?? active.capabilities,
        }
      })

      // Providers the operator surfaces that aren't in the remote catalog
      // (e.g. locally-configured Ollama) still need to appear.
      const universeIds = new Set(universe.map(u => u.id))
      for (const [id, active] of activeById) {
        if (!universeIds.has(id)) providers.value.push(active)
      }

      // Construct provider is added in the finally block below so it
      // lands regardless of whether the operator branch succeeded or
      // bailed early. Resolving the default model here happens before
      // Construct is inserted, which is fine — defaults are scoped to
      // the BYOK universe, not the platform provider.
      const defaultProviderId = (response.defaultProvider || response.default || '').trim()
      const defaultModelFromServer = (response.defaultModel || '').trim()
        || (() => {
          if (!defaultProviderId) return ''
          const provider = providers.value.find(p => p.id === defaultProviderId)
          const modelId = provider?.models?.[0]?.id
          return provider && modelId ? toCompositeModelId(provider.id, modelId) : ''
        })()
      providerDefaultModelId.value = defaultModelFromServer
      const stored = typeof window !== 'undefined'
        ? profileStorage.getItem(MODEL_STORAGE_KEY)?.trim() || ''
        : ''
      const currentSelection = stored || defaultModelId.value.trim()
      const preferredFamilyDefault = pickActiveModelForFamily(preferredProviderId)

      if (currentSelection.includes(':')) {
        const normalizedCurrent = normalizeToAvailableModel(currentSelection)
        if (normalizedCurrent) {
          setDefaultModel(normalizedCurrent)
        } else {
          const resolved = preferredFamilyDefault || resolveModelId(currentSelection, {
            allowAuto: false,
            fallbackModelId: providerDefaultModelId.value || DEFAULT_MODEL,
            persist: false,
          })
          setDefaultModel(resolved)
        }
      } else if (!currentSelection) {
        const resolved = preferredFamilyDefault || resolveModelId('', {
          allowAuto: false,
          fallbackModelId: providerDefaultModelId.value || DEFAULT_MODEL,
          persist: false,
        })
        setDefaultModel(resolved)
      }
    } catch (err) {
      // Retry on transient startup race (context service not connected yet)
      if (retries > 0 && isNotConnectedError(err)) {
        shouldMarkInitialized = false
        loading.value = false
        await new Promise(resolve => setTimeout(resolve, 500))
        return loadProviders(retries - 1, preferredProviderId, options)
      }
      if (isNotConnectedError(err)) {
        shouldMarkInitialized = false
        return
      }
      console.error('[useAIModel] Failed to load providers:', err)
    } finally {
      loading.value = false
      if (shouldMarkInitialized) {
        initialized.value = true
      }
      // Construct provider runs in finally so it lands whether the
      // operator branch succeeded, threw, or bailed early. Idempotent:
      // no-op if already inserted. Fire-and-forget so it can't block
      // the loading flag from clearing.
      ensureConstructProvider().catch(() => { /* logged inside */ })
    }
  }

  // Initialize - call once on first component mount
  const init = async () => {
    syncActiveProfileState()
    if (initialized.value) return
    loadFromStorage()
    await loadProviders()
  }

  if (getCurrentScope()) {
    watch(activeProfileIdRef, (nextProfileId, previousProfileId) => {
      if (nextProfileId === previousProfileId) return
      resetForActiveProfile(nextProfileId)
      void loadProviders()
    }, { flush: 'sync' })
  }

  // Auto-init if not initialized. Guard with a shared promise so multiple
  // simultaneous imports don't trigger parallel init() calls.
  if (typeof window !== 'undefined' && !initialized.value && !loading.value) {
    if (!initPromise) {
      initPromise = init().finally(() => { initPromise = null })
    }
  }

  return {
    // State
    providers,
    allModels,
    modelsByProvider,
    defaultModelId,
    currentModel,
    currentProvider,
    loading,
    initialized,

    // Actions
    setDefaultModel,
    resolveModelId,
    isAutoModelId,
    isVisionModel,
    loadProviders,
    // Exported so callers that need the Construct provider on-screen
    // (e.g. the onboarding "Continue with Source" step) can await it
    // directly instead of racing the fire-and-forget call inside
    // loadProviders's finally block.
    ensureConstructProvider,
    init,
    resetForActiveProfile,
    syncActiveProfileState,

    // Helpers
    getModelId,
    getProviderId,
  }
}
