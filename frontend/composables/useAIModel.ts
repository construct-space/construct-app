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
const DEFAULT_MODEL = 'claude-code:claude-sonnet-4-6' // Claude Sonnet 4.6 default
const AUTO_MODEL_SENTINELS = new Set(['auto', 'conductor'])

export type AuthType = 'oauth' | 'api' | 'local'

export interface AIModelOption {
  id: string
  label: string
  providerId: string
  providerLabel: string
  authType: AuthType
}

// Hardcoded providers — always available regardless of operator connection
const DEFAULT_PROVIDERS: AIProvider[] = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    authType: 'oauth',
    models: [
      { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    ],
  },
  {
    id: 'codex',
    label: 'Codex',
    authType: 'oauth',
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
    id: 'anthropic',
    label: 'Anthropic',
    authType: 'api',
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
    models: [
      { id: 'gpt-5.4', label: 'GPT-5.4' },
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
      { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
      { id: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark' },
      { id: 'gpt-4.1', label: 'GPT-4.1' },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
      { id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano' },
      { id: 'o3', label: 'o3' },
      { id: 'o3-mini', label: 'o3 Mini' },
      { id: 'o4-mini', label: 'o4 Mini' },
    ],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    authType: 'api',
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek V3' },
      { id: 'deepseek-reasoner', label: 'DeepSeek R1' },
    ],
  },
  {
    id: 'xai',
    label: 'xAI',
    authType: 'api',
    models: [
      { id: 'grok-code-fast-1', label: 'Grok Code' },
      { id: 'grok-4-1-fast-reasoning', label: 'Grok 4.1 Fast' },
    ],
  },
]

// Shared state across all instances
const providers = ref<AIProvider[]>(DEFAULT_PROVIDERS)
const loading = ref(false)
const initialized = ref(false)
const defaultModelId = ref<string>(DEFAULT_MODEL)
const providerDefaultModelId = ref<string>(DEFAULT_MODEL)
let initPromise: Promise<void> | null = null

const isAutoModelId = (modelId?: string | null): boolean => {
  const normalized = (modelId || '').trim().toLowerCase()
  return AUTO_MODEL_SENTINELS.has(normalized)
}

const toCompositeModelId = (providerId: string, modelId: string): string => `${providerId}:${modelId}`
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
  const model = modelId.includes(':') ? modelId.split(':')[1] || modelId : modelId

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
          id: `${provider.id}:${model.id}`, // Composite ID for uniqueness
          label: model.label,
          providerId: provider.id,
          providerLabel: provider.label,
          authType: (provider.authType || 'api') as AuthType,
        })
      }
    }
    return models
  })

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
    const parts = resolved.split(':')
    return parts.length > 1 ? (parts[1] ?? resolved) : resolved
  }

  // Get the provider ID from composite ID
  const getProviderId = (compositeId: string): string => {
    const resolved = resolveModelId(compositeId, { allowAuto: false })
    const parts = resolved.split(':')
    return parts.length > 1 ? (parts[0] ?? '') : ''
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

  const normalizeToAvailableModel = (candidate: string): string | null => {
    const trimmed = candidate.trim()
    if (!trimmed) return null
    if (isAutoModelId(trimmed)) return null
    if (allModels.value.some(m => m.id === trimmed)) return trimmed

    // Backward compatibility for old storage format that only kept raw model ID.
    if (!trimmed.includes(':')) {
      const legacyMatch = allModels.value.find(m => m.id.endsWith(`:${trimmed}`))
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

    const fromServerDefault = normalizeToAvailableModel(providerDefaultModelId.value)
    const fromConfiguredFallback = normalizeToAvailableModel(fallbackModelId)
    const firstAvailable = allModels.value[0]?.id
    const resolved = fromServerDefault || fromConfiguredFallback || firstAvailable || DEFAULT_MODEL

    if (options?.persist && resolved !== defaultModelId.value) {
      setDefaultModel(resolved)
    }
    return resolved
  }

  // Load providers from context service (single source of truth)
  const loadProviders = async (retries = 5) => {
    if (loading.value) return
    loading.value = true
    try {
      const { useOperator } = await import('@/operator')
      const operator = useOperator()

      // In Tauri, ensure operator is connected before requesting providers.
      if (operator.isTauri.value && !operator.connected.value) {
        try {
          await operator.connect()
        } catch (error) {
          if (retries > 0) {
            loading.value = false
            await new Promise(resolve => setTimeout(resolve, 500))
            return loadProviders(retries - 1)
          }
          throw error
        }
      }

      const response = await operator.listProviders()
      providers.value = response.providers || []
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

      // If model is not explicitly set on this device yet, use backend default model.
      if (defaultModelFromServer && typeof window !== 'undefined' && !localStorage.getItem(MODEL_STORAGE_KEY)) {
        defaultModelId.value = defaultModelFromServer
      }

      // Preserve user's explicit selection — never overwrite with a fallback.
      // The user's chosen model may belong to a provider that loads later (OAuth).
      const stored = typeof window !== 'undefined' ? localStorage.getItem(MODEL_STORAGE_KEY) : null
      if (stored && stored.includes(':')) {
        // User has an explicit composite selection — keep it regardless of
        // whether the provider is loaded yet. The model selector UI shows
        // what's available; the user chose deliberately.
        defaultModelId.value = stored
      } else if (!stored || !stored.trim()) {
        // No user selection — resolve from server default or fallback
        const resolved = resolveModelId(defaultModelId.value, {
          allowAuto: false,
          fallbackModelId: providerDefaultModelId.value || DEFAULT_MODEL,
          persist: false,
        })
        defaultModelId.value = resolved
        if (typeof window !== 'undefined') {
          localStorage.setItem(MODEL_STORAGE_KEY, resolved)
        }
      }
    } catch (err) {
      // Retry on transient startup race (context service not connected yet)
      if (retries > 0 && isNotConnectedError(err)) {
        loading.value = false
        await new Promise(resolve => setTimeout(resolve, 500))
        return loadProviders(retries - 1)
      }
      if (isNotConnectedError(err)) {
        return
      }
      console.error('[useAIModel] Failed to load providers:', err)
    } finally {
      loading.value = false
      initialized.value = true
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
