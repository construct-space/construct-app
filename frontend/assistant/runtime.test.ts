import { describe, it, expect } from 'vitest'
import { resolveAssistantType, getAssistantConfig } from './runtime'

// Importing index triggers loadCoreAssistantTypes() at module load
import '@/assistant/index'

describe('resolveAssistantType', () => {
  it('maps surfaces to assistant types', () => {
    expect(resolveAssistantType({ surface: 'assistant-panel' })).toBe('general')
    expect(resolveAssistantType({ surface: 'architect-page' })).toBe('architect')
    expect(resolveAssistantType({ surface: 'coder-page' })).toBe('coder')
    expect(resolveAssistantType({ surface: 'brainstorm-page' })).toBe('brainstorm')
  })

  it('defaults unknown surfaces to general', () => {
    expect(resolveAssistantType({ surface: 'unknown' })).toBe('general')
  })

  it('returns config for known surfaces', () => {
    const config = getAssistantConfig('coder-page')
    expect(config?.renderMode).toBe('timeline')
    expect(config?.sessionScope).toBe('project')
  })
})
