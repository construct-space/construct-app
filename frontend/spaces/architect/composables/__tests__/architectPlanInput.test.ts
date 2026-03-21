import { describe, expect, it } from 'vitest'

import { buildArchitectPlanInput, shouldTreatAsSupplementalRequirement } from '../architectPlanInput'
import type { InterviewQuestion } from '../../data/architect-knowledge'

const scaleQuestion: InterviewQuestion = {
  id: 'scale',
  type: 'single',
  question: 'How big are you thinking for the initial launch?',
  options: [
    { value: 'small', label: 'Small launch', icon: 'i-lucide-seedling', description: 'Focused MVP for a narrow audience' },
    { value: 'medium', label: 'Growing product', icon: 'i-lucide-rocket', description: 'Broader launch with multiple workflows' },
    { value: 'large', label: 'Large rollout', icon: 'i-lucide-building-2', description: 'Heavy usage, teams, and operational load' },
  ],
}

describe('architectPlanInput', () => {
  it('moves long requirement text out of structured answers', () => {
    const input = buildArchitectPlanInput(
      'PlayUp - social sports coordination app',
      [scaleQuestion],
      {
        scale: 'I want document for Designer, Flutter (getx), Devops, Product Owner, Full Tasks, so it knows when project ends',
      },
    )

    expect(input.answers.scale).toBeUndefined()
    expect(input.description).toContain('Additional user requirements:')
    expect(input.description).toContain('Flutter (getx)')
    expect(input.description).toContain('Full Tasks')
  })

  it('keeps normal selected answers intact', () => {
    const input = buildArchitectPlanInput(
      'PlayUp - social sports coordination app',
      [scaleQuestion],
      { scale: 'medium' },
    )

    expect(input.answers.scale).toBe('medium')
    expect(input.description).not.toContain('Additional user requirements:')
  })

  it('detects supplemental requirements for long custom text but not short custom answers', () => {
    expect(shouldTreatAsSupplementalRequirement(scaleQuestion, 'small local launch')).toBe(false)
    expect(shouldTreatAsSupplementalRequirement(
      scaleQuestion,
      'Need designer handoff, DevOps setup, PO delivery checklist, and full task breakdown before we close MVP',
    )).toBe(true)
  })
})
