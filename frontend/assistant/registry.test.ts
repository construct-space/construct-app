import { describe, expect, it } from 'vitest'
import {
  getAssistantType,
  listAssistantTypes,
  registerAssistantType,
  unregisterAssistantTypesBySource,
} from '@/assistant/registry'

// Importing index triggers loadCoreAssistantTypes() at module load
import '@/assistant/index'

describe('assistant type registry', () => {
  it('registers and retrieves the builtin construct assistant type', () => {
    expect(getAssistantType('construct')?.entryAgent).toBe('construct')
    expect(getAssistantType('construct')?.renderMode).toBe('blocks')
  })

  it('has correct config for the construct builtin', () => {
    const construct = getAssistantType('construct')
    expect(construct).toBeDefined()
    expect(construct!.label).toBe('Construct')
    expect(construct!.finalSchema).toBe('assistant.v1')
    expect(construct!.sessionScope).toBe('global')
    expect(construct!.supportsAttachments).toBe(true)
    expect(construct!.usesPriorityRouting).toBe(true)
    expect(construct!.source).toBe('builtin')
  })

  it('lists the construct builtin', () => {
    const types = listAssistantTypes()
    const ids = types.map(t => t.id)
    expect(ids).toContain('construct')
  })

  it('registers space-defined types dynamically', () => {
    registerAssistantType({
      id: 'devops',
      label: 'DevOps',
      entryAgent: 'space:devops',
      renderMode: 'blocks',
      finalSchema: null,
      sessionScope: 'project',
      supportsAttachments: false,
      requiresProjectPath: true,
      usesPriorityRouting: false,
      source: 'space:devops',
    })
    expect(getAssistantType('devops')?.source).toBe('space:devops')
    expect(listAssistantTypes().length).toBeGreaterThan(2)
  })

  it('unregisters all types from a space source on reload or uninstall', () => {
    registerAssistantType({
      id: 'devops',
      label: 'DevOps',
      entryAgent: 'space:devops',
      renderMode: 'blocks',
      finalSchema: null,
      sessionScope: 'project',
      supportsAttachments: false,
      requiresProjectPath: true,
      usesPriorityRouting: false,
      source: 'space:devops',
    })
    expect(getAssistantType('devops')).toBeDefined()
    unregisterAssistantTypesBySource('space:devops')
    expect(getAssistantType('devops')).toBeUndefined()
  })

  it('does not unregister builtins when clearing a space source', () => {
    unregisterAssistantTypesBySource('space:nonexistent')
    expect(getAssistantType('construct')).toBeDefined()
  })

  it('returns undefined for unknown type', () => {
    expect(getAssistantType('nonexistent')).toBeUndefined()
  })
})
