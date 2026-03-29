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
  it('registers and retrieves builtin assistant types', () => {
    expect(getAssistantType('general')?.entryAgent).toBe('general')
    expect(getAssistantType('architect')?.renderMode).toBe('blocks')
    expect(getAssistantType('coder')?.renderMode).toBe('timeline')
    expect(getAssistantType('brainstorm')?.renderMode).toBe('blocks')
  })

  it('has correct config for general builtin', () => {
    const general = getAssistantType('general')
    expect(general).toBeDefined()
    expect(general!.label).toBe('General')
    expect(general!.finalSchema).toBe('assistant.v1')
    expect(general!.sessionScope).toBe('global')
    expect(general!.supportsAttachments).toBe(true)
    expect(general!.usesPriorityRouting).toBe(true)
    expect(general!.source).toBe('builtin')
  })

  it('has correct config for space-defined builtins', () => {
    const coder = getAssistantType('coder')
    expect(coder).toBeDefined()
    expect(coder!.sessionScope).toBe('project')
    expect(coder!.requiresProjectPath).toBe(true)
    expect(coder!.source).toBe('builtin')

    const architect = getAssistantType('architect')
    expect(architect).toBeDefined()
    expect(architect!.finalSchema).toBe('architect.v1')

    const brainstorm = getAssistantType('brainstorm')
    expect(brainstorm).toBeDefined()
    expect(brainstorm!.finalSchema).toBe('assistant.v1')
    expect(brainstorm!.sessionScope).toBe('assistant')
  })

  it('lists all registered types', () => {
    const types = listAssistantTypes()
    const ids = types.map(t => t.id)
    expect(ids).toContain('general')
    expect(ids).toContain('coder')
    expect(ids).toContain('architect')
    expect(ids).toContain('brainstorm')
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
    expect(listAssistantTypes().length).toBeGreaterThan(4)
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
    expect(getAssistantType('general')).toBeDefined()
    expect(getAssistantType('coder')).toBeDefined()
    expect(getAssistantType('architect')).toBeDefined()
    expect(getAssistantType('brainstorm')).toBeDefined()
  })

  it('returns undefined for unknown type', () => {
    expect(getAssistantType('nonexistent')).toBeUndefined()
  })
})
