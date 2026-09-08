/**
 * Fetch the live model list for a given connector id. Hits brain's
 * `provider.list-live-models` wire op (when present), which in turn
 * calls the provider's own `/models` endpoint with the user's stored
 * credentials.
 *
 * The whole point: plan-filtering is server-side. Calling this only
 * returns models the *authenticated user* actually has access to, so
 * picking one will not 400 with "model X is not supported on your plan."
 *
 * Call site contract:
 *   - Pass the connector id (what Provider.ID() returns in operator's
 *     connectors/*.go): "anthropic", "claude-oauth", "openai",
 *     "openai-oauth", "deepseek", "xai", "mistral", "openrouter",
 *     "ollama", "lmstudio", ...
 *   - Each connector id caches its model list for 5 minutes in memory.
 *     The TTL resets whenever `load(force)` is called with force=true
 *     (use after saving a key or signing in).
 *   - Not-yet-loaded / pre-auth connectors return an empty array —
 *     cards use this to render the "sign in to see models" placeholder.
 *
 * Errors don't throw out of here: they're captured and exposed on the
 * returned `error` ref so cards can surface a non-fatal hint. The model
 * list stays empty rather than falling back to stale catalog data —
 * the whole point of this layer is "show only what's actually usable."
 */

import { shallowRef, computed } from 'vue'
import { useBrain } from '@/brain'

export interface LiveModel {
  id: string
  label: string
  capabilities?: string[]
}

interface CacheEntry {
  models: LiveModel[]
  fetched: number
  source?: string
  error?: string
}

interface LiveModelsResponse {
  models?: LiveModel[]
  source?: string
}

const TTL_MS = 5 * 60 * 1000

// Providers' /models endpoints return everything the account can use —
// not just chat models. MiMo's token plan returns mimo-v2-tts (text-to-
// speech), OpenAI returns whisper-* (speech-to-text) and text-embedding-*,
// etc. Surfacing those in a chat-model picker produces 400s on dispatch.
// Filter them out by well-known id fragments.
//
// Heuristic only — if a legitimate chat model happens to include one of
// these substrings we'd drop it. The alternatives (per-id whitelist,
// capability introspection) are heavier and these fragments are stable
// across all major providers.
const NON_CHAT_PATTERNS = [
  /-tts\b/i,          // text-to-speech (mimo-v2-tts, gpt-4o-tts)
  /-stt\b/i,          // speech-to-text
  /\bwhisper/i,       // OpenAI whisper
  /\bembedding/i,     // text-embedding-*, mistral-embed
  /\bmoderation/i,    // OpenAI moderation
  /\bdall-e/i,        // DALL-E
  /\bimage\b/i,       // image generation (e.g. gpt-image-1)
  /\bclip\b/i,        // CLIP
  /-video\b/i,        // xAI grok-imagine-video — separate /videos endpoint
  /\bimagine\b/i,     // xAI imagine variants (image/video gen)
  /^text-(ada|babbage|curie|davinci)/i, // legacy OpenAI non-chat
]

export function isChatModelId(id: string): boolean {
  for (const re of NON_CHAT_PATTERNS) if (re.test(id)) return false
  return true
}

function filterChatModels(models: LiveModel[]): LiveModel[] {
  return models.filter((m) => isChatModelId(m.id))
}
const cache = new Map<string, CacheEntry>()
const loading = shallowRef<Set<string>>(new Set())

function bumpLoading() { loading.value = new Set(loading.value) }

export function useLiveModels(connectorId: () => string | null | undefined) {
  const brain = useBrain()

  const entry = computed<CacheEntry | null>(() => {
    const id = connectorId()
    if (!id) return null
    return cache.get(id) || null
  })

  const models = computed<LiveModel[]>(() => entry.value?.models || [])
  const error = computed<string>(() => entry.value?.error || '')
  const source = computed<string>(() => entry.value?.source || '')
  const isLoading = computed(() => {
    const id = connectorId()
    return !!id && loading.value.has(id)
  })

  async function load(force = false) {
    const id = connectorId()
    if (!id) return

    const existing = cache.get(id)
    if (!force && existing && Date.now() - existing.fetched < TTL_MS && existing.models.length > 0) {
      return
    }
    if (loading.value.has(id)) return

    loading.value.add(id)
    bumpLoading()
    try {
      // TODO(brain): brain does not yet expose a `provider.list-live-models`
      // (or equivalent) wire op. Until it does, surface an empty list so
      // cards fall back to the static catalog instead of throwing. The
      // request is still issued in case a future brain build adds it.
      const res = (await brain.request('provider.list-live-models', { connector_id: id }).catch(() => null)) as LiveModelsResponse | null
      if (res?.models) {
        cache.set(id, {
          models: filterChatModels(res.models),
          fetched: Date.now(),
          source: res.source,
        })
      } else {
        cache.set(id, { models: [], fetched: Date.now(), error: 'no models returned' })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // Capture but don't hard-fail — cards show an inline hint.
      cache.set(id, { models: [], fetched: Date.now(), error: msg })
    } finally {
      loading.value.delete(id)
      bumpLoading()
    }
  }

  function invalidate() {
    const id = connectorId()
    if (id) cache.delete(id)
  }

  return { models, error, source, isLoading, load, invalidate }
}
