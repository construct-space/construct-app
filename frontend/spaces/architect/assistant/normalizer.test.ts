import { describe, it, expect } from 'vitest'
import { normalizeArchitectOutput } from './normalizer'

describe('normalizeArchitectOutput', () => {
  it('normalizes questions state into architect:questions block', () => {
    const blocks = normalizeArchitectOutput({
      version: 'architect.v1',
      state: 'questions',
      questions: [{
        id: 'scope',
        question: 'What are we building?',
        type: 'single',
        options: [{ value: 'web', label: 'Web app' }],
      }],
    })
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.type).toBe('architect:questions')
  })

  it('normalizes plan state into architect:plan block', () => {
    const blocks = normalizeArchitectOutput({
      version: 'architect.v1',
      state: 'plan',
      title: 'Project Plan',
      summary: 'A web app',
      decisions: [{ label: 'Framework', value: 'Vue 3' }],
      docs: [{ path: '/docs/arch.md', title: 'Architecture' }],
      next_actions: [{ id: 'impl', label: 'Start implementation' }],
    })
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.type).toBe('architect:plan')
    const data = (blocks[0] as any).data
    expect(data.title).toBe('Project Plan')
    expect(data.summary).toBe('A web app')
    expect(data.decisions).toEqual([{ label: 'Framework', value: 'Vue 3' }])
    expect(data.docs).toEqual([{ path: '/docs/arch.md', title: 'Architecture' }])
    expect(data.nextActions).toEqual([{ id: 'impl', label: 'Start implementation' }])
  })

  it('normalizes progress state', () => {
    const blocks = normalizeArchitectOutput({
      version: 'architect.v1',
      state: 'progress',
      message: 'Generating docs...',
    })
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.type).toBe('architect:progress')
    expect((blocks[0] as any).data.message).toBe('Generating docs...')
  })

  it('falls back to text for plain strings', () => {
    const blocks = normalizeArchitectOutput('Hello world')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.type).toBe('text')
    expect((blocks[0] as any).content).toBe('Hello world')
  })

  it('falls back to text for invalid objects', () => {
    const blocks = normalizeArchitectOutput({ foo: 'bar' })
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.type).toBe('text')
  })

  it('extracts JSON from markdown code block', () => {
    const blocks = normalizeArchitectOutput('```json\n{"version":"architect.v1","state":"progress","message":"Working..."}\n```')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.type).toBe('architect:progress')
    expect((blocks[0] as any).data.message).toBe('Working...')
  })

  it('extracts JSON from bare JSON string', () => {
    const blocks = normalizeArchitectOutput('{"version":"architect.v1","state":"progress","message":"Thinking..."}')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.type).toBe('architect:progress')
  })

  it('returns text for invalid JSON in code block', () => {
    const blocks = normalizeArchitectOutput('```json\n{invalid json}\n```')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.type).toBe('text')
  })

  it('handles questions with multiple options and descriptions', () => {
    const blocks = normalizeArchitectOutput({
      version: 'architect.v1',
      state: 'questions',
      questions: [{
        id: 'stack',
        question: 'Which tech stack?',
        type: 'multi',
        options: [
          { value: 'vue', label: 'Vue 3', description: 'Reactive framework', icon: 'vue' },
          { value: 'react', label: 'React', description: 'Component library' },
          { value: 'svelte', label: 'Svelte' },
        ],
      }],
    })
    expect(blocks[0]?.type).toBe('architect:questions')
    const questions = (blocks[0] as any).data.questions
    expect(questions).toHaveLength(1)
    expect(questions[0].type).toBe('multi')
    expect(questions[0].options).toHaveLength(3)
    expect(questions[0].options[0].icon).toBe('vue')
  })

  it('handles plan with empty arrays', () => {
    const blocks = normalizeArchitectOutput({
      version: 'architect.v1',
      state: 'plan',
      title: 'Minimal Plan',
      summary: 'Nothing decided yet',
      decisions: [],
      docs: [],
      next_actions: [],
    })
    expect(blocks[0]?.type).toBe('architect:plan')
    const data = (blocks[0] as any).data
    expect(data.decisions).toEqual([])
    expect(data.docs).toEqual([])
    expect(data.nextActions).toEqual([])
  })

  // Legacy format tests (actual LLM output without architect.v1 envelope)

  it('handles legacy questions with "choices" instead of "options"', () => {
    const blocks = normalizeArchitectOutput({
      questions: [{
        id: 'platform',
        question: 'What is the landing page goal?',
        choices: ['Waitlist sign-up', 'Download app', 'Start cooking'],
      }],
    })
    expect(blocks[0]?.type).toBe('architect:questions')
    const q = (blocks[0] as any).data.questions[0]
    expect(q.options).toHaveLength(3)
    expect(q.options[0].label).toBe('Waitlist sign-up')
  })

  it('handles legacy questions as raw JSON string', () => {
    const raw = JSON.stringify({
      questions: [{
        id: 'scope',
        question: 'What type of app?',
        type: 'single',
        choices: ['Web app', 'Mobile app'],
      }],
    })
    const blocks = normalizeArchitectOutput(raw)
    expect(blocks[0]?.type).toBe('architect:questions')
  })

  it('handles legacy plan format with name/stack/features', () => {
    const blocks = normalizeArchitectOutput({
      name: 'Recipe App',
      description: 'A cooking recipe app',
      stack: { frontend: 'Vue 3' },
      features: ['Search', 'Favorites'],
      decisions: [{ label: 'Framework', value: 'Vue 3' }],
    })
    expect(blocks[0]?.type).toBe('architect:plan')
    expect((blocks[0] as any).data.title).toBe('Recipe App')
  })

  it('handles legacy clarify/answer format', () => {
    const blocks = normalizeArchitectOutput({ answer: 'Yes, that works.' })
    expect(blocks[0]?.type).toBe('text')
    expect((blocks[0] as any).content).toBe('Yes, that works.')
  })

  it('handles legacy review format', () => {
    const blocks = normalizeArchitectOutput({
      issues: [{ severity: 'high', area: 'auth', problem: 'No auth', suggestion: 'Add JWT' }],
    })
    expect(blocks[0]?.type).toBe('text')
    expect((blocks[0] as any).content).toContain('No auth')
  })
})
