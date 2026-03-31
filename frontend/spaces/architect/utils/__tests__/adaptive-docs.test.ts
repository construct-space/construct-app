import { describe, it, expect } from 'vitest'
import { PROJECT_TYPE_DOCS, DOCUMENT_OPTIONS } from '../documentsGenerator'

describe('adaptive doc generation', () => {
  describe('PROJECT_TYPE_DOCS', () => {
    it('landing page has minimal doc set (no backend, no roadmap)', () => {
      const docs = PROJECT_TYPE_DOCS['landing-page']
      expect(docs).toBeDefined()
      expect(docs).toContain('prd')
      expect(docs).toContain('readme')
      expect(docs).not.toContain('architecture')
      expect(docs).not.toContain('data-models')
      expect(docs).not.toContain('endpoints')
      expect(docs).not.toContain('roadmap')
      expect(docs).not.toContain('setup')
      expect(docs.length).toBeLessThanOrEqual(4)
    })

    it('simple web app has moderate doc set', () => {
      const docs = PROJECT_TYPE_DOCS['web-app']
      expect(docs).toBeDefined()
      expect(docs).toContain('prd')
      expect(docs).toContain('architecture')
      expect(docs).toContain('readme')
      expect(docs.length).toBeGreaterThan(PROJECT_TYPE_DOCS['landing-page'].length)
    })

    it('complex web app has full doc set', () => {
      const docs = PROJECT_TYPE_DOCS['web-app-complex']
      expect(docs).toBeDefined()
      expect(docs).toContain('prd')
      expect(docs).toContain('architecture')
      expect(docs).toContain('data-models')
      expect(docs).toContain('endpoints')
      expect(docs).toContain('roadmap')
      expect(docs).toContain('setup')
      expect(docs).toContain('ai-context')
      expect(docs).toContain('readme')
      expect(docs.length).toBeGreaterThan(PROJECT_TYPE_DOCS['web-app'].length)
    })

    it('API project includes endpoints but no UI spec', () => {
      const docs = PROJECT_TYPE_DOCS['api']
      expect(docs).toBeDefined()
      expect(docs).toContain('endpoints')
      expect(docs).toContain('data-models')
      expect(docs).not.toContain('ui-spec')
    })

    it('game project has architecture but different docs than web app', () => {
      const docs = PROJECT_TYPE_DOCS['game']
      expect(docs).toBeDefined()
      expect(docs).toContain('prd')
      expect(docs).toContain('architecture')
      expect(docs).toContain('readme')
      expect(docs).not.toContain('endpoints')
    })

    it('construct space skips backend/hosting docs', () => {
      const docs = PROJECT_TYPE_DOCS['construct-space']
      expect(docs).toBeDefined()
      expect(docs).toContain('prd')
      expect(docs).toContain('readme')
      expect(docs).not.toContain('endpoints')
      expect(docs).not.toContain('setup')
      expect(docs).not.toContain('architecture')
    })

    it('all project types include prd and readme', () => {
      for (const [type, docs] of Object.entries(PROJECT_TYPE_DOCS)) {
        expect(docs, `${type} should include prd`).toContain('prd')
        expect(docs, `${type} should include readme`).toContain('readme')
      }
    })

    it('doc counts scale with project complexity', () => {
      const landing = PROJECT_TYPE_DOCS['landing-page'].length
      const webapp = PROJECT_TYPE_DOCS['web-app'].length
      const complex = PROJECT_TYPE_DOCS['web-app-complex'].length

      expect(landing).toBeLessThan(webapp)
      expect(webapp).toBeLessThan(complex)
    })
  })

  describe('DOCUMENT_OPTIONS (deprecated)', () => {
    it('has entries for core doc types', () => {
      const types = DOCUMENT_OPTIONS.map(o => o.type)
      expect(types).toContain('prd')
      expect(types).toContain('readme')
      expect(types).toContain('architecture')
    })

    it('each option has required fields', () => {
      for (const opt of DOCUMENT_OPTIONS) {
        expect(opt.type).toBeTruthy()
        expect(opt.label).toBeTruthy()
        expect(opt.description).toBeTruthy()
        expect(opt.icon).toBeTruthy()
        expect(typeof opt.default).toBe('boolean')
      }
    })
  })
})
