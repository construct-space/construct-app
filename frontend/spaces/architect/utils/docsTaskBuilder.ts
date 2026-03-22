import type { ArchitectPlan } from './documentsGenerator'

function detectProjectType(plan: ArchitectPlan, description: string): 'game' | 'space' | 'web-app' | 'landing' | 'api' | 'generic' {
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
      return [
        '01-game-design-document.md',
        '02-technical-architecture.md',
        '03-project-setup.md',
        '04-data-models.md',
        '05-economy-balancing.md',
        '07-ui-ux-wireframes.md',
        '08-development-roadmap.md',
        '09-ai-context.md',
      ]
    case 'space':
      return [
        '01-space-design.md',
        '02-technical-architecture.md',
        '03-data-models.md',
        '04-ui-spec.md',
        '05-development-roadmap.md',
      ]
    case 'landing':
      return ['01-design-spec.md', '02-implementation-plan.md', 'README.md']
    case 'api':
      return [
        '01-product-requirements.md',
        '02-technical-architecture.md',
        '03-data-models.md',
        '04-api-endpoints.md',
        '05-development-roadmap.md',
        'README.md',
      ]
    case 'web-app':
      return [
        '01-product-requirements.md',
        '02-technical-architecture.md',
        '03-data-models.md',
        '04-ui-specification.md',
        '05-development-roadmap.md',
        'README.md',
      ]
    default:
      return ['01-design-spec.md', '02-implementation-plan.md', 'README.md']
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
  const type = detectProjectType(plan, interviewDescription)
  const docs = getArchitectDocsToGenerate(plan, interviewDescription)

  const docList = docs.map(d => `- ${projectPath}/docs/${d}`).join('\n')

  const styleGuide = type === 'game'
    ? `Write like a real game design document. Include:
- Elevator pitch (2-3 sentences)
- Core gameplay loop diagram
- Systems breakdown with concrete numbers
- Data models as TypeScript/Dart interfaces
- Development roadmap with phases and checkboxes
- Each doc should be detailed enough for a developer to implement from`
    : type === 'space'
    ? `Write for a Construct space (Vue 3 + Vite IIFE). Include component tree, composables, manifest structure.`
    : `Write concise, actionable docs. Tables over prose. Code over descriptions. No filler.
Each implementation task: title, files, steps, verify command, commit message. 2-10 min per task.`

  return `Write project docs for "${plan.name}" to ${projectPath}/docs/

bash("mkdir -p ${projectPath}/docs")

Then write_file for each:
${docList}

${styleGuide}

## Context

Description: ${interviewDescription}
Decisions: ${interviewAnswers}
Name: ${plan.name}
Type: ${plan.type || type}
Stack: ${JSON.stringify(plan.stack || plan.decisions)}
Features: ${JSON.stringify(plan.features?.map(f => typeof f === 'string' ? f : f.name) || [])}
Tasks: ${JSON.stringify(plan.tasks?.map(t => t.title || t) || [])}`
}
