import { describe, it, expect } from 'vitest'
import { resolveAssistantType, getAssistantConfig } from './runtime'

// Importing index triggers loadCoreAssistantTypes() at module load
import '@/assistant/index'

describe('resolveAssistantType', () => {
  it('maps the assistant-panel surface to construct', () => {
    expect(resolveAssistantType({ surface: 'assistant-panel' })).toBe('construct')
  })

  it('defaults unknown surfaces to construct', () => {
    expect(resolveAssistantType({ surface: 'unknown' })).toBe('construct')
    expect(resolveAssistantType({ surface: 'ask-page' })).toBe('construct')
  })

  it('returns config for the assistant-panel surface', () => {
    const config = getAssistantConfig('assistant-panel')
    expect(config?.renderMode).toBe('blocks')
    expect(config?.sessionScope).toBe('global')
  })
})
