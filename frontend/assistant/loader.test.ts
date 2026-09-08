import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadSpaceAssistantTypes } from './loader'
import { getAssistantType, listAssistantTypes, unregisterAssistantTypesBySource } from './registry'

describe('loadSpaceAssistantTypes', () => {
  beforeEach(() => {
    // Clean up any space-registered types between tests
    for (const t of listAssistantTypes()) {
      if (t.source.startsWith('space:')) {
        unregisterAssistantTypesBySource(t.source)
      }
    }
  })

  it('loads assistant type from space manifest', () => {
    loadSpaceAssistantTypes([
      { id: 'devops', manifest: { assistant: { id: 'devops', label: 'DevOps' } } },
    ])
    const type = getAssistantType('devops')
    expect(type).toBeDefined()
    expect(type?.entryAgent).toBe('space:devops')
    expect(type?.source).toBe('space:devops')
    expect(type?.renderMode).toBe('blocks')
  })

  it('applies defaults for minimal config', () => {
    loadSpaceAssistantTypes([
      { id: 'myspace', manifest: { assistant: { label: 'My Space' } } },
    ])
    const type = getAssistantType('myspace')
    expect(type?.id).toBe('myspace')
    expect(type?.entryAgent).toBe('space:myspace')
    expect(type?.sessionScope).toBe('assistant')
  })

  it('skips spaces without assistant config', () => {
    const before = listAssistantTypes().length
    loadSpaceAssistantTypes([
      { id: 'plain', manifest: {} },
    ])
    expect(listAssistantTypes().length).toBe(before)
  })

  it('unregisters previous version on reload', () => {
    loadSpaceAssistantTypes([
      { id: 'devops', manifest: { assistant: { label: 'DevOps v1' } } },
    ])
    loadSpaceAssistantTypes([
      { id: 'devops', manifest: { assistant: { label: 'DevOps v2' } } },
    ])
    expect(getAssistantType('devops')?.label).toBe('DevOps v2')
  })

  it('unregisters previous type when assistant config is removed', () => {
    loadSpaceAssistantTypes([
      { id: 'devops', manifest: { assistant: { label: 'DevOps v1' } } },
    ])
    expect(getAssistantType('devops')).toBeDefined()

    loadSpaceAssistantTypes([
      { id: 'devops', manifest: {} },
    ])
    expect(getAssistantType('devops')).toBeUndefined()
  })

  it('skips invalid assistant config and clears stale registration', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    loadSpaceAssistantTypes([
      { id: 'devops', manifest: { assistant: { label: 'DevOps v1' } } },
    ])

    loadSpaceAssistantTypes([
      { id: 'devops', manifest: { assistant: { renderMode: 'custom' } } },
    ])

    expect(getAssistantType('devops')).toBeUndefined()
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('uses explicit id and entryAgent when provided', () => {
    loadSpaceAssistantTypes([
      {
        id: 'myspace',
        manifest: {
          assistant: {
            id: 'custom-id',
            entryAgent: 'custom-agent',
            renderMode: 'timeline',
            sessionScope: 'project',
            supportsAttachments: true,
            requiresProjectPath: true,
            customRenderer: 'MyRenderer',
          },
        },
      },
    ])
    const type = getAssistantType('custom-id')
    expect(type).toBeDefined()
    expect(type?.entryAgent).toBe('custom-agent')
    expect(type?.renderMode).toBe('timeline')
    expect(type?.sessionScope).toBe('project')
    expect(type?.supportsAttachments).toBe(true)
    expect(type?.requiresProjectPath).toBe(true)
    expect(type?.customRenderer).toBe('MyRenderer')
    expect(type?.usesPriorityRouting).toBe(false)
    expect(type?.finalSchema).toBeNull()
  })
})
