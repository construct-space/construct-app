/**
 * AI Model composable
 * Manages default AI model selection with persistence
 *
 * All providers and models come from the context service (Go backend).
 * To add a new provider, add it in context/providers/ - no frontend changes needed.
 */

import { ref, computed } from 'vue'
import type { AIProvider } from '@/operator/types'

// Storage key for default model (stores "providerId:modelId")
const MODEL_STORAGE_KEY = 'cp_default_ai_model'
const DEFAULT_MODEL = 'anthropic:claude-sonnet-4-6' // Claude Sonnet 4.6 default
const AUTO_MODEL_SENTINELS = new Set(['auto', 'conductor'])
const PROVIDER_FAMILY_DEFAULTS: Record<string, string[]> = {
  anthropic: [
    'claude-haiku-4-5-20251001',
    'claude-haiku-4-5',
    'claude-sonnet-4-6',
    'claude-sonnet-4-5',
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
    'deepseek-chat',
    'deepseek-reasoner',
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
  openrouter: [
    'openrouter/free',
    'openai/gpt-oss-20b:free',
    'openai/gpt-oss-120b:free',
    'qwen/qwen3-coder:free',
    'qwen/qwen3-next-80b-a3b-instruct:free',
    'mistralai/mistral-small-3.1-24b-instruct:free',
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
      { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
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
      { id: 'deepseek-chat', label: 'DeepSeek V3' },
      { id: 'deepseek-reasoner', label: 'DeepSeek R1' },
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
    id: 'openrouter',
    label: 'OpenRouter',
    authType: 'api',
    active: false,
    models: [],
  },
]

// Shared state across all instances
const providers = ref<AIProvider[]>(DEFAULT_PROVIDERS)
const loading = ref(false)
const initialized = ref(false)
const defaultModelId = ref<string>('')
const providerDefaultModelId = ref<string>('')
let initPromise: Promise<void> | null = null

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
    const stored = localStorage.getItem(MODEL_STORAGE_KEY)?.trim() || ''
    if (stored) {
      // "Auto" was a short-lived UI mode. Treat it as unset so the app
      // resolves a real model instead of sending "auto" to the operator.
      defaultModelId.value = isAutoModelId(stored) ? '' : stored
    }
  }
}

// Check if model supports vision
// Handles both plain model IDs and composite IDs (provider:model)
export const isVisionModel = (modelId: string): boolean => {
  // Extract model part from composite ID if present
  const model = splitCompositeModelId(modelId).modelId

  return model.includes('vision') ||
         model.includes('4.6v') ||
         model.startsWith('claude-') ||
         model.includes('claude') ||
         model.startsWith('gpt-5.4') || // GPT-5.4 has vision
         model.startsWith('grok-4') || // Grok 4+ has vision
         model.startsWith('kimi-k2') || // Kimi K2+ has vision
         modelId.includes('anthropic') // Provider-based check for Claude
}

// Load on first import (client-side only)
if (typeof window !== 'undefined' && !initialized.value) {
  loadFromStorage()
}

export const useAIModel = () => {
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
        localStorage.setItem(MODEL_STORAGE_KEY, normalized)
      } else {
        localStorage.removeItem(MODEL_STORAGE_KEY)
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
    const exactActive = activeModels.value.find(model => model.id === trimmed)
    if (exactActive) return exactActive.id

    if (trimmed.includes(':')) {
      const { providerId, modelId } = splitCompositeModelId(trimmed)
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

  // Load providers from context service (single source of truth)
  const loadProviders = async (retries = 5, preferredProviderId?: string | null) => {
    if (loading.value) return
    loading.value = true
    let shouldMarkInitialized = true
    try {
      const { useOperator } = await import('@/operator')
      const operator = useOperator()

      // Do not auto-start the operator just to populate model settings.
      if (operator.isTauri.value && !operator.connected.value) {
        shouldMarkInitialized = false
        return
      }

      const response = await operator.listProviders()
      const activeProviders = (response.providers || []).map(p => ({ ...p, active: true }))
      const activeIds = new Set(activeProviders.map(p => p.id))
      // Merge: active providers first, then inactive defaults for providers not yet connected
      const inactiveDefaults = DEFAULT_PROVIDERS
        .filter(d => !activeIds.has(d.id))
        .map(d => ({ ...d, active: false }))
      providers.value = [...activeProviders, ...inactiveDefaults]
      const defaultProviderId = (response.defaultProvider || response.default || '').trim()
      const defaultModelFromServer = (response.defaultModel || '').trim()
        || (() => {
          if (!defaultProviderId) return ''
          const provider = providers.value.find(p => p.id === defaultProviderId)
          const modelId = provider?.models?.[0]?.id
          return provider && modelId ? toCompositeModelId(provider.id, modelId) : ''
        })()
      if (defaultModelFromServer) {
        providerDefaultModelId.value = defaultModelFromServer
      }
      const stored = typeof window !== 'undefined'
        ? localStorage.getItem(MODEL_STORAGE_KEY)?.trim() || ''
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
        return loadProviders(retries - 1, preferredProviderId)
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
    }
  }

  // Initialize - call once on first component mount
  const init = async () => {
    if (initialized.value) return
    loadFromStorage()
    await loadProviders()
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
    init,

    // Helpers
    getModelId,
    getProviderId,
  }
}
