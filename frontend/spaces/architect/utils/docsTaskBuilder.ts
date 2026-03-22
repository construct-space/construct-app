import type { ArchitectPlan } from './documentsGenerator'

type ProjectType = 'game' | 'space' | 'web-app' | 'landing' | 'api' | 'generic'

function detectProjectType(plan: ArchitectPlan, description: string): ProjectType {
  const text = `${plan.name} ${plan.description} ${description}`.toLowerCase()
  if (plan.type === 'construct-space') return 'space'
  if (/game|rpg|puzzle|dungeon|battle|survival|simulator|multiplayer.*game/i.test(text)) return 'game'
  if (/landing|marketing|homepage|one.?page/i.test(text)) return 'landing'
  if (/api|backend|server|microservice/i.test(text)) return 'api'
  if (/app|dashboard|portal|cms|crm|erp|saas/i.test(text)) return 'web-app'
  return 'generic'
}

export function getArchitectDocsToGenerate(plan: ArchitectPlan, description: string): string[] {
  const type = detectProjectType(plan, description)
  switch (type) {
    case 'game':
      return ['01-game-design-document.md', '02-technical-architecture.md', '03-project-setup.md', '04-data-models.md', '05-economy-balancing.md', '07-ui-ux-wireframes.md', '08-development-roadmap.md', '09-ai-context.md']
    case 'space':
      return ['01-space-design.md', '02-technical-architecture.md', '03-data-models.md', '04-ui-spec.md', '05-development-roadmap.md']
    case 'landing':
      return ['01-design-spec.md', '02-implementation-plan.md']
    case 'api':
      return ['01-product-requirements.md', '02-technical-architecture.md', '03-data-models.md', '04-api-endpoints.md', '05-development-roadmap.md']
    case 'web-app':
      return ['01-product-requirements.md', '02-technical-architecture.md', '03-data-models.md', '04-ui-specification.md', '05-development-roadmap.md']
    default:
      return ['01-design-spec.md', '02-implementation-plan.md']
  }
}

export function buildArchitectDocsTask(input: {
  plan: ArchitectPlan
  projectPath: string
  interviewDescription: string
  interviewAnswers: string
  mode?: string
}): string {
  const { plan, projectPath, interviewDescription, interviewAnswers } = input
  const docs = getArchitectDocsToGenerate(plan, interviewDescription)
  const docPaths = docs.map(d => `- ${projectPath}/docs/${d}`).join('\n')

  return `You are writing docs for "${plan.name}" that an AI coding agent will use to build the entire project.

These docs are NOT for humans to read — they are instructions for an AI (Vibe) that will implement everything from scratch. The AI reads these docs, then writes code. If the docs are vague, the code will be wrong. If the docs have concrete types, exact file paths, real numbers, and clear structure — the code will be right.

bash("mkdir -p ${projectPath}/docs")

Write each doc with write_file:
${docPaths}

Think about what YOU would need to build this project from zero. Write that.

## Project

${interviewDescription}

Decisions: ${interviewAnswers}
Stack: ${JSON.stringify(plan.stack || plan.decisions)}
Features: ${JSON.stringify(plan.features?.map(f => typeof f === 'string' ? f : f.name) || [])}`
}
