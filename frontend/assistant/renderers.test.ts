import { describe, it, expect } from 'vitest'
import { registerBlockRenderer, resolveBlockRenderer, resolveRendererMode, resolveCustomRenderer } from './renderers'
import { registerAssistantType } from './registry'
import { defineComponent } from 'vue'

// Register the core assistant types directly (avoid importing index.ts which
// pulls in .vue files that can't be parsed in the node test environment).
registerAssistantType({
  id: 'construct',
  label: 'General',
  entryAgent: 'construct',
  renderMode: 'blocks',
  finalSchema: 'assistant.v1',
  sessionScope: 'global',
  supportsAttachments: true,
  requiresProjectPath: false,
  usesPriorityRouting: true,
  source: 'builtin',
})

describe('renderers', () => {
  it('registers and resolves custom block renderers', () => {
    const MockComponent = defineComponent({ template: '<div />' })
    registerBlockRenderer('example:questions', MockComponent)
    expect(resolveBlockRenderer('example:questions')).toBe(MockComponent)
  })

  it('returns undefined for unregistered blocks', () => {
    expect(resolveBlockRenderer('unknown:block')).toBeUndefined()
  })

  it('resolves renderer mode from assistant type config', () => {
    expect(resolveRendererMode('construct')).toBe('blocks')
    expect(resolveRendererMode('unknown')).toBe('blocks')
  })

  it('returns undefined customRenderer for types without one', () => {
    expect(resolveCustomRenderer('construct')).toBeUndefined()
  })

  it('resolves custom renderer for custom renderMode type', () => {
    registerAssistantType({
      id: 'kanban',
      label: 'Kanban',
      entryAgent: 'space:kanban',
      renderMode: 'custom',
      customRenderer: 'KanbanRenderer',
      finalSchema: null,
      sessionScope: 'assistant',
      supportsAttachments: false,
      requiresProjectPath: false,
      usesPriorityRouting: false,
      source: 'space:kanban',
    })
    expect(resolveRendererMode('kanban')).toBe('custom')
    expect(resolveCustomRenderer('kanban')).toBe('KanbanRenderer')
  })
})
