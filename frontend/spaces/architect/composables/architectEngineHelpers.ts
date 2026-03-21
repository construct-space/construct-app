export interface ArchitectPromptProjectContext {
  name: string
  description?: string
  spaces?: string[]
}

export function getArchitectScopeKey(projectId: unknown): string {
  return typeof projectId === 'string' && projectId.trim()
    ? `project:${projectId.trim()}`
    : 'global'
}

export function buildArchitectPromptDescription(
  description: string,
  project?: ArchitectPromptProjectContext | null,
): string {
  const rawDescription = description.trim()
  if (!project || !rawDescription) return rawDescription

  return [
    `Project: "${project.name}" — ${project.description || 'No description'}`,
    `Spaces enabled: ${project.spaces?.join(', ') || 'none'}`,
    '',
    `Feature request: ${rawDescription}`,
  ].join('\n')
}
