import { describe, expect, it } from 'vitest'

import { buildArchitectDocsTask, getArchitectDocsToGenerate } from './docsTaskBuilder'
import type { ArchitectPlan } from './documentsGenerator'

describe('docsTaskBuilder', () => {
  it('uses the space-specific doc set for Construct spaces', () => {
    const plan: ArchitectPlan = {
      name: 'Company Manager',
      description: 'A Construct space for HR workflows',
      type: 'construct-space',
      spaceId: 'company-manager',
      decisions: {
        spaces: ['code', 'docs'],
      },
    }

    const docs = getArchitectDocsToGenerate(plan, 'Company management space')

    expect(docs).toContain('01-space-design-document.md: purpose, user flows, page-by-page behavior, interactions, and space-specific workflows')
    expect(docs).toContain('06-ai-context.md: agent behavior, tools, coding guardrails, and verification checklist')
    expect(docs).not.toContain('01-product-requirements.md: target users, stories, feature behavior, MVP, dependencies, and risks')
  })

  it('builds a task that points space docs at the project docs folder and scaffold folder', () => {
    const plan: ArchitectPlan = {
      name: 'Company Manager',
      description: 'A Construct space for HR workflows',
      type: 'construct-space',
      spaceId: 'company-manager',
      decisions: {},
    }

    const task = buildArchitectDocsTask({
      plan,
      projectPath: '/Users/flakerimi/ConstructProjects/company-manager',
      interviewDescription: 'A company management space',
      interviewAnswers: 'company_size: small',
    })

    expect(task).toContain('Write all docs to: /Users/flakerimi/ConstructProjects/company-manager/docs/')
    expect(task).toContain('/Users/flakerimi/ConstructProjects/company-manager/code/space-company-manager/')
    expect(task).toContain('This project is a Construct space, not a regular web app.')
  })

  it('keeps the regular project doc set for non-space projects', () => {
    const plan: ArchitectPlan = {
      name: 'Customer Portal',
      description: 'A fullstack web app',
      decisions: {
        frontend: 'vue',
        backend: 'fastapi',
        database: 'postgres',
      },
    }

    const docs = getArchitectDocsToGenerate(plan, 'Portal with dashboard')

    expect(docs).toContain('01-product-requirements.md: target users, stories, feature behavior, MVP, dependencies, and risks')
    expect(docs).toContain('05-backend-endpoints.md: endpoint-by-endpoint contract, request/response examples, auth/rate-limits, and errors')
    expect(docs).toContain('09-ai-context.md: coding conventions, architecture guardrails, common bugs, and test priorities')
  })
})
