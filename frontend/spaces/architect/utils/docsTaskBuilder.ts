import type { ArchitectPlan } from './documentsGenerator'

export function getArchitectDocsToGenerate(): string[] {
  return ['01-design-spec.md', '02-implementation-plan.md', 'README.md']
}

export function buildArchitectDocsTask(input: {
  plan: ArchitectPlan
  projectPath: string
  interviewDescription: string
  interviewAnswers: string
  mode?: string
}): string {
  const { plan, projectPath, interviewDescription, interviewAnswers } = input
  const tasksJson = plan.tasks?.length
    ? JSON.stringify(plan.tasks.slice(0, 3), null, 2) + (plan.tasks.length > 3 ? `\n... (${plan.tasks.length} total)` : '')
    : 'No tasks in plan'

  return `Write project docs for "${plan.name}" to ${projectPath}/docs/

Use bash("mkdir -p ${projectPath}/docs") first, then write_file for each doc.

Write exactly 3 files:

1. docs/01-design-spec.md — Concise design document:
   - Overview (2-3 sentences)
   - Core features (bullet list)
   - Stack (what tech, why)
   - Data model (TypeScript interfaces)
   - File structure (tree)
   - Non-goals

2. docs/02-implementation-plan.md — Bite-sized tasks:
   - Each task: title, files, numbered steps, verify command, commit message
   - 2-10 minutes per task
   - Exact file paths
   - Test-first when applicable

3. README.md — 10 lines max: what it is, how to run, controls

Be concise. Tables over prose. Code over descriptions. No filler.

## Context

Description: ${interviewDescription}
Decisions: ${interviewAnswers}
Name: ${plan.name}
Stack: ${JSON.stringify(plan.stack || plan.decisions)}
Tasks preview: ${tasksJson}`
}
