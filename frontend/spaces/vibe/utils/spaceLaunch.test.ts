import { describe, expect, it } from 'vitest'
import { buildConstructSpaceDevRoute, isConstructSpaceHandoff } from './spaceLaunch'

describe('spaceLaunch', () => {
  it('detects architect handoffs for Construct spaces', () => {
    expect(isConstructSpaceHandoff({
      id: 'handoff-1',
      source: 'architect',
      description: 'Build a company manager space',
      createdAt: '2026-03-18T10:00:00.000Z',
      plan: {
        name: 'Company Manager',
        description: 'A company management space',
        type: 'construct-space',
        spaceId: 'company-manager',
        decisions: {},
      },
    })).toBe(true)
  })

  it('builds the project-scoped Construct DEV route from the current route project id', () => {
    expect(buildConstructSpaceDevRoute({
      routeProjectId: 'company-manager',
      handoff: {
        id: 'handoff-1',
        source: 'architect',
        description: 'Build a company manager space',
        createdAt: '2026-03-18T10:00:00.000Z',
        plan: {
          name: 'Company Manager',
          description: 'A company management space',
          type: 'construct-space',
          spaceId: 'company-manager',
          decisions: {},
        },
      },
    })).toBe('/app/projects/company-manager/company-manager')
  })

  it('falls back to the project route helper when the current route id is unavailable', () => {
    expect(buildConstructSpaceDevRoute({
      project: {
        id: 'ext-company-manager',
        name: 'Company Manager',
        path: '/Users/flakerimi/ConstructProjects/company-manager',
      },
      handoff: {
        id: 'handoff-1',
        source: 'architect',
        description: 'Build a company manager space',
        createdAt: '2026-03-18T10:00:00.000Z',
        plan: {
          name: 'Company Manager',
          description: 'A company management space',
          type: 'construct-space',
          spaceId: 'company-manager',
          decisions: {},
        },
      },
    })).toBe('/app/projects/company-manager/company-manager')
  })

  it('returns an empty route for non-space handoffs', () => {
    expect(buildConstructSpaceDevRoute({
      routeProjectId: 'company-manager',
      handoff: {
        id: 'handoff-1',
        source: 'architect',
        description: 'Build a web app',
        createdAt: '2026-03-18T10:00:00.000Z',
        plan: {
          name: 'Company Manager',
          description: 'A company management project',
          type: 'project',
          decisions: {},
        },
      },
    })).toBe('')
  })
})
