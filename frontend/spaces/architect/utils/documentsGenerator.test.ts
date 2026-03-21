import { describe, expect, it } from 'vitest'

import { DOCUMENT_OPTIONS, type ArchitectPlan, type DocumentType } from './documentsGenerator'

describe('documentsGenerator types', () => {
  it('DOCUMENT_OPTIONS has all document types', () => {
    const types = DOCUMENT_OPTIONS.map(o => o.type)
    expect(types).toContain('prd')
    expect(types).toContain('readme')
    expect(types).toContain('architecture')
    expect(types).toContain('data-models')
    expect(types).toContain('ui-spec')
    expect(types).toContain('roadmap')
    expect(types).toContain('ai-context')
    expect(types).toContain('setup')
  })

  it('DOCUMENT_OPTIONS entries have required fields', () => {
    for (const opt of DOCUMENT_OPTIONS) {
      expect(opt.type).toBeTruthy()
      expect(opt.label).toBeTruthy()
      expect(opt.description).toBeTruthy()
      expect(opt.icon).toBeTruthy()
      expect(typeof opt.default).toBe('boolean')
    }
  })

  it('ArchitectPlan type allows both legacy and rich structures', () => {
    const legacyPlan: ArchitectPlan = {
      name: 'Test',
      description: 'A test project',
      decisions: { frontend: 'vue' },
      prd: { overview: 'Test overview', coreFeatures: ['Feature 1'] },
    }
    expect(legacyPlan.name).toBe('Test')
    expect(legacyPlan.prd?.coreFeatures).toHaveLength(1)

    const richPlan: ArchitectPlan = {
      name: 'Test',
      description: 'A test project',
      decisions: { frontend: 'vue' },
      docs: {
        prd: { overview: 'Rich overview', coreFeatures: ['Feature 1'] },
      },
    }
    expect(richPlan.docs?.prd?.overview).toBe('Rich overview')
  })

  it('DocumentType is a valid union', () => {
    const docType: DocumentType = 'prd'
    expect(docType).toBe('prd')
  })
})
