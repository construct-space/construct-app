import { describe, expect, it } from 'vitest'

import { buildArchitectPromptDescription, getArchitectScopeKey } from '../architectEngineHelpers'

describe('architect engine helpers', () => {
  it('preserves the raw description for global architect prompts', () => {
    expect(buildArchitectPromptDescription('  Build a kanban app  ')).toBe('Build a kanban app')
  })

  it('adds project context for feature-planning prompts without changing the feature text', () => {
    const prompt = buildArchitectPromptDescription('Add notifications', {
      name: 'Acme CRM',
      description: 'Customer relationship workspace',
      spaces: ['code', 'docs'],
    })

    expect(prompt).toContain('Project: "Acme CRM"')
    expect(prompt).toContain('Spaces enabled: code, docs')
    expect(prompt).toContain('Feature request: Add notifications')
  })

  it('creates distinct scope keys for project-scoped and global architect routes', () => {
    expect(getArchitectScopeKey('acme')).toBe('project:acme')
    expect(getArchitectScopeKey(undefined)).toBe('global')
  })
})
