import type { ArchitectPlan } from './documentsGenerator'

function hasDecisionValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value.length > 0
  return typeof value === 'string' && value.trim().length > 0
}

export function getArchitectDocsToGenerate(
  plan: ArchitectPlan,
  interviewDescription: string,
): string[] {
  const decisions = plan.decisions || {}
  const hasFrontend = hasDecisionValue(decisions.frontend)
    || hasDecisionValue(decisions.platform)
    || hasDecisionValue(decisions.framework)
  const hasBackend = hasDecisionValue(decisions.backend)
    || hasDecisionValue(decisions.server)
    || hasDecisionValue(decisions.api)
  const hasDatabase = hasDecisionValue(decisions.database)
  const isConstructSpace = plan.type === 'construct-space'
  const isGame = /(game|frostline|rpg|puzzle|multiplayer|level|battle)/i.test(
    `${plan.name} ${plan.description} ${interviewDescription}`,
  )

  if (isConstructSpace) {
    return [
      '01-space-design-document.md: purpose, user flows, page-by-page behavior, interactions, and space-specific workflows',
      '02-technical-architecture.md: component tree, composables, data flow, manifest structure, state boundaries, and integration points',
      '03-data-models.md: state shapes, storage strategy, important types, validation rules, and sample payloads',
      '04-ui-ux-spec.md: layout, navigation, toolbar actions, empty/loading/error states, theming, and responsiveness',
      '05-development-roadmap.md: implementation phases, milestones, acceptance criteria, testing, and release checklist',
      '06-ai-context.md: agent behavior, tools, coding guardrails, and verification checklist',
      'README.md: onboarding, project layout, commands, build/install flow, and troubleshooting',
    ]
  }

  const docsToGenerate: string[] = [
    '01-product-requirements.md: target users, stories, feature behavior, MVP, dependencies, and risks',
    '02-technical-architecture.md: architecture and data flow, module boundaries, security, error handling, and scaling',
  ]

  if (hasBackend || hasDatabase) {
    docsToGenerate.push('03-data-models.md: entities, relations, schema, validation, constraints, and sample payloads')
  }
  if (hasFrontend || isGame) {
    docsToGenerate.push('04-ui-specification.md: screens, components, states, transitions, accessibility, responsiveness, and interaction/motion')
  }
  if (isGame) {
    docsToGenerate.push('10-game-design-system.md: gameplay loop, balancing model, progression, edge cases, fairness, moderation, and abuse prevention')
  }
  if (hasBackend) {
    docsToGenerate.push('05-backend-endpoints.md: endpoint-by-endpoint contract, request/response examples, auth/rate-limits, and errors')
    docsToGenerate.push('06-backend-modules.md: module responsibilities, service boundaries, retries, job queues, and background tasks')
  }
  if (!isConstructSpace && (hasFrontend || hasBackend)) {
    docsToGenerate.push('07-development-roadmap.md: phases, milestones, dependencies, release gates, and acceptance criteria')
    docsToGenerate.push('08-setup-guide.md: prerequisites, run/build/install flow, env vars, and troubleshooting')
  }
  if (!isConstructSpace) {
    docsToGenerate.push('09-ai-context.md: coding conventions, architecture guardrails, common bugs, and test priorities')
  }
  docsToGenerate.push('README.md: onboarding, architecture summary, command map, and folder expectations')

  return docsToGenerate
}

export function buildArchitectDocsTask(input: {
  plan: ArchitectPlan
  projectPath: string
  interviewDescription: string
  interviewAnswers: string
}): string {
  const { plan, projectPath, interviewDescription, interviewAnswers } = input
  const docsToGenerate = getArchitectDocsToGenerate(plan, interviewDescription)
  const isConstructSpace = plan.type === 'construct-space'
  const requiredDetail = docsToGenerate.map((line) => line)

  const header = isConstructSpace
    ? [
        `Generate comprehensive Construct space documentation for "${plan.name}".`,
        `Project path: ${projectPath}`,
        `Write all docs to: ${projectPath}/docs/`,
        '',
        'This project is a Construct space, not a regular web app.',
        `The implementation scaffold should live inside ${projectPath}/code/space-${plan.spaceId || 'my-space'}/.`,
        'Assume a Construct space stack: Vue 3, Vite IIFE bundle, Construct theme variables, and optional agent/tools when the plan mentions AI.',
        'Use the docs agent to write the relevant docs from the context below.',
      ]
    : [
        `Generate comprehensive project documentation for "${plan.name}".`,
        `Project path: ${projectPath}`,
        `Write all docs to: ${projectPath}/docs/`,
        '',
        'Use the docs agent to write the relevant docs from the context below.',
      ]

  return [
    ...header,
    'Create docs only if they apply to this project scope and stack.',
    ...docsToGenerate.map((line) => `- ${line}`),
    '',
    'Each selected doc must be substantial and implementation-ready.',
    'Avoid stubs and vague placeholders.',
    '',
    '## Project Description',
    interviewDescription,
    '',
    '## Interview Decisions',
    interviewAnswers,
    '',
    '## Plan Summary',
    `Name: ${plan.name}`,
    `Description: ${plan.description}`,
    `Decisions: ${JSON.stringify(plan.decisions)}`,
    '',
    '## Required Detail Level',
    ...requiredDetail,
  ].join('\n')
}
