/**
 * Stream classification — determines which block types can render
 * during streaming and which must buffer until final parse.
 *
 * This is the gatekeeper for 0.8.1 streaming coordination:
 * - STREAMABLE types render incrementally as tokens arrive
 * - BUFFERED types show a placeholder until DoneEvent, then render atomically
 */

import { getAssistantType } from './registry'

// ─── Block-level classification ───

/**
 * Block types safe to render incrementally during streaming.
 * These produce valid partial UI at any truncation point.
 */
export const STREAMABLE_BLOCK_TYPES = new Set<string>([
  'text',
  'code',
  'tool',
  'status',
  'error',
])

/**
 * Block types that must buffer until the full response is available.
 * Rendering partial data would show malformed/confusing UI.
 */
export const BUFFERED_BLOCK_TYPES = new Set<string>([
  'question',
  'plan',
  'tasklist',
  'progress',
  'table',
  'json',
  'action',
  'diff',
  'svg',
  'link',
])

/**
 * Returns true if a block type is safe to render during streaming.
 */
export function isStreamSafe(blockType: string): boolean {
  if (STREAMABLE_BLOCK_TYPES.has(blockType)) return true
  // Any custom block (namespaced with `:`) defaults to buffered
  if (blockType.includes(':')) return false
  // Unknown block types default to streamable (text-like)
  return !BUFFERED_BLOCK_TYPES.has(blockType)
}

// ─── Assistant-level classification ───

/**
 * Assistant types whose output requires full-response buffering.
 * These produce structured JSON that must be parsed as a whole.
 */
const BUFFERED_ASSISTANT_TYPES = new Set<string>([
  'construct',
])

/**
 * Returns true if the given assistant type needs full-response buffering.
 * Checks both the hardcoded set and the registry (for finalSchema presence).
 *
 * Any assistant with a custom finalSchema produces structured output that
 * must be parsed as a whole. The generic `assistant.v1` envelope is excluded
 * by default so legacy plain-text assistants can still stream. Specific
 * assistants that request assistant.v1 structured JSON must be added to
 * BUFFERED_ASSISTANT_TYPES explicitly.
 */
export function requiresBuffering(assistantType: string): boolean {
  if (BUFFERED_ASSISTANT_TYPES.has(assistantType)) return true

  // Any assistant type with a non-generic finalSchema needs structured output
  // and therefore must buffer until the full response is available.
  const config = getAssistantType(assistantType)
  if (config?.finalSchema && config.finalSchema !== 'assistant.v1') return true

  return false
}

// ─── Stream render state ───

/**
 * Per-turn render state machine for the streaming UI.
 *
 * - streaming:    tokens arriving, rendering incrementally (streamable types)
 * - buffering:    tokens arriving, hidden behind placeholder (buffered types)
 * - normalizing:  DoneEvent received, parsing buffered content into blocks
 * - rendered:     final blocks displayed successfully
 * - fallback:     normalization failed, raw content shown as text
 */
export type StreamRenderState = 'streaming' | 'buffering' | 'normalizing' | 'rendered' | 'fallback'
