/**
 * Provider card registry. Maps provider id → the Vue component that
 * renders that provider's settings tile. Specialized components own the
 * per-provider quirks (Anthropic's Claude OAuth, MiMo's dual API keys,
 * Ollama/LM Studio URL-only setup). Anything not in the registry falls
 * through to GenericCard — which covers the simple api-key-only case
 * and keeps the page working when the oracle admin adds a brand-new
 * provider nobody has written a card for yet.
 */

import type { Component } from 'vue'
import AnthropicCard from './AnthropicCard.vue'
import ConstructCard from './ConstructCard.vue'
import GenericCard from './GenericCard.vue'
import GoogleCard from './GoogleCard.vue'
import LocalCard from './LocalCard.vue'
import MiMoCard from './MiMoCard.vue'
import OpenAICard from './OpenAICard.vue'

// Known provider ids with dedicated UI. Keys here must match the catalog
// `id` slug — not the `slug` column (same value today, but match on id to
// stay aligned with the operator's wire ids).
const cards: Record<string, Component> = {
  construct: ConstructCard,
  anthropic: AnthropicCard,
  openai: OpenAICard,
  google: GoogleCard,
  mimo: MiMoCard,
  ollama: LocalCard,
  lmstudio: LocalCard,
  'lm-studio': LocalCard,
  basemlx: LocalCard,
}

/**
 * Pick the right card for a provider id. Fallback is GenericCard —
 * handles DeepSeek, xAI, Mistral, Z.AI, Kimi, OpenRouter, Gemini (API
 * key side), and anything the oracle catalog admin adds without
 * frontend changes.
 */
export function resolveProviderCard(providerId: string): Component {
  return cards[providerId] || GenericCard
}

export {
  AnthropicCard,
  GenericCard,
  GoogleCard,
  LocalCard,
  MiMoCard,
  OpenAICard,
}
