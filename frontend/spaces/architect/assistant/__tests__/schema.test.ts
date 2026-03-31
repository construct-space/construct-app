import { describe, it, expect } from 'vitest'
import {
  architectEnvelopeSchema,
  architectQuestionsSchema,
  architectPlanSchema,
  architectProgressSchema,
} from '../schema'

describe('architect.v1 schema validation', () => {
  describe('questions state', () => {
    it('accepts a valid single question', () => {
      const result = architectQuestionsSchema.safeParse({
        version: 'architect.v1',
        state: 'questions',
        questions: [{
          id: 'project-type',
          question: 'What are you building?',
          type: 'single',
          options: [
            { value: 'webapp', label: 'Web application' },
            { value: 'landing', label: 'Landing page' },
            { value: 'other', label: 'Other' },
          ],
        }],
      })
      expect(result.success).toBe(true)
    })

    it('rejects empty questions array', () => {
      const result = architectQuestionsSchema.safeParse({
        version: 'architect.v1',
        state: 'questions',
        questions: [],
      })
      expect(result.success).toBe(false)
    })

    it('rejects multiple questions (enforces single-question progression)', () => {
      const result = architectQuestionsSchema.safeParse({
        version: 'architect.v1',
        state: 'questions',
        questions: [
          { id: 'q1', question: 'First?', type: 'single', options: [{ value: 'a', label: 'A' }] },
          { id: 'q2', question: 'Second?', type: 'single', options: [{ value: 'b', label: 'B' }] },
        ],
      })
      expect(result.success).toBe(false)
    })

    it('accepts multi-select question type', () => {
      const result = architectQuestionsSchema.safeParse({
        version: 'architect.v1',
        state: 'questions',
        questions: [{
          id: 'features',
          question: 'What features do you need?',
          type: 'multi',
          options: [
            { value: 'auth', label: 'Authentication' },
            { value: 'payments', label: 'Payments' },
            { value: 'notifications', label: 'Notifications' },
          ],
        }],
      })
      expect(result.success).toBe(true)
    })

    it('accepts options with optional description and icon', () => {
      const result = architectQuestionsSchema.safeParse({
        version: 'architect.v1',
        state: 'questions',
        questions: [{
          id: 'stack',
          question: 'Which framework?',
          type: 'single',
          options: [
            { value: 'vue', label: 'Vue 3', description: 'Reactive framework', icon: 'vue' },
            { value: 'react', label: 'React' },
          ],
        }],
      })
      expect(result.success).toBe(true)
    })

    it('rejects wrong version string', () => {
      const result = architectQuestionsSchema.safeParse({
        version: 'architect.v2',
        state: 'questions',
        questions: [{ id: 'q1', question: 'Hi?', type: 'single', options: [] }],
      })
      expect(result.success).toBe(false)
    })

    it('rejects invalid question type', () => {
      const result = architectQuestionsSchema.safeParse({
        version: 'architect.v1',
        state: 'questions',
        questions: [{ id: 'q1', question: 'Hi?', type: 'checkbox', options: [] }],
      })
      expect(result.success).toBe(false)
    })
  })

  describe('plan state', () => {
    it('accepts a valid plan with adaptive doc set', () => {
      const result = architectPlanSchema.safeParse({
        version: 'architect.v1',
        state: 'plan',
        title: 'Recipe Landing Page',
        summary: 'A simple landing page for a recipe app',
        decisions: [
          { label: 'Type', value: 'Landing page' },
          { label: 'Hosting', value: 'Vercel' },
        ],
        docs: [
          { path: 'docs/01-product-requirements.md', title: 'Product Requirements' },
          { path: 'docs/02-ui-specification.md', title: 'UI Specification' },
          { path: 'README.md', title: 'README' },
        ],
        next_actions: [{ id: 'generate-docs', label: 'Generate documentation' }],
      })
      expect(result.success).toBe(true)
    })

    it('accepts a plan with minimal doc set (landing page)', () => {
      const result = architectPlanSchema.safeParse({
        version: 'architect.v1',
        state: 'plan',
        title: 'Landing Page',
        summary: 'Simple landing page',
        decisions: [{ label: 'Type', value: 'Landing page' }],
        docs: [
          { path: 'docs/01-prd.md', title: 'Product Requirements' },
          { path: 'README.md', title: 'README' },
        ],
        next_actions: [],
      })
      expect(result.success).toBe(true)
      expect(result.data!.docs).toHaveLength(2)
    })

    it('accepts a plan with full doc set (complex SaaS)', () => {
      const result = architectPlanSchema.safeParse({
        version: 'architect.v1',
        state: 'plan',
        title: 'CRM Platform',
        summary: 'Full-featured CRM with multi-tenant architecture',
        decisions: [
          { label: 'Type', value: 'Web application' },
          { label: 'Framework', value: 'Vue 3' },
          { label: 'Backend', value: 'Go' },
        ],
        docs: [
          { path: 'docs/01-product-requirements.md', title: 'Product Requirements' },
          { path: 'docs/02-technical-architecture.md', title: 'Technical Architecture' },
          { path: 'docs/03-data-models.md', title: 'Data Models' },
          { path: 'docs/04-ui-specification.md', title: 'UI Specification' },
          { path: 'docs/05-backend-endpoints.md', title: 'Backend Endpoints' },
          { path: 'docs/06-development-roadmap.md', title: 'Development Roadmap' },
          { path: 'docs/07-setup-guide.md', title: 'Setup Guide' },
          { path: 'docs/08-ai-context.md', title: 'AI Context' },
          { path: 'README.md', title: 'README' },
        ],
        next_actions: [{ id: 'generate-docs', label: 'Generate documentation' }],
      })
      expect(result.success).toBe(true)
      expect(result.data!.docs).toHaveLength(9)
    })

    it('accepts empty docs array (doc set is adaptive, could be none yet)', () => {
      const result = architectPlanSchema.safeParse({
        version: 'architect.v1',
        state: 'plan',
        title: 'Test',
        summary: 'Test',
        decisions: [],
        docs: [],
        next_actions: [],
      })
      expect(result.success).toBe(true)
    })
  })

  describe('progress state', () => {
    it('accepts a valid progress message', () => {
      const result = architectProgressSchema.safeParse({
        version: 'architect.v1',
        state: 'progress',
        message: 'Generating architecture documentation...',
      })
      expect(result.success).toBe(true)
    })

    it('rejects missing message', () => {
      const result = architectProgressSchema.safeParse({
        version: 'architect.v1',
        state: 'progress',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('envelope discriminated union', () => {
    it('routes to questions state correctly', () => {
      const result = architectEnvelopeSchema.safeParse({
        version: 'architect.v1',
        state: 'questions',
        questions: [{
          id: 'q1',
          question: 'What?',
          type: 'single',
          options: [{ value: 'a', label: 'A' }],
        }],
      })
      expect(result.success).toBe(true)
      expect(result.data!.state).toBe('questions')
    })

    it('routes to plan state correctly', () => {
      const result = architectEnvelopeSchema.safeParse({
        version: 'architect.v1',
        state: 'plan',
        title: 'My Project',
        summary: 'A project',
        decisions: [],
        docs: [],
        next_actions: [],
      })
      expect(result.success).toBe(true)
      expect(result.data!.state).toBe('plan')
    })

    it('routes to progress state correctly', () => {
      const result = architectEnvelopeSchema.safeParse({
        version: 'architect.v1',
        state: 'progress',
        message: 'Working...',
      })
      expect(result.success).toBe(true)
      expect(result.data!.state).toBe('progress')
    })

    it('rejects unknown state', () => {
      const result = architectEnvelopeSchema.safeParse({
        version: 'architect.v1',
        state: 'unknown',
        data: {},
      })
      expect(result.success).toBe(false)
    })

    it('rejects missing version', () => {
      const result = architectEnvelopeSchema.safeParse({
        state: 'progress',
        message: 'Hello',
      })
      expect(result.success).toBe(false)
    })

    it('rejects null input', () => {
      const result = architectEnvelopeSchema.safeParse(null)
      expect(result.success).toBe(false)
    })
  })
})
